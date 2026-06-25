// ============================================================
// VolcanoCatsRoom — thin Colyseus transport over the pure engine
// ============================================================
// Responsibilities ONLY: validate input (Zod), translate client
// sessions ↔ stable engine player ids, drive the freeze-window timer,
// run the away-player auto-play loop, and broadcast state. All game
// rules live in the engine (../domain). No game logic here.
//
// Players are keyed by a STABLE engine id, not the Colyseus sessionId,
// so reconnection never has to rewrite game state — we just rebind the
// session→player mapping.
// ============================================================

import { Room, Client } from "@colyseus/core";
import { randomUUID } from "node:crypto";
import {
  reduce,
  resolveWindow,
  createInitialState,
  addPlayer,
  removePlayerFromLobby,
  setConnected,
  isNameTaken,
  findDisconnectedByName,
  serializeForViewer,
  handFor,
  nextAutoStep,
  makeSecureRng,
  EngineError,
  type GameState,
  type Ctx,
  type Rng,
} from "../domain/index.js";
import type { ClientCommand, ServerMessage } from "../shared/protocol.js";
import { LEAVE_CODES } from "../shared/protocol.js";
import { commandSchema, joinOptionsSchema } from "./schemas.js";
import { roomLogger } from "../lib/logger.js";

const MAX_PLAYERS = 10;
const RECONNECT_WINDOW_S = 60;
const LOBBY_TIMEOUT_MS = 30 * 60 * 1000;
const AUTO_STEP_DELAY_MS = 900;

/** 5-letter room codes. I/O dropped to avoid 1/0 confusion (24^5 ≈ 8M codes). */
const ROOM_CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const ROOM_CODE_LENGTH = 5;
/** Presence set key tracking every active room code (collision avoidance). */
const ROOM_IDS_KEY = "vc_room_ids";

type Timer = { clear(): void };

export class VolcanoCatsRoom extends Room {
  private game!: GameState;
  private rng: Rng = makeSecureRng();
  private log = roomLogger("pending");

  /** Colyseus sessionId → stable engine player id, and the reverse. */
  private sidToPid = new Map<string, string>();
  private pidToSid = new Map<string, string>();

  private freezeTimer: Timer | null = null;
  private autoRunning = false;

  // ------------------------------------------------------------
  // lifecycle
  // ------------------------------------------------------------
  override async onCreate() {
    // Replace Colyseus's 9-char nanoid with a friendly 5-letter code. The
    // matchmaker reads `this.roomId` back AFTER onCreate, so reassigning it
    // here propagates to the room listing + `joinById(code)` automatically.
    this.roomId = await this.generateRoomCode();

    this.maxClients = MAX_PLAYERS;
    this.autoDispose = true;
    this.log = roomLogger(this.roomId);
    this.game = createInitialState(this.roomId);

    this.onMessage("c", (client, message) => this.handleCommand(client, message));

    this.clock.setTimeout(() => {
      if (this.game.status === "lobby") {
        this.log.info("Lobby timed out — disposing");
        this.disconnect();
      }
    }, LOBBY_TIMEOUT_MS);

    this.log.info("Room created");
  }

  /**
   * Mint a unique 5-uppercase-letter room code, guarded against collisions via
   * the shared presence set (works across processes when Redis presence is in
   * use; LocalPresence in single-process dev).
   */
  private async generateRoomCode(): Promise<string> {
    const gen = () =>
      Array.from({ length: ROOM_CODE_LENGTH }, () => {
        const i = Math.floor(Math.random() * ROOM_CODE_LETTERS.length);
        return ROOM_CODE_LETTERS[i];
      }).join("");

    let id = gen();
    // sismember returns 1 (truthy) if the code is already in use.
    while (await this.presence.sismember(ROOM_IDS_KEY, id)) id = gen();
    await this.presence.sadd(ROOM_IDS_KEY, id);
    return id;
  }

