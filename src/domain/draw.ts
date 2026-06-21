// ============================================================
// DRAW — the only place a card leaves the deck into a player
// ============================================================
// Two modes, deliberately separated:
//   • "turn"   — the current player's own turn-ending draw. Consumes an
//                owed turn (or advances). If they die, play advances.
//   • "forced" — Sniper makes a *non-current* player draw out of turn.
//                This does NOT end or advance the sniper's turn.
// Separating these fixes the old Sniper bug where forcing a draw wrongly
// ran the turn-advancing path from the wrong player's index.
//
// Lava Cat handling, Water Bucket auto-use, and elimination all live here
// and route harm through the shield/win checks consistently.
// ============================================================

import type { GameEvent } from "../shared/events";
import type { GameState, EngineResult } from "./state";
import { getPlayer, withPlayer } from "./state";
import { ensureDrawable } from "./deck";
import { consumeTurn, advanceToNext, checkWin, currentPlayerId, resumeTurnPhase } from "./turn";
import type { Rng } from "./rng";

export type DrawMode = "turn" | "forced";

/** Resume the right phase after a (non-fatal, non-bucket) draw resolves. */
function resume(state: GameState, mode: DrawMode): { state: GameState; events: GameEvent[] } {
  if (mode === "forced") return { state: resumeTurnPhase(state), events: [] };
  return consumeTurn(state);
}

/** Resume after the drawing player is eliminated. */
function resumeAfterDeath(
  state: GameState,
  deadId: string,
  mode: DrawMode,
): { state: GameState; events: GameEvent[] } {
  const win = checkWin(state);
  if (win) return win;
  // The current player died on their own draw → advance. A forced victim
  // dying never owned the turn, so the sniper simply continues.
  if (mode === "turn" && deadId === currentPlayerId(state)) {
    return advanceToNext(state);
  }
  return { state: resumeTurnPhase(state), events: [] };
}

/**
 * Draw the top card for `playerId`. `mode` decides turn handling.
 * Returns the resulting state + events. (No private reveals here.)
 */
export function drawForPlayer(
  state: GameState,
  playerId: string,
  rng: Rng,
  mode: DrawMode,
): EngineResult {
  let s = ensureDrawable(state, rng);

  if (s.deck.length === 0) {
    // Nothing left anywhere to draw (degenerate). Don't crash: just move on.
    const r = mode === "forced" ? { state: resumeTurnPhase(s), events: [] } : consumeTurn(s);
    return { state: r.state, events: r.events, reveals: [] };
  }

  const card = s.deck[s.deck.length - 1];
  s = { ...s, deck: s.deck.slice(0, -1) };
  const player = getPlayer(s, playerId);

  // ---- Safe card ----
  if (card.type !== "LAVA_CAT") {
    s = withPlayer(s, playerId, { hand: [...player.hand, card] });
    const events: GameEvent[] = [{ kind: "CARD_DREW", playerId }];
    const r = resume(s, mode);
    return { state: r.state, events: [...events, ...r.events], reveals: [] };
  }

  // ---- Lava Cat ----
  const hasBucket = player.hand.some((c) => c.type === "WATER_BUCKET");
  const events: GameEvent[] = [{ kind: "LAVA_DRAWN", playerId, defused: hasBucket }];

  if (hasBucket) {
    // Consume one Water Bucket; the player must now place the Lava Cat back.
    const bucketIdx = player.hand.findIndex((c) => c.type === "WATER_BUCKET");
    const newHand = player.hand.filter((_, i) => i !== bucketIdx);
    s = withPlayer(s, playerId, { hand: newHand });
    s = {
      ...s,
      discard: [...s.discard, player.hand[bucketIdx]], // the spent bucket
      bucketCard: card,
      phase: { kind: "await_bucket", playerId },
    };
    return { state: s, events, reveals: [] };
  }

  // No bucket → eliminated. Their hand leaves play (into discard for recycling).
  s = {
    ...s,
    discard: [...s.discard, ...player.hand, card],
  };
  s = withPlayer(s, playerId, { alive: false, hand: [] });
  events.push({ kind: "ELIMINATED", playerId });
  const r = resumeAfterDeath(s, playerId, mode);
  return { state: r.state, events: [...events, ...r.events], reveals: [] };
}

/**
 * Place a previously-drawn Lava Cat back into the deck (resolves await_bucket).
 * `positionFromTop` is clamped. Then resume: a current-player placement ends
 * their turn; a forced victim's placement returns control to the current player.
 */
export function placeBucket(
  state: GameState,
  placerId: string,
  positionFromTop: number,
): EngineResult {
  const lava = state.bucketCard;
  if (!lava) throw new Error("No Lava Cat awaiting placement");
  // Insert from top (0 = top of deck = end of array).
  const clamped = Math.max(0, Math.min(positionFromTop, state.deck.length));
  const idx = state.deck.length - clamped;
  const deck = [...state.deck];
  deck.splice(idx, 0, lava);
  const s: GameState = { ...state, deck, bucketCard: null };

  const events: GameEvent[] = [{ kind: "BUCKET_PLACED", playerId: placerId }];
  // Current player's own draw → ends the turn. Forced victim → resume the
  // current (sniper's) turn.
  const r =
    placerId === currentPlayerId(s)
      ? consumeTurn(s)
      : { state: resumeTurnPhase(s), events: [] as GameEvent[] };
  return { state: r.state, events: [...events, ...r.events], reveals: [] };
}
