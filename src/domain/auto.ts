// ============================================================
// AUTO-RESOLUTION — keep the game moving when input is owed by an
// away/disconnected player
// ============================================================
// The transport loops `nextAutoStep`: while the phase is waiting on input
// from an offline player, this returns the command that player would send
// (a safe, minimal default), which the transport applies via reduce. This
// removes every deadlock where an offline player owed an action — the old
// engine only auto-drew, so Flood / Favor / bucket placement could hang
// the whole room forever.
//
// The freeze window never blocks here: it resolves on a timer regardless,
// so offline players simply don't counter.
// ============================================================

import type { ClientCommand } from "../shared/protocol";
import type { GameState } from "./state";
import { getPlayer, isOffline } from "./state";
import { randInt, type Rng } from "./rng";

export interface AutoStep {
  actorId: string;
  cmd: ClientCommand;
}

/** The next auto command for an offline player who owes input, or null. */
export function nextAutoStep(state: GameState, rng: Rng): AutoStep | null {
  const phase = state.phase;
  switch (phase.kind) {
    case "turn": {
      const p = state.players[phase.playerId];
      if (p && isOffline(p)) return { actorId: p.id, cmd: { t: "DRAW" } };
      return null;
    }
    case "await_bucket": {
      const p = state.players[phase.playerId];
      if (p && isOffline(p)) {
        return { actorId: p.id, cmd: { t: "PLACE_BUCKET", position: randInt(state.deck.length + 1, rng) } };
      }
      return null;
    }
    case "await_favor": {
      const p = state.players[phase.fromId];
      if (p && isOffline(p) && p.hand.length > 0) {
        const card = p.hand[randInt(p.hand.length, rng)];
        return { actorId: p.id, cmd: { t: "GIVE_CARD", cardId: card.id } };
      }
      return null;
    }
    case "await_peek_swap": {
      const p = state.players[phase.playerId];
      if (p && isOffline(p)) return { actorId: p.id, cmd: { t: "PEEK_DECIDE", swap: false } };
      return null;
    }
    case "await_flood": {
      for (const id of phase.pending) {
        const p = state.players[id];
        if (p && isOffline(p) && p.hand.length > 0) {
          const card = p.hand[randInt(p.hand.length, rng)];
          return { actorId: id, cmd: { t: "FLOOD_DISCARD", cardId: card.id } };
        }
      }
      return null;
    }
    case "await_timewarp": {
      const p = state.players[phase.playerId];
      if (p && isOffline(p) && state.discard.length > 0) {
        const card = state.discard[state.discard.length - 1];
        return { actorId: p.id, cmd: { t: "TIMEWARP_PICK", cardId: card.id } };
      }
      return null;
    }
    case "await_pickpocket": {
      const p = state.players[phase.playerId];
      const target = state.players[phase.targetId];
      if (p && isOffline(p) && target && target.hand.length > 0) {
        const card = target.hand[randInt(target.hand.length, rng)];
        return { actorId: p.id, cmd: { t: "PICKPOCKET_TAKE", cardId: card.id } };
      }
      return null;
    }
    case "nope_window":
    case "lobby":
    case "finished":
      return null;
  }
}

/** Does the current phase require input from a player who is offline? */
export function needsAuto(state: GameState, rng: Rng): boolean {
  return nextAutoStep(state, rng) !== null;
}
