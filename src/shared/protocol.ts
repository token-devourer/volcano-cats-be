// ============================================================
// VOLCANO CATS — WIRE PROTOCOL  (shared FE ⇄ BE)
// ============================================================
// The contract between client and server. Both repos depend on the
// SAME definitions (mirrored copy). Cards travel as `{id,type}` only —
// names/descriptions/emoji are resolved from the catalog + i18n table
// on each side, so no display text crosses the wire.
// ============================================================

import type { CardType, GangCombo } from "./cards";
import type { GameEvent, TurnDirection } from "./events";

/** The public, minimal card shape on the wire. */
export interface Card {
  id: string;
  type: CardType;
}

export type GameStatus = "lobby" | "playing" | "finished";

// ------------------------------------------------------------
// PHASE — the explicit state machine the client renders from.
// Replaces the old ad-hoc pendingAction + AWAITING_FREEZE + pendingTurns mix.
// ------------------------------------------------------------

/** Summary of the interruptible action currently sitting in the freeze window. */
export interface PendingAction {
  id: string;
  actorId: string;
  cardType: CardType;
  combo?: GangCombo;
  targetId?: string;
  /** Triple Gang: the card type the actor publicly named to steal. */
  declaredType?: CardType;
}

export type Phase =
  | { kind: "lobby" }
  /** Current player may play cards then must draw. */
  | { kind: "turn"; playerId: string }
  /** An interruptible action is held; anyone holding Freeze may counter until `endsAt`. */
  | {
      kind: "nope_window";
      pending: PendingAction;
      /** ms epoch when the window closes and the action resolves. */
      endsAt: number;
      /** number of Freezes played so far; odd ⇒ action will be negated. */
      freezeCount: number;
    }
  /** `playerId` drew a Lava Cat, used a Water Bucket, and must place the Lava Cat back. */
  | { kind: "await_bucket"; playerId: string }
  /** Favor: `fromId` must give a card of their choice to `toId`. */
  | { kind: "await_favor"; fromId: string; toId: string }
  /** Peek & Swap: `playerId` decides whether to swap the revealed top card. */
  | { kind: "await_peek_swap"; playerId: string }
  /** Flood: every id in `pending` still owes a discard. */
  | { kind: "await_flood"; pending: string[] }
  /** Time Warp: `playerId` picks one card from the discard pile. */
  | { kind: "await_timewarp"; playerId: string }
  /** Pickpocket (redesigned): `playerId` saw `targetId`'s hand and picks one card to take. */
  | { kind: "await_pickpocket"; playerId: string; targetId: string }
  | { kind: "finished"; winnerId: string | null };

export type PhaseKind = Phase["kind"];

// ------------------------------------------------------------
// CLIENT-FACING STATE  (server → client, per viewer)
// ------------------------------------------------------------
export interface ClientPlayer {
  id: string;
  name: string;
  handCount: number; // count only — never the contents of other players' hands
  alive: boolean;
  hasBunker: boolean;
  locked: boolean;
  connected: boolean;
  away: boolean;
  isHost: boolean;
}

export interface ClientGameState {
  roomId: string;
  status: GameStatus;
  hostId: string;
  players: ClientPlayer[];
  turnOrder: string[];
  currentTurnIndex: number;
  direction: TurnDirection;
  /** Turns the current player still owes (Attack/Eruption stacking). */
  turnsRemaining: number;
  deckCount: number; // count only — deck contents are hidden
  discardTop: Card[]; // public: the most recent discards (top-most last)
  phase: Phase;
  winnerId: string | null;
  /** Recent structured events for the log + animations (most recent last). */
  log: GameEvent[];
}

// ------------------------------------------------------------
// CLIENT → SERVER COMMANDS
// ------------------------------------------------------------
export type ClientCommand =
  | { t: "START_GAME" }
  | { t: "DRAW" }
  | { t: "PLAY"; cardId: string; targetId?: string }
  | { t: "PLAY_GANG"; cardIds: string[]; targetId?: string; declaredType?: CardType }
  | { t: "FREEZE" }
  | { t: "PLACE_BUCKET"; position: number }
  | { t: "GIVE_CARD"; cardId: string } // favor
  | { t: "PEEK_DECIDE"; swap: boolean; cardId?: string }
  | { t: "FLOOD_DISCARD"; cardId: string }
  | { t: "TIMEWARP_PICK"; cardId: string }
  | { t: "PICKPOCKET_TAKE"; cardId: string }
  | { t: "TOGGLE_AWAY"; away: boolean }
  | { t: "REMATCH" };

export type CommandType = ClientCommand["t"];

// ------------------------------------------------------------
// SERVER → CLIENT MESSAGES
// ------------------------------------------------------------
/** Why the player is being shown private cards. */
export type PeekMode = "spy" | "swap" | "pickpocket";

export type ServerMessage =
  | { t: "WELCOME"; playerId: string } // tells the client which player id is "me"
  | { t: "STATE"; state: ClientGameState }
  | { t: "HAND"; cards: Card[] } // the viewer's own hand
  | { t: "PEEK"; mode: PeekMode; cards: Card[] } // private reveal (deck top / target hand)
  | { t: "ERROR"; code: ErrorCode };

export type ErrorCode =
  | "GAME_NOT_STARTED"
  | "ALREADY_STARTED"
  | "NOT_HOST"
  | "NOT_ENOUGH_PLAYERS"
  | "ROOM_FULL"
  | "DUPLICATE_USERNAME"
  | "NOT_YOUR_TURN"
  | "PENDING_ACTION"
  | "WRONG_PHASE"
  | "INVALID_CARD"
  | "INVALID_TARGET"
  | "NEED_TARGET"
  | "CANNOT_PLAY_CARD"
  | "LOCKED"
  | "NO_FREEZE"
  | "INVALID_GANG"
  | "DECK_EMPTY"
  | "UNKNOWN";

/** Colyseus leave codes used for non-error client redirects. */
export const LEAVE_CODES = {
  GAME_IN_PROGRESS: 4000,
  DUPLICATE_USERNAME: 4001,
  ROOM_FULL: 4002,
} as const;
