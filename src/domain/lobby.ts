// ============================================================
// LOBBY / presence — player roster & connection management
// ============================================================
// Pure helpers the transport layer uses to mutate the roster in the
// lobby and to track connection state mid-game. Reconnection relies on
// Colyseus `allowReconnection` (the sessionId is preserved), so coming
// back online is just flipping `connected` — no id remapping needed.
// ============================================================

import { randomUUID } from "node:crypto";
import type { GameState, Player } from "./state";

export function createInitialState(roomId: string): GameState {
  return {
    roomId,
    status: "lobby",
    hostId: "",
    players: {},
    turnOrder: [],
    currentTurnIndex: 0,
    direction: 1,
    turnsRemaining: 1,
    deck: [],
    discard: [],
    phase: { kind: "lobby" },
    held: null,
    bucketCard: null,
    winnerId: null,
    log: [],
  };
}

export function makePlayer(id: string, name: string): Player {
  return {
    id,
    name,
    hand: [],
    alive: true,
    hasBunker: false,
    locked: false,
    connected: true,
    away: false,
  };
}

/** Add a player to a lobby. Assigns host if the room had none. */
export function addPlayer(state: GameState, id: string, name: string): GameState {
  if (state.players[id]) return state;
  const players = { ...state.players, [id]: makePlayer(id, name) };
  const turnOrder = [...state.turnOrder, id];
  const hostId = state.hostId === "" ? id : state.hostId;
  return { ...state, players, turnOrder, hostId };
}

/** Remove a player while still in the lobby; reassigns host if they were it. */
export function removePlayerFromLobby(state: GameState, id: string): GameState {
  if (!state.players[id]) return state;
  const players = { ...state.players };
  delete players[id];
  const turnOrder = state.turnOrder.filter((x) => x !== id);
  const hostId = state.hostId === id ? (turnOrder[0] ?? "") : state.hostId;
  return { ...state, players, turnOrder, hostId };
}

export function setConnected(state: GameState, id: string, connected: boolean): GameState {
  if (!state.players[id]) return state;
  return {
    ...state,
    players: { ...state.players, [id]: { ...state.players[id], connected } },
  };
}

/** Is this username already taken by a connected player (lobby dedupe)? */
export function isNameTaken(state: GameState, name: string): boolean {
  return Object.values(state.players).some((p) => p.connected && p.name === name);
}

/** Find a disconnected player by name (for reconnection matching when needed). */
export function findDisconnectedByName(state: GameState, name: string): Player | undefined {
  return Object.values(state.players).find((p) => !p.connected && p.name === name);
}

export function newRoomId(): string {
  return randomUUID().slice(0, 8);
}
