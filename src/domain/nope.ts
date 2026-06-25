// ============================================================
// NOPE / FREEZE window — the counter stack
// ============================================================
// When an interruptible action is played it sits in a freeze window.
// Any player holding a Freeze may counter it; a Freeze can itself be
// countered (Freeze-the-Freeze), so we track a STACK by parity:
//   freezeCount even  → the action resolves
//   freezeCount odd   → the action is negated (fizzles)
// Each Freeze re-opens the window so the next player can respond. This
// makes Freeze genuinely counterable, matching its card text.
// ============================================================

import type { GameEvent } from "../shared/events";
import type { PendingAction } from "../shared/protocol";
import type { GameState, HeldAction, EngineResult } from "./state";
import { FREEZE_WINDOW_MS, getPlayer, withPlayer } from "./state";
import { resumeTurnPhase } from "./turn";
import { resolveEffect } from "./effects";
import type { Rng } from "./rng";

function toPending(held: HeldAction): PendingAction {
  return {
    id: held.id,
    actorId: held.actorId,
    cardType: held.cardType,
    combo: held.combo,
    targetId: held.targetId,
    declaredType: held.declaredType,
  };
}

/** Put a freshly-played interruptible action into the freeze window. */
export function openNopeWindow(state: GameState, held: HeldAction, now: number): GameState {
  return {
    ...state,
    held,
    phase: {
      kind: "nope_window",
      pending: toPending(held),
      endsAt: now + FREEZE_WINDOW_MS,
      freezeDuration: FREEZE_WINDOW_MS,
      freezeCount: 0,
    },
  };
}

/**
 * A player counters the current window with a Freeze. Removes their Freeze
 * card, flips the negation parity, and re-opens the window.
 */
export function applyFreeze(state: GameState, freezerId: string, now: number): EngineResult {
  if (state.phase.kind !== "nope_window") throw new Error("No action to freeze");
  const player = getPlayer(state, freezerId);
  const idx = player.hand.findIndex((c) => c.type === "FREEZE");
  if (idx === -1) throw new Error("No Freeze card");

  const freezeCard = player.hand[idx];
  let s = withPlayer(state, freezerId, { hand: player.hand.filter((_, i) => i !== idx) });
  s = { ...s, discard: [...s.discard, freezeCard] };

  const freezeCount = state.phase.freezeCount + 1;
  s = {
    ...s,
    phase: { ...state.phase, freezeCount, endsAt: now + FREEZE_WINDOW_MS, freezeDuration: FREEZE_WINDOW_MS },
  };
  const negated = freezeCount % 2 === 1;
  return { state: s, events: [{ kind: "NOPE_PLAYED", actorId: freezerId, negated }], reveals: [] };
}

/**
 * Resolve the window when its timer fires. If the negation parity is odd the
 * action fizzles; otherwise its effect applies. Either way the held action is
 * cleared. Caller (transport) must guard that the same window is still active.
 */
export function resolveNopeWindow(state: GameState, rng: Rng): EngineResult {
  if (state.phase.kind !== "nope_window" || !state.held) {
    throw new Error("No freeze window to resolve");
  }
  const held = state.held;
  const negated = state.phase.freezeCount % 2 === 1;

  if (negated) {
    return {
      state: resumeTurnPhase({ ...state, held: null }),
      events: [{ kind: "ACTION_NEGATED", cardType: held.cardType }],
      reveals: [],
    };
  }
  return resolveEffect({ ...state, held: null }, held, rng);
}
