// ============================================================
// DECK — build, deal, draw, reshuffle
// ============================================================
// Deck size scales with player count so the danger ratio feels right
// at 2 and at 10 players. Top of deck = LAST element of the array.
//
// Fixes the historical "Deck kosong!" crash: when a draw is needed and
// the draw pile is empty, the discard pile (minus spent Lava Cats) is
// reshuffled into a fresh deck. Undrawn Lava Cats always live in the
// deck, so the deck can only run dry once danger is mostly spent —
// reshuffling keeps the game moving without inflating lethality.
// ============================================================

import { CARD_SPECS, ALL_CARD_TYPES } from "../shared/cards";
import type { Card } from "../shared/protocol";
import type { GameState } from "./state";
import { makeCard, makeCards } from "./state";
import { shuffle, randInt, type Rng } from "./rng";

export const HAND_SIZE = 6; // cards dealt per player (plus 1 Water Bucket)

/** Target draw-pile size (before Lava Cats) so each player gets several draws. */
function targetDeckSize(playerCount: number): number {
  return playerCount * 9 + 6;
}

/** Extra Water Buckets seeded into the deck (beyond the one each player starts with). */
function extraWaterBuckets(playerCount: number): number {
  return playerCount <= 4 ? 2 : playerCount <= 7 ? 3 : 4;
}

/** Number of Lava Cats in play: one fewer than the player count (classic EK rule). */
export function lavaCatCount(playerCount: number): number {
  return Math.max(1, playerCount - 1);
}

/** Build the base pool of action + gang cards (no danger cards), sized to player count. */
function buildBasePool(playerCount: number, rng: Rng): Card[] {
  const pool: Card[] = [];
  for (const type of ALL_CARD_TYPES) {
    const spec = CARD_SPECS[type];
    if (spec.role === "danger") continue;
    pool.push(...makeCards(type, spec.count));
  }
  const target = targetDeckSize(playerCount);
  const shuffled = shuffle(pool, rng);
  // Take a representative random subset when the full pool is larger than target.
  return target >= shuffled.length ? shuffled : shuffled.slice(0, target);
}

export interface DealtSetup {
  deck: Card[];
  hands: Record<string, Card[]>;
}

/** Deal starting hands (6 + 1 Water Bucket each), seed extra buckets, then bury the Lava Cats. */
export function dealGame(playerIds: string[], rng: Rng): DealtSetup {
  const playerCount = playerIds.length;
  let deck = buildBasePool(playerCount, rng);

  const hands: Record<string, Card[]> = {};
  for (const id of playerIds) {
    const hand: Card[] = [makeCard("WATER_BUCKET")];
    for (let i = 0; i < HAND_SIZE; i++) {
      const c = deck.pop();
      if (c) hand.push(c);
    }
    hands[id] = hand;
  }

  // Seed extra Water Buckets, reshuffle, then insert Lava Cats at random depths.
  deck.push(...makeCards("WATER_BUCKET", extraWaterBuckets(playerCount)));
  deck = shuffle(deck, rng);

  for (const lava of makeCards("LAVA_CAT", lavaCatCount(playerCount))) {
    const pos = randInt(deck.length + 1, rng);
    deck.splice(pos, 0, lava);
  }

  return { deck, hands };
}

/**
 * Ensure the deck has at least one card to draw. If empty, reshuffle the
 * discard pile (excluding spent Lava Cats) back into the deck.
 * Returns a new state (deck/discard possibly rebuilt).
 */
export function ensureDrawable(state: GameState, rng: Rng): GameState {
  if (state.deck.length > 0) return state;
  const recyclable = state.discard.filter((c) => c.type !== "LAVA_CAT");
  if (recyclable.length === 0) return state; // nothing to recycle (degenerate; caller guards)
  return {
    ...state,
    deck: shuffle(recyclable, rng),
    discard: state.discard.filter((c) => c.type === "LAVA_CAT"),
  };
}

/** Peek the top `n` cards (top-most first) without removing them. */
export function peekTop(state: GameState, n: number): Card[] {
  return state.deck.slice(-n).reverse();
}

/** Insert a card at `position` counted from the TOP of the deck (0 = on top). */
export function insertFromTop(deck: Card[], card: Card, positionFromTop: number): Card[] {
  const clamped = Math.max(0, Math.min(positionFromTop, deck.length));
  // top = end of array, so a "from top" index maps to (length - index).
  const idx = deck.length - clamped;
  const next = [...deck];
  next.splice(idx, 0, card);
  return next;
}
