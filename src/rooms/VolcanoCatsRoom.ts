import { Room, Client } from "@colyseus/core";
import { GameState, Player } from "../types/game.js";
import { Card } from "../types/cards.js";
import {
  setupGame,
  drawCard,
  playCard,
  playFreeze,
  playGang,
  placeLavaCat,
  resolveBribe,
  resolvePeekAndSwap,
  resolveFloodDiscard,
  resolveTimeWarp,
  serializeForClient,
  validatePlayCard,
  executeGangRainbow,
  getCurrentPlayer,
  advanceTurn,
} from "../game/engine.js";
import {
  MESSAGE_SCHEMAS,
  isValidMessageType,
  joinOptionsSchema,
} from "../schemas/messages.js";
import { roomLogger } from "../lib/logger.js";

const MAX_PLAYERS = 10;
const MIN_PLAYERS = 2;
const LOBBY_TIMEOUT_MS = 30 * 60 * 1000; // 30 menit
const RECONNECT_TIMEOUT_MS = 60 * 1000; // 1 menit

export class VolcanoCatsRoom extends Room {
  private gameState!: GameState;
  private log = roomLogger("pending");

  onCreate(_options: unknown) {
    this.maxClients = MAX_PLAYERS;
    this.autoDispose = true;
    this.log = roomLogger(this.roomId);

    this.gameState = {
      roomId: this.roomId,
      status: "lobby",
      hostId: "",
      players: new Map(),
      turnOrder: [],
      currentTurnIndex: 0,
      turnDirection: 1,
      pendingTurns: 1,
      deck: [],
      discardPile: [],
      pendingAction: null,
      peekResult: null,
      winner: null,
      log: [],
    };

    this.onMessage("*", (client, type, message) => {
      this.handleMessage(client, String(type), message);
    });

    this.clock.setTimeout(() => {
      if (this.gameState.status === "lobby") {
        this.log.info("Lobby timeout reached, disposing room");
        this.disconnect();
      }
    }, LOBBY_TIMEOUT_MS);

    this.log.info("Room created");
  }

  onJoin(client: Client, options: unknown) {
    const parsed = joinOptionsSchema.safeParse(options);
    const rawUsername = parsed.success ? parsed.data.username : undefined;
    const username = (rawUsername ?? "Player").slice(0, 20).trim() || "Player";

    if (this.gameState.status !== "lobby") {
      const existing = [...this.gameState.players.values()].find(
        (p) => p.username === username && !p.connected,
      );
      if (existing) {
        this.handleReconnect(client, existing);
        return;
      }
      client.leave(4000);
      return;
    }

    // Cegah username duplikat di lobby yang sama. Ini bisa terjadi kalau client
    // sempat connect dua kali secara tidak sengaja (misalnya akibat bug re-mount
    // di frontend, atau dua tab browser dengan localStorage yang sama). Tanpa guard
    // ini, dua slot pemain dengan nama sama bisa muncul berdampingan di satu room.
    const duplicate = [...this.gameState.players.values()].find(
      (p) => p.username === username && p.connected,
    );
    if (duplicate) {
      this.log.warn({ username }, "Rejected duplicate username join in lobby");
      this.sendToClient(client, {
        type: "ERROR",
        message: `Username "${username}" sudah dipakai di room ini. Coba username lain.`,
      });
      client.leave(4001);
      return;
    }

    const player: Player = {
      sessionId: client.sessionId,
      username,
      hand: [],
      isAlive: true,
      hasBunker: false,
      isLocked: false,
      connected: true,
    };

    this.gameState.players.set(client.sessionId, player);
    this.gameState.turnOrder.push(client.sessionId);

    if (this.gameState.hostId === "") {
      this.gameState.hostId = client.sessionId;
    }

    this.log.info(
      { username, count: this.gameState.players.size },
      "Player joined",
    );

    this.broadcastState();
    this.sendToClient(client, { type: "YOUR_HAND", cards: [] });
  }

