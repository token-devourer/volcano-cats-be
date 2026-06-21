// ============================================================
// SERIALIZE — project internal state to a per-viewer ClientGameState
// ============================================================
// Hides everything a viewer isn't entitled to see: other players' hand
// contents (only counts), the deck contents (only the count), and all
// private phase data (the held action's cards, the Lava Cat awaiting
// placement). The public `phase` is leak-free by construction, so it is
// passed through as-is. A viewer's own hand is delivered separately via
// the HAND message (see handFor).
// ============================================================

import type { Card } from "../shared/protocol";
import type { ClientGameState, ClientPlayer } from "../shared/protocol";
import type { GameState } from "./state";

const DISCARD_VISIBLE = 8;
const LOG_VISIBLE = 40;

export function serializeForViewer(state: GameState): ClientGameState {
  const players: ClientPlayer[] = state.turnOrder
    .map((id) => state.players[id])
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
      alive: p.alive,
      hasBunker: p.hasBunker,
      locked: p.locked,
      connected: p.connected,
      away: p.away,
      isHost: state.hostId === p.id,
    }));

  return {
    roomId: state.roomId,
    status: state.status,
    hostId: state.hostId,
    players,
    turnOrder: state.turnOrder,
    currentTurnIndex: state.currentTurnIndex,
    direction: state.direction,
    turnsRemaining: state.turnsRemaining,
    deckCount: state.deck.length,
    discardTop: state.discard.slice(-DISCARD_VISIBLE),
    phase: state.phase,
    winnerId: state.winnerId,
    log: state.log.slice(-LOG_VISIBLE),
  };
}

/** A viewer's own hand (delivered privately, never broadcast). */
export function handFor(state: GameState, viewerId: string): Card[] {
  return state.players[viewerId]?.hand ?? [];
}