  override onJoin(client: Client, options: unknown) {
    const parsed = joinOptionsSchema.safeParse(options ?? {});
    const name = (parsed.success ? parsed.data.username : undefined)?.slice(0, 20).trim() || "Pemain";

    if (this.game.status === "lobby") {
      if (isNameTaken(this.game, name)) {
        this.sendMsg(client, { t: "ERROR", code: "DUPLICATE_USERNAME" });
        client.leave(LEAVE_CODES.DUPLICATE_USERNAME);
        return;
      }
      const pid = randomUUID();
      this.game = addPlayer(this.game, pid, name);
      this.bind(client.sessionId, pid);
      this.sendMsg(client, { t: "WELCOME", playerId: pid });
      this.pushState();
      this.log.info({ name, count: this.game.turnOrder.length }, "Player joined lobby");
      return;
    }

    // Mid-game: only a name-match rejoin is allowed (seamless refresh goes
    // through allowReconnection in onLeave, not here).
    const existing = findDisconnectedByName(this.game, name);
    if (existing) {
      this.bind(client.sessionId, existing.id);
      this.game = setConnected(this.game, existing.id, true);
      this.game.log.push({ kind: "PLAYER_RECONNECTED", playerId: existing.id });
      this.sendMsg(client, { t: "WELCOME", playerId: existing.id });
      this.pushState();
      this.runAuto();
      this.log.info({ name }, "Player rejoined by name");
      return;
    }

    client.leave(LEAVE_CODES.GAME_IN_PROGRESS);
  }

  override async onLeave(client: Client, consented: boolean) {
    const pid = this.sidToPid.get(client.sessionId);
    if (!pid) return;

    if (this.game.status === "lobby") {
      this.game = removePlayerFromLobby(this.game, pid);
      this.unbind(client.sessionId, pid);
      this.pushState();
      return;
    }

    this.game = setConnected(this.game, pid, false);
    this.game.log.push({ kind: "PLAYER_DISCONNECTED", playerId: pid });
    this.pushState();
    this.runAuto(); // their turn? keep the game moving
    this.log.info({ pid }, "Player disconnected mid-game");

    if (consented) {
      this.unbind(client.sessionId, pid);
      return;
    }
    try {
      const back = await this.allowReconnection(client, RECONNECT_WINDOW_S);
      this.bind(back.sessionId, pid);
      this.game = setConnected(this.game, pid, true);
      this.game.log.push({ kind: "PLAYER_RECONNECTED", playerId: pid });
      this.sendMsg(back, { t: "WELCOME", playerId: pid });
      this.pushState();
      this.runAuto();
      this.log.info({ pid }, "Player reconnected");
    } catch {
      // Reconnect window elapsed. The player stays in the game on auto-play
      // (per design) and can still rejoin later by name.
      this.unbind(client.sessionId, pid);
      this.pushState();
    }
  }

  override async onDispose() {
    this.clearFreezeTimer();
    // Release the room code so it can be reused.
    try {
      await this.presence.srem(ROOM_IDS_KEY, this.roomId);
    } catch {
      /* best-effort — the room is going away regardless */
    }
    this.log.info("Room disposed");
  }

  // ------------------------------------------------------------
  // command handling
  // ------------------------------------------------------------
  private handleCommand(client: Client, raw: unknown) {
    const pid = this.sidToPid.get(client.sessionId);
    if (!pid) return;

    const parsed = commandSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendMsg(client, { t: "ERROR", code: "UNKNOWN" });
      return;
    }
    const cmd = parsed.data as ClientCommand;

