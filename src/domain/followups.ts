// ============================================================
// FOLLOW-UP resolvers — multi-step inputs after an effect resolves
// ============================================================
// These finish the phases opened by certain effects (Favor gift, Peek &
// Swap decision, Flood discards, Time Warp pick, Pickpocket choice) and
// then resume the actor's turn. Each is pure and routes through the same
// state helpers as the rest of the engine.
// ============================================================

import type { GameEvent } from "../shared/events";
import type { GameState, EngineResult } from "./state";
import { getPlayer, withPlayer, withPlayers } from "./state";
import { resumeTurnPhase } from "./turn";

function resume(state: GameState, events: GameEvent[]): EngineResult {
  return { state: resumeTurnPhase(state), events, reveals: [] };
}

/** Favor: the `fromId` player gives a chosen card to `toId`. */
export function resolveFavor(state: GameState, fromId: string, cardId: string): EngineResult {
  if (state.phase.kind !== "await_favor" || state.phase.fromId !== fromId) {
    throw new Error("No favor awaiting this player");
  }
  const toId = state.phase.toId;
  const from = getPlayer(state, fromId);
  const idx = from.hand.findIndex((c) => c.id === cardId);
  if (idx === -1) throw new Error("Card not in hand");
  const card = from.hand[idx];
  const to = getPlayer(state, toId);
  const s = withPlayers(state, {
    [fromId]: { hand: from.hand.filter((_, i) => i !== idx) },
    [toId]: { hand: [...to.hand, card] },
  });
  return resume(s, [{ kind: "GIFT_GIVEN", fromId, toId }]);
}

/** Peek & Swap: optionally swap a hand card with the (already revealed) deck top. */
export function resolvePeekSwap(
  state: GameState,
  playerId: string,
  swap: boolean,
  cardId?: string,
): EngineResult {
  if (state.phase.kind !== "await_peek_swap" || state.phase.playerId !== playerId) {
    throw new Error("No peek decision awaiting this player");
  }
  if (!swap) {
    return resume(state, [{ kind: "PEEK_SWAPPED", actorId: playerId, swapped: false }]);
  }
  if (!cardId) throw new Error("Must choose a card to swap");
  const player = getPlayer(state, playerId);
  const handIdx = player.hand.findIndex((c) => c.id === cardId);
  if (handIdx === -1) throw new Error("Card not in hand");
  if (state.deck.length === 0) {
    return resume(state, [{ kind: "PEEK_SWAPPED", actorId: playerId, swapped: false }]);
  }
  const topIdx = state.deck.length - 1;
  const topCard = state.deck[topIdx];
  const handCard = player.hand[handIdx];

  const newHand = [...player.hand];
  newHand[handIdx] = topCard;
  const newDeck = [...state.deck];
  newDeck[topIdx] = handCard;

  const s = { ...withPlayer(state, playerId, { hand: newHand }), deck: newDeck };
  return resume(s, [{ kind: "PEEK_SWAPPED", actorId: playerId, swapped: true }]);
}

/** Flood: one player discards a chosen card; resumes once everyone has discarded. */
export function resolveFloodDiscard(
  state: GameState,
  playerId: string,
  cardId: string,
): EngineResult {
  if (state.phase.kind !== "await_flood") throw new Error("No flood in progress");
  if (!state.phase.pending.includes(playerId)) throw new Error("Not awaiting your discard");
  const player = getPlayer(state, playerId);
  const idx = player.hand.findIndex((c) => c.id === cardId);
  if (idx === -1) throw new Error("Card not in hand");
  const card = player.hand[idx];

  let s: GameState = {
    ...withPlayer(state, playerId, { hand: player.hand.filter((_, i) => i !== idx) }),
    discard: [...state.discard, card],
  };
  const pending = state.phase.pending.filter((id) => id !== playerId);
  const events: GameEvent[] = [{ kind: "FLOOD_DISCARDED", playerId }];

  if (pending.length === 0) {
    return resume(s, events);
  }
  s = { ...s, phase: { kind: "await_flood", pending } };
  return { state: s, events, reveals: [] };
}

/** Time Warp: take a chosen card from the discard pile into hand. */
export function resolveTimeWarp(state: GameState, playerId: string, cardId: string): EngineResult {
  if (state.phase.kind !== "await_timewarp" || state.phase.playerId !== playerId) {
    throw new Error("No time warp awaiting this player");
  }
  const idx = state.discard.findIndex((c) => c.id === cardId);
  if (idx === -1) throw new Error("Card not in discard pile");
  const card = state.discard[idx];
  const player = getPlayer(state, playerId);
  const s: GameState = {
    ...withPlayer(state, playerId, { hand: [...player.hand, card] }),
    discard: state.discard.filter((_, i) => i !== idx),
  };
  return resume(s, [{ kind: "TIME_WARPED", actorId: playerId }]);
}

/** Pickpocket (redesigned): take a chosen card from the target's revealed hand. */
export function resolvePickpocketTake(
  state: GameState,
  playerId: string,
  cardId: string,
): EngineResult {
  if (state.phase.kind !== "await_pickpocket" || state.phase.playerId !== playerId) {
    throw new Error("No pickpocket awaiting this player");
  }
  const targetId = state.phase.targetId;
  const target = getPlayer(state, targetId);
  const idx = target.hand.findIndex((c) => c.id === cardId);
  if (idx === -1) throw new Error("Card not in target's hand");
  const card = target.hand[idx];
  const me = getPlayer(state, playerId);
  const s = withPlayers(state, {
    [targetId]: { hand: target.hand.filter((_, i) => i !== idx) },
    [playerId]: { hand: [...me.hand, card] },
  });
  // Public event hides the card identity (only the pickpocket saw the hand).
  return resume(s, [{ kind: "STEAL_RANDOM", actorId: playerId, targetId }]);
}
