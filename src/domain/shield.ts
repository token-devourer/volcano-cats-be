// ============================================================
// SHIELD — Bunker interception (single chokepoint)
// ============================================================
// Bunker cancels the FIRST negative effect a player would receive, then
// breaks. Every effect that harms a target (forced draw, steal, gift,
// hand-swap, lockdown, flood discard, raid) routes through here, so the
// shield is consistent across the whole game instead of being checked
// ad-hoc in a few effects.
// ============================================================

import type { GameEvent } from "../shared/events";
import type { GameState } from "./state";
import { getPlayer, withPlayer } from "./state";

export interface ShieldResult {
  state: GameState;
  shielded: boolean;
  events: GameEvent[];
}

/**
 * If `playerId` has a Bunker, consume it and report `shielded: true` so the
 * caller skips the harmful effect. Otherwise a no-op with `shielded: false`.
 */
export function tryShield(state: GameState, playerId: string): ShieldResult {
  const p = getPlayer(state, playerId);
  if (!p.alive || !p.hasBunker) {
    return { state, shielded: false, events: [] };
  }
  return {
    state: withPlayer(state, playerId, { hasBunker: false }),
    shielded: true,
    events: [{ kind: "BUNKER_SAVED", playerId }],
  };
}