  onLeave(client: Client, _consented: boolean) {
    const player = this.gameState.players.get(client.sessionId);
    if (!player) return;

    if (this.gameState.status === "lobby") {
      this.gameState.players.delete(client.sessionId);
      this.gameState.turnOrder = this.gameState.turnOrder.filter(
        (id) => id !== client.sessionId,
      );

      if (
        this.gameState.hostId === client.sessionId &&
        this.gameState.turnOrder.length > 0
      ) {
        this.gameState.hostId = this.gameState.turnOrder[0];
      }

      this.log.info({ username: player.username }, "Player left lobby");
    } else {
      const newPlayers = new Map(this.gameState.players);
      newPlayers.set(client.sessionId, { ...player, connected: false });
      this.gameState = { ...this.gameState, players: newPlayers };

      this.log.info(
        { username: player.username },
        "Player disconnected mid-game",
      );

      this.clock.setTimeout(() => {
        const p = this.gameState.players.get(client.sessionId);
        if (p && !p.connected) {
          this.eliminateDisconnected(client.sessionId);
        }
      }, RECONNECT_TIMEOUT_MS);
    }

    this.broadcastState();
  }

  onDispose() {
    this.log.info("Room disposed");
  }

  // ============================================================
  // RECONNECT
  // ============================================================
  private handleReconnect(client: Client, existing: Player) {
    const newPlayers = new Map(this.gameState.players);
    newPlayers.delete(existing.sessionId);
    const updatedPlayer = {
      ...existing,
      sessionId: client.sessionId,
      connected: true,
    };
    newPlayers.set(client.sessionId, updatedPlayer);

    this.gameState = {
      ...this.gameState,
      players: newPlayers,
      turnOrder: this.gameState.turnOrder.map((id) =>
        id === existing.sessionId ? client.sessionId : id,
      ),
      hostId:
        this.gameState.hostId === existing.sessionId
          ? client.sessionId
          : this.gameState.hostId,
    };

    this.log.info({ username: existing.username }, "Player reconnected");
    this.sendToClient(client, { type: "YOUR_HAND", cards: updatedPlayer.hand });
    this.broadcastState();
  }

  // ============================================================
  // ELIMINATE DISCONNECTED
  // ============================================================
  private eliminateDisconnected(sessionId: string) {
    const player = this.gameState.players.get(sessionId);
    if (!player || !player.isAlive) return;

    const newPlayers = new Map(this.gameState.players);
    newPlayers.set(sessionId, { ...player, isAlive: false, hand: [] });
    this.gameState = { ...this.gameState, players: newPlayers };

    const alivePlayers = [...newPlayers.values()].filter((p) => p.isAlive);
    if (alivePlayers.length === 1) {
      this.gameState = {
        ...this.gameState,
        status: "finished",
        winner: alivePlayers[0].sessionId,
        log: [
          ...this.gameState.log,
          {
            timestamp: Date.now(),
            message: `${player.username} dieliminasi karena disconnect. ${alivePlayers[0].username} menang! 🏆`,
            type: "win",
          },
        ],
      };
      this.log.info(
        { winner: alivePlayers[0].username },
        "Game finished via disconnect elimination",
      );
    } else {
      const current = getCurrentPlayer(this.gameState);
      if (current?.sessionId === sessionId) {
        this.gameState = advanceTurn(this.gameState);
      }
    }

    this.broadcastState();
  }

