// ============================================================
// VOLCANO CATS — CANONICAL CARD CATALOG  (shared FE ⇄ BE)
// ============================================================
// SINGLE SOURCE OF TRUTH for every card's identity and mechanical
// shape. The engine reads counts/roles/requirements from here; the
// frontend reads emoji/role/i18nKey from the SAME file (mirrored).
//
// This file is framework-free and dependency-free so it can be copied
// verbatim into the frontend (see scripts/sync-shared in the FE repo).
// Do NOT put localized strings here — names/descriptions live in the
// i18n table keyed by `i18nKey`. Do NOT put visual theme (gradients,
// images) here — that is frontend-only (lib/cardTheme).
// ============================================================

export type CardType =
  // --- DANGER ---
  | "LAVA_CAT" // = Exploding Kitten
  | "WATER_BUCKET" // = Defuse
  // --- CLASSIC ACTIONS (EK renames) ---
  | "NAP_TIME" // = Skip
  | "ERUPTION" // = Attack
  | "SPY_CAT" // = See the Future
  | "EARTHQUAKE" // = Shuffle
  | "FREEZE" // = Nope
  | "BRIBE" // = Favor
  // --- NEW MECHANICS ---
  | "REVERSE"
  | "SNIPER"
  | "PEEK_AND_SWAP"
  | "BUNKER"
  | "PICKPOCKET"
  | "FLOOD"
  | "TIME_WARP"
  | "LOCKDOWN"
  // --- GANG (cat) CARDS ---
  | "GANG_FIRE"
  | "GANG_ICE"
  | "GANG_STORM"
  | "GANG_EARTH"
  | "GANG_SHADOW";

export type CardRole = "danger" | "action" | "gang";

/** What target must accompany the play command (validated server-side). */
export type TargetSpec =
  | "none" // no target
  | "player" // pick one other living player
  | "combo"; // gang: depends on the combo size (handled by gang logic)

export interface CardSpec {
  type: CardType;
  role: CardRole;
  emoji: string;
  /** Fixed quantity in the base pool. Cards with `dynamic` are sized by player count instead. */
  count: number;
  /** LAVA_CAT / WATER_BUCKET quantities are derived from player count, not `count`. */
  dynamic?: boolean;
  /**
   * Opens a Nope/Freeze window when played (can be countered before it
   * resolves). True for every action + gang card. FREEZE itself is the
   * counter and is never "played" as an interruptible action.
   */
  interruptible: boolean;
  target: TargetSpec;
  /** Base key into the i18n table: `${i18nKey}.name`, `.desc`, `.flavor`. */
  i18nKey: string;
}