    try {
      const result = reduce(this.game, cmd, this.ctx(pid));
      this.commit(result.state, result.reveals);
      this.runAuto();
    } catch (err) {
      if (err instanceof EngineError) {
        this.sendMsg(client, { t: "ERROR", code: err.code });
      } else {
        this.log.error({ err: String(err), cmd: cmd.t }, "Command failed");
        this.sendMsg(client, { t: "ERROR", code: "UNKNOWN" });
      }
    }
  }

  // ------------------------------------------------------------
  // freeze-window timer
  // ------------------------------------------------------------
  private syncFreezeTimer() {
    this.clearFreezeTimer();
    if (this.game.phase.kind === "nope_window") {
      const delay = Math.max(0, this.game.phase.endsAt - Date.now());
      this.freezeTimer = this.clock.setTimeout(() => this.onFreezeElapsed(), delay);
    }
  }

  private onFreezeElapsed() {
    this.freezeTimer = null;
    if (this.game.phase.kind !== "nope_window") return;
    try {
      const r = resolveWindow(this.game, this.ctx("__system"));
      this.commit(r.state, r.reveals);
      this.runAuto();
    } catch (err) {
      this.log.error({ err: String(err) }, "Failed resolving freeze window");
    }
  }

  private clearFreezeTimer() {
    this.freezeTimer?.clear();
    this.freezeTimer = null;
  }

  // ------------------------------------------------------------
  // away/offline auto-play loop
  // ------------------------------------------------------------
  private runAuto() {
    if (this.autoRunning) return;
    if (!nextAutoStep(this.game, this.rng)) return;
    this.autoRunning = true;
    void this.autoLoop().finally(() => {
      this.autoRunning = false;
    });
  }

  private async autoLoop() {
    while (this.game.status === "playing") {
      const step = nextAutoStep(this.game, this.rng);
      if (!step) break;
      await this.delay(AUTO_STEP_DELAY_MS);
      const again = nextAutoStep(this.game, this.rng);
      if (!again) break; // player came back / state changed during the delay
      try {
        const r = reduce(this.game, again.cmd, this.ctx(again.actorId));
        r.state.log.push({ kind: "AUTO_PLAYED", playerId: again.actorId });
        this.commit(r.state, r.reveals);
      } catch (err) {
        this.log.error({ err: String(err) }, "Auto-play step failed");
        break;
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => this.clock.setTimeout(resolve, ms));
  }

  // ------------------------------------------------------------
  // broadcasting
  // ------------------------------------------------------------
  /** Apply a new engine state: deliver reveals, broadcast, sync the timer. */
  private commit(state: GameState, reveals: { playerId: string; mode: "spy" | "swap" | "pickpocket"; cards: { id: string; type: import("../shared/cards.js").CardType }[] }[]) {
    this.game = state;
    for (const reveal of reveals) {
      const c = this.clientForPid(reveal.playerId);
      if (c) this.sendMsg(c, { t: "PEEK", mode: reveal.mode, cards: reveal.cards });
    }
    this.pushState();
    this.syncFreezeTimer();
  }

  private pushState() {
    this.broadcast("s", { t: "STATE", state: serializeForViewer(this.game) } satisfies ServerMessage);
    for (const client of this.clients) {
      const pid = this.sidToPid.get(client.sessionId);
      if (pid) this.sendMsg(client, { t: "HAND", cards: handFor(this.game, pid) });
    }
  }

  private sendMsg(client: Client, message: ServerMessage) {
    try {
      client.send("s", message);
    } catch (err) {
      this.log.warn({ sid: client.sessionId, err: String(err) }, "send failed");
    }
  }

  private clientForPid(pid: string): Client | undefined {
    const sid = this.pidToSid.get(pid);
    return sid ? this.clients.find((c) => c.sessionId === sid) : undefined;
  }

  // ------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------
  private ctx(actorId: string): Ctx {
    return { rng: this.rng, now: Date.now(), actorId };
  }

  private bind(sid: string, pid: string) {
    this.sidToPid.set(sid, pid);
    this.pidToSid.set(pid, sid);
  }

  private unbind(sid: string, pid: string) {
    this.sidToPid.delete(sid);
    if (this.pidToSid.get(pid) === sid) this.pidToSid.delete(pid);
  }
}
