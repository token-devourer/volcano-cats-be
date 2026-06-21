// ============================================================
// Zod schemas — runtime validation of untrusted client input
// ============================================================
// TypeScript types vanish at runtime, so every inbound command is
// validated here before reaching the engine. A modified/hostile client
// cannot send a malformed payload past this gate.
// ============================================================

import { z } from "zod";

const cardId = z.string().min(1).max(128);
const playerId = z.string().min(1).max(64);

export const commandSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("START_GAME") }),
  z.object({ t: z.literal("REMATCH") }),
  z.object({ t: z.literal("DRAW") }),
  z.object({ t: z.literal("PLAY"), cardId, targetId: playerId.optional() }),
  z.object({
    t: z.literal("PLAY_GANG"),
    cardIds: z.array(cardId).min(2).max(5),
    targetId: playerId.optional(),
    declaredType: z.string().max(32).optional(),
  }),
  z.object({ t: z.literal("FREEZE") }),
  z.object({ t: z.literal("PLACE_BUCKET"), position: z.number().int().min(0).max(500) }),
  z.object({ t: z.literal("GIVE_CARD"), cardId }),
  z.object({ t: z.literal("PEEK_DECIDE"), swap: z.boolean(), cardId: cardId.optional() }),
  z.object({ t: z.literal("FLOOD_DISCARD"), cardId }),
  z.object({ t: z.literal("TIMEWARP_PICK"), cardId }),
  z.object({ t: z.literal("PICKPOCKET_TAKE"), cardId }),
  z.object({ t: z.literal("TOGGLE_AWAY"), away: z.boolean() }),
]);

export const joinOptionsSchema = z.object({
  username: z.string().trim().min(1).max(20).optional(),
});
