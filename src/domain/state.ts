// ============================================================
// INTERNAL GAME STATE  (server-only, full information)
// ============================================================
// Richer than the client-facing ClientGameState: it holds full hands,
// the full deck, and private data for in-flight phases (the held action
// in the freeze window, the Lava Cat awaiting placement, etc.). The
// serializer (serialize.ts) projects this down to a per-viewer
// ClientGameState that hides everything a player isn't entitled to see.
//
// State is a plain, immutable, serializable object. Randomness and the
// clock are injected via Ctx — never read from globals inside the engine.
// ============================================================

import { randomUUID } from "node:crypto";
import type {
  Card,
  Phase,
  GameStatus,
  PeekMode,
} from "../shared/protocol";
import type { GameEvent, TurnDirection } from "../shared/events";
import type { CardType, GangCombo } from "../shared/cards";
import type { Rng } from "./rng";

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  alive: boolean;
  hasBunker: boolean;
  /** Hit by Lockdown: on their next turn they may only draw, not play. */
  locked: boolean;
  connected: boolean;
  /** Manual AFK toggle. Either `away` or `!connected` triggers auto-resolution. */
  away: boolean;
}

/** Full private description of the interruptible action sitting in the freeze window. */
export interface HeldAction {
  id: string;
  actorId: string;
  cardType: CardType;
  /** The actual card object(s) pulled from hand (1 normally; 2–5 for a gang combo). */
  cards: Card[];
  combo?: GangCombo;
  targetId?: string;
  /** Triple Gang: the card type the actor named to steal. */
  declaredType?: CardType;
}

export interface GameState {
  roomId: string;
  status: GameStatus;
  hostId: string;
  players: Record<string, Player>;
  turnOrder: string[];
  currentTurnIndex: number;
  direction: TurnDirection;
  /** Turns the current player still owes (Attack/Eruption stacking); ≥1 while playing. */
  turnsRemaining: number;
  deck: Card[]; // top of deck = LAST element
  discard: Card[]; // top = LAST element
  phase: Phase;
  // ---- private phase extras (NEVER serialized to clients) ----
  held: HeldAction | null; // backs `nope_window`
  bucketCard: Card | null; // backs `await_bucket`: the Lava Cat to be re-inserted
  winnerId: string | null;
  log: GameEvent[]; // full history; serializer trims for clients
}

/** Randomness + clock + the acting player, injected into every reducer call. */
export interface Ctx {
  rng: Rng;
  now: number; // ms epoch
  actorId: string; // the player id issuing the command
}

/** A one-time private card reveal the transport layer must push to a single player. */
export interface PrivateReveal {
  playerId: string;
  mode: PeekMode;
  cards: Card[];
}

export interface EngineResult {
  state: GameState;
  /** Events produced by this step (already appended to state.log too). */
  events: GameEvent[];
  /** Private reveals (Spy / Peek&Swap / Pickpocket) for the transport to deliver. */
  reveals: PrivateReveal[];
}

export const FREEZE_WINDOW_MS = 4000;

// ------------------------------------------------------------
// Construction & immutable helpers
// ------------------------------------------------------------
export function makeCard(type: CardType): Card {
  return { id: randomUUID(), type };
}

export function makeCards(type: CardType, n: number): Card[] {
  return Array.from({ length: n }, () => makeCard(type));
}

export function getPlayer(state: GameState, id: string): Player {
  const p = state.players[id];
  if (!p) throw new Error(`Unknown player: ${id}`);
  return p;
}

/** Return a new state with `id`'s player shallow-merged with `patch`. */
export function withPlayer(
  state: GameState,
  id: string,
  patch: Partial<Player>,
): GameState {
  const prev = getPlayer(state, id);
  return {
    ...state,
    players: { ...state.players, [id]: { ...prev, ...patch } },
  };
}

/** Return a new state with multiple players patched at once. */
export function withPlayers(
  state: GameState,
  patches: Record<string, Partial<Player>>,
): GameState {
  const players = { ...state.players };
  for (const [id, patch] of Object.entries(patches)) {
    players[id] = { ...players[id], ...patch };
  }
  return { ...state, players };
}

export function livingPlayers(state: GameState): Player[] {
  return state.turnOrder
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p && p.alive);
}

export function isOffline(p: Player): boolean {
  return p.away || !p.connected;
}
