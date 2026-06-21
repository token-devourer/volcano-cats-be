// ============================================================
// TURN management — advancement, attack stacking, lock clearing, win
// ============================================================
// `turnsRemaining` = the number of turns the CURRENT player still owes.
// It is 1 on a normal turn and grows when an Attack/Eruption stacks onto
// them. Ending a turn (by drawing or Skip) consumes exactly one owed
// turn; if more remain the same player goes again, otherwise play moves
// to the next living player.
//
// Lockdown semantics: a locked player's lock is consumed (cleared) when
// their turn ENDS — guaranteeing it lasts exactly one turn whether they
// drew manually or were auto-played. (Fixes the old never-clears /
// auto-play-bypass bug.)
// ============================================================

import type { GameEvent } from "../shared/events";
import type { GameState } from "./state";
import { getPlayer, livingPlayers } from "./state";

export function currentPlayerId(state: GameState): string {
  return state.turnOrder[state.currentTurnIndex];
}

/** Index of the next living player from `fromIndex` in `dir`, skipping the dead. */
export function nextLivingIndex(
  state: GameState,
  fromIndex: number,
  dir: 1 | -1,
): number {
  const n = state.turnOrder.length;
  let idx = (fromIndex + dir + n) % n;
  for (let guard = 0; guard < n; guard++) {
    if (state.players[state.turnOrder[idx]]?.alive) return idx;
    idx = (idx + dir + n) % n;
  }
  return state.currentTurnIndex; // everyone else dead (game is ending anyway)
}

function startTurnEvents(state: GameState): GameEvent[] {
  return [{ kind: "TURN_STARTED", playerId: currentPlayerId(state) }];
}

function setTurnPhase(state: GameState): GameState {
  return { ...state, phase: { kind: "turn", playerId: currentPlayerId(state) } };
}

/**
 * Set the phase back to the current player's turn WITHOUT emitting a new
 * TURN_STARTED — used to resume an in-progress turn after a follow-up phase
 * (Favor, Peek, Flood, a forced draw, etc.) finishes.
 */
export function resumeTurnPhase(state: GameState): GameState {
  return setTurnPhase(state);
}

/** Clear the (departing) current player's Lockdown as their turn ends. */
function clearDepartingLock(state: GameState): GameState {
  const id = currentPlayerId(state);
  if (!state.players[id]?.locked) return state;
  return { ...state, players: { ...state.players, [id]: { ...state.players[id], locked: false } } };
}

/**
 * Move play to the next living player (a fresh single turn), discarding any
 * turns the departing player still owed. Used when the current player is
 * eliminated or when an effect unconditionally passes the turn.
 */
export function advanceToNext(state: GameState): { state: GameState; events: GameEvent[] } {
  let next = clearDepartingLock(state);
  const idx = nextLivingIndex(next, next.currentTurnIndex, next.direction);
  next = { ...next, currentTurnIndex: idx, turnsRemaining: 1 };
  next = setTurnPhase(next);
  return { state: next, events: startTurnEvents(next) };
}

const moveToNext = advanceToNext;

/**
 * Consume one owed turn (called after a draw or a Skip). If the current
 * player still owes turns, they go again; otherwise play advances.
 */
export function consumeTurn(state: GameState): { state: GameState; events: GameEvent[] } {
  const remaining = state.turnsRemaining - 1;
  if (remaining > 0) {
    const next = setTurnPhase({ ...state, turnsRemaining: remaining });
    return { state: next, events: startTurnEvents(next) };
  }
  return moveToNext(state);
}

/**
 * Attack/Eruption: the current player ends ALL their owed turns now and
 * the next player inherits them plus 2. Documented stacking rule:
 *   nextOwed = (turnsRemaining - 1) + 2
 * So a normal turn (owe 1) hands the next player 2 turns; a player already
 * owing R hands over R+1.
 */
export function applyAttack(state: GameState): { state: GameState; nextOwed: number; events: GameEvent[] } {
  const nextOwed = (state.turnsRemaining - 1) + 2;
  let next = clearDepartingLock(state);
  const idx = nextLivingIndex(next, next.currentTurnIndex, next.direction);
  next = { ...next, currentTurnIndex: idx, turnsRemaining: nextOwed };
  next = setTurnPhase(next);
  return { state: next, nextOwed, events: startTurnEvents(next) };
}

/** The id of the player who would take the next turn (for Eruption messaging). */
export function nextLivingPlayerId(state: GameState): string {
  return state.turnOrder[nextLivingIndex(state, state.currentTurnIndex, state.direction)];
}

/**
 * If one or zero players remain alive, end the game. Returns the finished
 * state + WIN event, or null if the game continues.
 */
export function checkWin(state: GameState): { state: GameState; events: GameEvent[] } | null {
  const alive = livingPlayers(state);
  if (alive.length > 1) return null;
  const winner = alive[0] ?? null;
  return {
    state: {
      ...state,
      status: "finished",
      winnerId: winner?.id ?? null,
      phase: { kind: "finished", winnerId: winner?.id ?? null },
    },
    events: winner ? [{ kind: "WIN", playerId: winner.id }] : [],
  };
}

/** Number of living players (helper for effects). */
export function livingCount(state: GameState): number {
  return livingPlayers(state).length;
}

export { getPlayer };