  // ============================================================
  // MESSAGE HANDLER — dengan Zod validation
  // ============================================================
  private handleMessage(client: Client, type: string, payload: unknown) {
    if (!isValidMessageType(type)) {
      this.sendError(client, `Unknown message type: ${type}`);
      return;
    }

    const schema = MESSAGE_SCHEMAS[type];
    const result = schema.safeParse(payload ?? {});

    if (!result.success) {
      this.log.warn(
        { type, issues: result.error.issues },
        "Invalid message payload",
      );
      this.sendError(client, `Payload tidak valid untuk ${type}`);
      return;
    }

    try {
      switch (type) {
        case "START_GAME":
          this.handleStartGame(client);
          break;
        case "DRAW_CARD":
          this.handleDrawCard(client);
          break;
        case "PLAY_CARD": {
          const data = result.data as { cardId: string; targetId?: string };
          this.handlePlayCard(client, data.cardId, data.targetId);
          break;
        }
        case "PLAY_GANG": {
          const data = result.data as {
            cardIds: string[];
            targetId?: string;
            targetCardId?: string;
          };
          this.handlePlayGang(
            client,
            data.cardIds,
            data.targetId,
            data.targetCardId,
          );
          break;
        }
        case "USE_WATER_BUCKET": {
          const data = result.data as { insertPosition: number };
          this.handleWaterBucket(client, data.insertPosition);
          break;
        }
        case "BRIBE_GIVE_CARD": {
          const data = result.data as { cardId: string };
          this.handleBribeGive(client, data.cardId);
          break;
        }
        case "PEEK_SWAP_DECISION": {
          const data = result.data as { swap: boolean; cardId?: string };
          this.handlePeekSwap(client, data.swap, data.cardId);
          break;
        }
        case "FLOOD_DISCARD": {
          const data = result.data as { cardId: string };
          this.handleFloodDiscard(client, data.cardId);
          break;
        }
        case "FREEZE_PLAY":
          this.handleFreeze(client);
          break;
        case "GANG_RAINBOW_CONFIRM": {
          const data = result.data as { targetId: string };
          this.handleGangRainbow(client, data.targetId);
          break;
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      this.log.error({ type, err: message }, "Error handling message");
      this.sendError(client, message);
    }
  }

  // ============================================================
  // HANDLERS
  // ============================================================
  private handleStartGame(client: Client) {
    if (client.sessionId !== this.gameState.hostId)
      throw new Error("Hanya host yang bisa mulai game!");
    if (this.gameState.status !== "lobby")
      throw new Error("Game sudah berjalan!");
    if (this.gameState.players.size < MIN_PLAYERS)
      throw new Error(`Minimal ${MIN_PLAYERS} pemain!`);

    this.gameState = setupGame(this.gameState);
    this.broadcastState();
    this.log.info({ players: this.gameState.players.size }, "Game started");
  }

  private handleDrawCard(client: Client) {
    const current = getCurrentPlayer(this.gameState);
    if (current?.sessionId !== client.sessionId)
      throw new Error("Bukan giliran kamu!");
    if (this.gameState.pendingAction)
      throw new Error("Selesaikan aksi yang pending dulu!");

    const player = this.gameState.players.get(client.sessionId)!;
    if (player.isLocked) {
      const newPlayers = new Map(this.gameState.players);
      newPlayers.set(client.sessionId, { ...player, isLocked: false });
      this.gameState = { ...this.gameState, players: newPlayers };
    }

    const result = drawCard(this.gameState, client.sessionId);
    this.gameState = result.state;

    this.broadcastState();
    this.sendHandUpdate(client.sessionId);

    if (this.gameState.peekResult?.sessionId === client.sessionId) {
      this.sendToClient(client, {
        type: "PEEK_RESULT",
        cards: this.gameState.peekResult.cards,
      });
    }
  }

  private handlePlayCard(client: Client, cardId: string, targetId?: string) {
    validatePlayCard(this.gameState, client.sessionId, cardId);

    this.gameState = playCard(
      this.gameState,
      client.sessionId,
      cardId,
      targetId,
    );
    this.broadcastState();
    this.sendHandUpdate(client.sessionId);

    if (targetId) {
      this.sendHandUpdate(targetId);
    }

    if (this.gameState.peekResult?.sessionId === client.sessionId) {
      this.sendToClient(client, {
        type: "PEEK_RESULT",
        cards: this.gameState.peekResult.cards,
      });
    }
  }

  private handlePlayGang(
    client: Client,
    cardIds: string[],
    targetId?: string,
    targetCardId?: string,
  ) {
    const current = getCurrentPlayer(this.gameState);
    if (current?.sessionId !== client.sessionId)
      throw new Error("Bukan giliran kamu!");

    this.gameState = playGang(
      this.gameState,
      client.sessionId,
      cardIds,
      targetId,
      targetCardId,
    );
    this.broadcastState();
    this.sendHandUpdate(client.sessionId);

    if (targetId) {
      this.sendHandUpdate(targetId);
    } else if (cardIds.length === 4) {
      for (const pid of this.gameState.turnOrder) {
        if (pid !== client.sessionId) this.sendHandUpdate(pid);
      }
    }
  }

  private handleWaterBucket(client: Client, insertPosition: number) {
    const pa = this.gameState.pendingAction;
    if (!pa || pa.type !== "WATER_BUCKET_PLACE")
      throw new Error("Tidak ada Water Bucket pending!");
    if (pa.initiatorId !== client.sessionId)
      throw new Error("Bukan kamu yang pakai Water Bucket!");

    const lavaCatCard = pa.data?.lavaCatCard as Card;
    this.gameState = placeLavaCat(this.gameState, lavaCatCard, insertPosition);
    this.broadcastState();
  }

  private handleBribeGive(client: Client, cardId: string) {
    const pa = this.gameState.pendingAction;
    if (!pa || pa.type !== "BRIBE_WAITING")
      throw new Error("Tidak ada Bribe aktif!");
    if (pa.targetId !== client.sessionId)
      throw new Error("Bukan kamu yang harus kasih kartu!");

    this.gameState = resolveBribe(this.gameState, client.sessionId, cardId);
    this.broadcastState();
    this.sendHandUpdate(pa.initiatorId);
    this.sendHandUpdate(client.sessionId);
  }

  private handlePeekSwap(client: Client, doSwap: boolean, cardId?: string) {
    const pa = this.gameState.pendingAction;
    if (!pa || pa.type !== "PEEK_AND_SWAP_DECIDE")
      throw new Error("Tidak ada Peek & Swap aktif!");
    if (pa.initiatorId !== client.sessionId)
      throw new Error("Bukan kamu yang main Peek & Swap!");

    this.gameState = resolvePeekAndSwap(
      this.gameState,
      client.sessionId,
      doSwap,
      cardId,
    );
    this.broadcastState();
    this.sendHandUpdate(client.sessionId);
  }

  private handleFloodDiscard(client: Client, cardId: string) {
    const pa = this.gameState.pendingAction;
    if (!pa) throw new Error("Tidak ada aksi aktif!");

    if (pa.type === "FLOOD_WAITING" && !pa.data?.isTimeWarp) {
      const player = this.gameState.players.get(client.sessionId)!;
      if (!player.isAlive) throw new Error("Kamu sudah mati!");
      if (pa.floodDiscarded?.includes(client.sessionId))
        throw new Error("Kamu sudah buang kartu!");

      this.gameState = resolveFloodDiscard(
        this.gameState,
        client.sessionId,
        cardId,
      );
    } else if (pa.data?.isTimeWarp && pa.initiatorId === client.sessionId) {
      this.gameState = resolveTimeWarp(
        this.gameState,
        client.sessionId,
        cardId,
      );
    } else {
      throw new Error("Bukan giliranmu untuk aksi ini!");
    }

    this.broadcastState();
    this.sendHandUpdate(client.sessionId);
  }

  private handleFreeze(client: Client) {
    const player = this.gameState.players.get(client.sessionId)!;
    const freezeCard = player.hand.find((c) => c.type === "FREEZE");
    if (!freezeCard) throw new Error("Tidak punya kartu Freeze!");

    this.gameState = playFreeze(
      this.gameState,
      client.sessionId,
      freezeCard.id,
    );
    this.broadcastState();
    this.sendHandUpdate(client.sessionId);
  }

  private handleGangRainbow(client: Client, targetId: string) {
    const pa = this.gameState.pendingAction;
    if (!pa || pa.type !== "GANG_RAINBOW_TARGET")
      throw new Error("Tidak ada Rainbow Gang aktif!");
    if (pa.initiatorId !== client.sessionId)
      throw new Error("Bukan kamu yang main Rainbow Gang!");

    this.gameState = executeGangRainbow(
      this.gameState,
      client.sessionId,
      targetId,
    );
    this.broadcastState();
    this.sendHandUpdate(client.sessionId);
    this.sendHandUpdate(targetId);
  }

  // ============================================================
  // BROADCAST HELPERS
  // ============================================================
  private broadcastState() {
    for (const client of this.clients) {
      const state = serializeForClient(this.gameState, client.sessionId);
      this.sendToClient(client, { type: "GAME_STATE_UPDATE", state });
    }
  }

  private sendHandUpdate(sessionId: string) {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    const player = this.gameState.players.get(sessionId);
    if (client && player) {
      this.sendToClient(client, { type: "YOUR_HAND", cards: player.hand });
    }
  }

  private sendToClient(client: Client, message: object) {
    try {
      client.send("message", message);
    } catch (err) {
      this.log.warn(
        { sessionId: client.sessionId, err },
        "Failed to send to client",
      );
    }
  }

  private sendError(client: Client, message: string) {
    this.sendToClient(client, { type: "ERROR", message });
  }
}