// ------------------------------------------------------------
// THE CATALOG
// ------------------------------------------------------------
export const CARD_SPECS: Record<CardType, CardSpec> = {
  LAVA_CAT: {
    type: "LAVA_CAT", role: "danger", emoji: "🌋", count: 0, dynamic: true,
    interruptible: false, target: "none", i18nKey: "card.lavaCat",
  },
  WATER_BUCKET: {
    type: "WATER_BUCKET", role: "danger", emoji: "💧", count: 0, dynamic: true,
    interruptible: false, target: "none", i18nKey: "card.waterBucket",
  },

  NAP_TIME: {
    type: "NAP_TIME", role: "action", emoji: "😴", count: 6,
    interruptible: true, target: "none", i18nKey: "card.napTime",
  },
  ERUPTION: {
    type: "ERUPTION", role: "action", emoji: "🌀", count: 6,
    interruptible: true, target: "none", i18nKey: "card.eruption",
  },
  SPY_CAT: {
    type: "SPY_CAT", role: "action", emoji: "🔭", count: 6,
    interruptible: true, target: "none", i18nKey: "card.spyCat",
  },
  EARTHQUAKE: {
    type: "EARTHQUAKE", role: "action", emoji: "🔀", count: 5,
    interruptible: true, target: "none", i18nKey: "card.earthquake",
  },
  FREEZE: {
    // The counter. Never opens a window itself; it RESPONDS to one.
    type: "FREEZE", role: "action", emoji: "❄️", count: 7,
    interruptible: false, target: "none", i18nKey: "card.freeze",
  },
  BRIBE: {
    type: "BRIBE", role: "action", emoji: "🎁", count: 5,
    interruptible: true, target: "player", i18nKey: "card.bribe",
  },

  REVERSE: {
    type: "REVERSE", role: "action", emoji: "🔄", count: 5,
    interruptible: true, target: "none", i18nKey: "card.reverse",
  },
  SNIPER: {
    type: "SNIPER", role: "action", emoji: "🎯", count: 4,
    interruptible: true, target: "player", i18nKey: "card.sniper",
  },
  PEEK_AND_SWAP: {
    type: "PEEK_AND_SWAP", role: "action", emoji: "👁️", count: 4,
    interruptible: true, target: "none", i18nKey: "card.peekAndSwap",
  },
  BUNKER: {
    type: "BUNKER", role: "action", emoji: "🛡️", count: 4,
    interruptible: true, target: "none", i18nKey: "card.bunker",
  },
  PICKPOCKET: {
    type: "PICKPOCKET", role: "action", emoji: "💸", count: 5,
    interruptible: true, target: "player", i18nKey: "card.pickpocket",
  },
  FLOOD: {
    type: "FLOOD", role: "action", emoji: "🌊", count: 3,
    interruptible: true, target: "none", i18nKey: "card.flood",
  },
  TIME_WARP: {
    type: "TIME_WARP", role: "action", emoji: "🪄", count: 3,
    interruptible: true, target: "none", i18nKey: "card.timeWarp",
  },
  LOCKDOWN: {
    type: "LOCKDOWN", role: "action", emoji: "🔒", count: 3,
    interruptible: true, target: "player", i18nKey: "card.lockdown",
  },

  GANG_FIRE: {
    type: "GANG_FIRE", role: "gang", emoji: "🔥", count: 6,
    interruptible: true, target: "combo", i18nKey: "card.gangFire",
  },
  GANG_ICE: {
    type: "GANG_ICE", role: "gang", emoji: "🧊", count: 6,
    interruptible: true, target: "combo", i18nKey: "card.gangIce",
  },
  GANG_STORM: {
    type: "GANG_STORM", role: "gang", emoji: "⚡", count: 6,
    interruptible: true, target: "combo", i18nKey: "card.gangStorm",
  },
  GANG_EARTH: {
    type: "GANG_EARTH", role: "gang", emoji: "🌿", count: 6,
    interruptible: true, target: "combo", i18nKey: "card.gangEarth",
  },
  GANG_SHADOW: {
    type: "GANG_SHADOW", role: "gang", emoji: "🌑", count: 6,
    interruptible: true, target: "combo", i18nKey: "card.gangShadow",
  },
};

export const ALL_CARD_TYPES = Object.keys(CARD_SPECS) as CardType[];

export const GANG_TYPES: CardType[] = [
  "GANG_FIRE", "GANG_ICE", "GANG_STORM", "GANG_EARTH", "GANG_SHADOW",
];

/** A gang combo and the effect it triggers. */
export type GangCombo = "pair" | "triple" | "quad" | "rainbow";

export function comboForCount(count: number, distinctTypes: number): GangCombo | null {
  if (count === 5 && distinctTypes === 5) return "rainbow";
  if (count === 4) return "quad";
  if (count === 3) return "triple";
  if (count === 2) return "pair";
  // 5 of the SAME type plays as a quad-style raid (all-steal); 2-3-4 must be same type.
  if (count === 5 && distinctTypes === 1) return "quad";
  return null;
}

export function isGangType(type: CardType): boolean {
  return GANG_TYPES.includes(type);
}

export function getSpec(type: CardType): CardSpec {
  const spec = CARD_SPECS[type];
  if (!spec) throw new Error(`Unknown card type: ${type}`);
  return spec;
}

/** Is this card legal to play from hand on your turn (not a danger card)? */
export function isPlayable(type: CardType): boolean {
  return CARD_SPECS[type].role !== "danger";
}
