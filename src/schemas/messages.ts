import { z } from "zod";

// ============================================================
// ZOD SCHEMAS — validasi runtime untuk semua pesan dari client
// TypeScript types hilang saat runtime, jadi ini lapisan keamanan
// supaya client nakal/bug tidak bisa kirim payload sembarangan.
// ============================================================

const sessionIdSchema = z.string().min(1).max(64);
const cardIdSchema = z.string().min(1).max(128);

export const startGameSchema = z.object({});

export const drawCardSchema = z.object({});

export const playCardSchema = z.object({
  cardId: cardIdSchema,
  targetId: sessionIdSchema.optional(),
});

export const playGangSchema = z.object({
  cardIds: z.array(cardIdSchema).min(2).max(5),
  targetId: sessionIdSchema.optional(),
  targetCardId: cardIdSchema.optional(),
});

export const useWaterBucketSchema = z.object({
  insertPosition: z.number().int().min(0).max(200),
});

export const bribeGiveCardSchema = z.object({
  cardId: cardIdSchema,
});

export const peekSwapDecisionSchema = z.object({
  swap: z.boolean(),
  cardId: cardIdSchema.optional(),
});

export const floodDiscardSchema = z.object({
  cardId: cardIdSchema,
});

export const freezePlaySchema = z.object({});

export const toggleAwaySchema = z.object({
  away: z.boolean(),
});

export const joinOptionsSchema = z.object({
  username: z.string().trim().min(1).max(20).optional(),
});

// ============================================================
// MESSAGE SCHEMA MAP — dipakai room untuk validasi per-tipe pesan
// ============================================================
export const MESSAGE_SCHEMAS = {
  START_GAME: startGameSchema,
  DRAW_CARD: drawCardSchema,
  PLAY_CARD: playCardSchema,
  PLAY_GANG: playGangSchema,
  USE_WATER_BUCKET: useWaterBucketSchema,
  BRIBE_GIVE_CARD: bribeGiveCardSchema,
  PEEK_SWAP_DECISION: peekSwapDecisionSchema,
  FLOOD_DISCARD: floodDiscardSchema,
  FREEZE_PLAY: freezePlaySchema,
  TOGGLE_AWAY: toggleAwaySchema,
} as const;

export type MessageType = keyof typeof MESSAGE_SCHEMAS;

export function isValidMessageType(type: string): type is MessageType {
  return type in MESSAGE_SCHEMAS;
}
