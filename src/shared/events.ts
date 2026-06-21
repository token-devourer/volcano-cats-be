// ============================================================
// VOLCANO CATS — STRUCTURED GAME EVENTS  (shared FE ⇄ BE)
// ============================================================
// The engine emits these *structured* events; it NEVER produces
// localized strings. The log sidebar, toasts, and card-play
// animations are all rendered from this stream by mapping
// `event.kind` → an i18n template and resolving player ids to names
// on the client. This is what makes the UI fully localizable and
// also prevents information leaks: events reference players/cards by
// id and only include card identities that are public knowledge.
// ============================================================

import type { CardType } from "./cards";

export type TurnDirection = 1 | -1;

export type GameEvent =
  | { kind: "GAME_STARTED"; handSize: number; lavaCount: number }
  | { kind: "TURN_STARTED"; playerId: string }
  | { kind: "CARD_PLAYED"; actorId: string; cardType: CardType; targetId?: string }
  | { kind: "GANG_PLAYED"; actorId: string; cardType: CardType; combo: string; targetId?: string }
  | { kind: "CARD_DREW"; playerId: string } // public: "drew a card" — the card itself stays private
  | { kind: "NOPE_PLAYED"; actorId: string; negated: boolean } // negated = action is now cancelled
  | { kind: "ACTION_NEGATED"; cardType: CardType } // a pending action fizzled via the freeze stack
  | { kind: "LAVA_DRAWN"; playerId: string; defused: boolean }
  | { kind: "BUNKER_SAVED"; playerId: string }
  | { kind: "BUNKER_SET"; playerId: string }
  | { kind: "BUCKET_PLACED"; playerId: string }
  | { kind: "ELIMINATED"; playerId: string }
  | { kind: "STEAL_RANDOM"; actorId: string; targetId: string } // card stays hidden from the table
  | { kind: "STEAL_NAMED"; actorId: string; targetId: string; cardType: CardType } // public reveal
  | { kind: "STEAL_NONE"; actorId: string; targetId: string; cardType: CardType } // named guess missed
  | { kind: "GIFT_GIVEN"; fromId: string; toId: string } // favor — card stays hidden
  | { kind: "HANDS_SWAPPED"; actorId: string; targetId: string }
  | { kind: "RAID"; actorId: string } // quad: stole from everyone
  | { kind: "SHUFFLED"; actorId: string }
  | { kind: "REVERSED"; actorId: string; direction: TurnDirection }
  | { kind: "ATTACK"; actorId: string; targetId: string; turns: number }
  | { kind: "SKIPPED"; actorId: string }
  | { kind: "LOCKED"; actorId: string; targetId: string }
  | { kind: "SPIED"; actorId: string } // looked at top of deck (cards delivered privately)
  | { kind: "PEEK_SWAPPED"; actorId: string; swapped: boolean }
  | { kind: "FLOOD_STARTED"; actorId: string }
  | { kind: "FLOOD_DISCARDED"; playerId: string }
  | { kind: "TIME_WARPED"; actorId: string } // took a card from discard (kept private)
  | { kind: "FORCED_DRAW"; actorId: string; targetId: string } // sniper
  | { kind: "PLAYER_AWAY"; playerId: string; away: boolean }
  | { kind: "PLAYER_DISCONNECTED"; playerId: string }
  | { kind: "PLAYER_RECONNECTED"; playerId: string }
  | { kind: "AUTO_PLAYED"; playerId: string } // away/offline player auto-resolved their turn/input
  | { kind: "WIN"; playerId: string };

export type GameEventKind = GameEvent["kind"];

/** Severity hint so the client can style log/toast and decide animation weight. */
export type EventTone = "info" | "action" | "danger" | "win";

export const EVENT_TONE: Record<GameEventKind, EventTone> = {
  GAME_STARTED: "info",
  TURN_STARTED: "info",
  CARD_PLAYED: "action",
  GANG_PLAYED: "action",
  CARD_DREW: "info",
  NOPE_PLAYED: "action",
  ACTION_NEGATED: "action",
  LAVA_DRAWN: "danger",
  BUNKER_SAVED: "action",
  BUNKER_SET: "action",
  BUCKET_PLACED: "action",
  ELIMINATED: "danger",
  STEAL_RANDOM: "action",
  STEAL_NAMED: "action",
  STEAL_NONE: "action",
  GIFT_GIVEN: "action",
  HANDS_SWAPPED: "action",
  RAID: "action",
  SHUFFLED: "action",
  REVERSED: "action",
  ATTACK: "action",
  SKIPPED: "action",
  LOCKED: "action",
  SPIED: "action",
  PEEK_SWAPPED: "action",
  FLOOD_STARTED: "action",
  FLOOD_DISCARDED: "info",
  TIME_WARPED: "action",
  FORCED_DRAW: "action",
  PLAYER_AWAY: "info",
  PLAYER_DISCONNECTED: "info",
  PLAYER_RECONNECTED: "info",
  AUTO_PLAYED: "info",
  WIN: "win",
};
