// ============================================================
// Test harness — a deterministic Table around the engine
// ============================================================
// Wraps the pure engine with a seeded RNG and a controllable clock so
// tests are fully reproducible. `playResolve` plays an interruptible
// action and then fires the freeze-window timer (simulating "nobody
// froze"), which is how most effects actually take hold.
// ============================================================

import * as Engine from "../src/domain";
import type { GameState, Ctx, PrivateReveal } from "../src/domain";
import type { ClientCommand } from "../src/shared/protocol";
import type { GameEvent } from "../src/shared/events";
import type { CardType } from "../src/shared/cards";
import { makeRng, type Rng } from "../src/domain/rng";
import { makeCard } from "../src/domain/state";

export class Table {
  state: GameState;
  ids: string[] = [];
  rng: Rng;
  now = 1000;
  lastEvents: GameEvent[] = [];
  lastReveals: PrivateReveal[] = [];

  constructor(numPlayers: number, seed = 12345, start = true) {
    this.rng = makeRng(seed);
    let s = Engine.createInitialState("room");
    for (let i = 0; i < numPlayers; i++) {
      const id = `p${i}`;
      this.ids.push(id);
      s = Engine.addPlayer(s, id, `Player${i}`);
    }
    this.state = s;
    if (start) this.do("p0", { t: "START_GAME" });
  }

  ctx(actorId: string): Ctx {
    return { rng: this.rng, actorId, now: this.now };
  }

  do(actorId: string, cmd: ClientCommand) {
    const r = Engine.reduce(this.state, cmd, this.ctx(actorId));
    this.state = r.state;
    this.lastEvents = r.events;
    this.lastReveals = r.reveals;
    return r;
  }

  /** Fire the freeze-window timer (the action resolves if not frozen). */
  resolve() {
    const r = Engine.resolveWindow(this.state, this.ctx("__timer"));
    this.state = r.state;
    this.lastEvents = r.events;
    this.lastReveals = r.reveals;
    return r;
  }

  /** Play an interruptible action and immediately resolve its window. */
  playResolve(actorId: string, cmd: ClientCommand) {
    this.do(actorId, cmd);
    if (this.state.phase.kind === "nope_window") return this.resolve();
    return { state: this.state, events: this.lastEvents, reveals: this.lastReveals };
  }

  advanceTime(ms: number) {
    this.now += ms;
  }

  // ---- introspection ----
  player(id: string) {
    return this.state.players[id];
  }
  hand(id: string) {
    return this.state.players[id].hand;
  }
  current() {
    return this.state.turnOrder[this.state.currentTurnIndex];
  }
  phaseKind() {
    return this.state.phase.kind;
  }

  // ---- deterministic test setup (bypasses normal play) ----
  setHand(id: string, types: CardType[]) {
    this.state = {
      ...this.state,
      players: {
        ...this.state.players,
        [id]: { ...this.state.players[id], hand: types.map(makeCard) },
      },
    };
    return this.hand(id);
  }

  /** Set the deck so `typesTopFirst[0]` is the very next card drawn. */
  setDeckTop(typesTopFirst: CardType[]) {
    this.state = { ...this.state, deck: [...typesTopFirst].reverse().map(makeCard) };
  }

  setTurn(id: string, turnsRemaining = 1) {
    const idx = this.state.turnOrder.indexOf(id);
    this.state = {
      ...this.state,
      currentTurnIndex: idx,
      turnsRemaining,
      phase: { kind: "turn", playerId: id },
      held: null,
      bucketCard: null,
    };
  }

  giveBunker(id: string) {
    this.state = {
      ...this.state,
      players: { ...this.state.players, [id]: { ...this.state.players[id], hasBunker: true } },
    };
  }

  setAway(id: string, away = true) {
    this.state = {
      ...this.state,
      players: { ...this.state.players, [id]: { ...this.state.players[id], away } },
    };
  }

  cardId(id: string, type: CardType): string {
    const c = this.hand(id).find((x) => x.type === type);
    if (!c) throw new Error(`Player ${id} has no ${type}`);
    return c.id;
  }
}

export function eventKinds(events: GameEvent[]): string[] {
  return events.map((e) => e.kind);
}
