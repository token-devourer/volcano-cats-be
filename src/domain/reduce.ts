// ============================================================
// REDUCE — validate a client command and apply it
// ============================================================
// The single entry for gameplay commands. Validates against the current
// phase and the catalog, then mutates via the pure helpers. Interruptible
// actions are pulled from hand into the discard and parked in a freeze
// window; their effect runs later via resolveNopeWindow (driven by the
// transport's timer). Throws EngineError(code) on any illegal command.
// ============================================================

import { randomUUID } from "node:crypto";
import {
  CARD_SPECS,
  isGangType,
  isPlayable,
  comboForCount,
} from "../shared/cards";
import type { ClientCommand } from "../shared/protocol";
import type { GameEvent } from "../shared/events";
import type { Card } from "../shared/protocol";
import type { GameState, EngineResult, Ctx, HeldAction } from "./state";
import { getPlayer } from "./state";
import { EngineError, fail } from "./errors";
import { drawForPlayer, placeBucket } from "./draw";
import { openNopeWindow, applyFreeze } from "./nope";
import {
  resolveFavor,
  resolvePeekSwap,
  resolveFloodDiscard,
  resolveTimeWarp,
  resolvePickpocketTake,
} from "./followups";
import { startGame, rematch, MIN_PLAYERS } from "./setup";
import { currentPlayerId } from "./turn";

const noReveal = (state: GameState, events: GameEvent[] = []): EngineResult => ({ state, events, reveals: [] });

export function applyCommand(state: GameState, cmd: ClientCommand, ctx: Ctx): EngineResult {
  switch (cmd.t) {
    case "START_GAME":
      return handleStart(state, ctx);
    case "REMATCH":
      return handleRematch(state, ctx);
    case "TOGGLE_AWAY":
      return handleToggleAway(state, ctx, cmd.away);
    case "DRAW":
      return handleDraw(state, ctx);
    case "PLAY":
      return handlePlay(state, ctx, cmd.cardId, cmd.targetId);
    case "PLAY_GANG":
      return handleGang(state, ctx, cmd.cardIds, cmd.targetId, cmd.declaredType);
    case "FREEZE":
      return handleFreeze(state, ctx);
    case "PLACE_BUCKET":
      return handlePlaceBucket(state, ctx, cmd.position);
    case "GIVE_CARD":
      return resolveFavor(requireFavorActor(state, ctx), ctx.actorId, cmd.cardId);
    case "PEEK_DECIDE":
      return resolvePeekSwap(state, ctx.actorId, cmd.swap, cmd.cardId);
    case "FLOOD_DISCARD":
      return resolveFloodDiscard(state, ctx.actorId, cmd.cardId);
    case "TIMEWARP_PICK":
      return resolveTimeWarp(state, ctx.actorId, cmd.cardId);
    case "PICKPOCKET_TAKE":
      return resolvePickpocketTake(state, ctx.actorId, cmd.cardId);
    default: {
      const _exhaustive: never = cmd;
      void _exhaustive;
      return fail("UNKNOWN");
    }
  }
}

// ------------------------------------------------------------
// Lobby / meta
// ------------------------------------------------------------
function handleStart(state: GameState, ctx: Ctx): EngineResult {
  if (state.status !== "lobby") fail("ALREADY_STARTED");
  if (state.hostId !== ctx.actorId) fail("NOT_HOST");
  if (state.turnOrder.length < MIN_PLAYERS) fail("NOT_ENOUGH_PLAYERS");
  return startGame(state, ctx);
}

function handleRematch(state: GameState, ctx: Ctx): EngineResult {
  if (state.status !== "finished") fail("WRONG_PHASE");
  if (state.hostId !== ctx.actorId) fail("NOT_HOST");
  if (state.turnOrder.length < MIN_PLAYERS) fail("NOT_ENOUGH_PLAYERS");
  return rematch(state, ctx);
}

function handleToggleAway(state: GameState, ctx: Ctx, away: boolean): EngineResult {
  const p = state.players[ctx.actorId];
  if (!p) fail("UNKNOWN");
  const next = { ...state, players: { ...state.players, [ctx.actorId]: { ...p, away } } };
  return noReveal(next, [{ kind: "PLAYER_AWAY", playerId: ctx.actorId, away }]);
}

// ------------------------------------------------------------
// Turn actions
// ------------------------------------------------------------
function requireMyTurn(state: GameState, ctx: Ctx): void {
  if (state.status !== "playing") fail("GAME_NOT_STARTED");
  if (state.phase.kind !== "turn") fail("PENDING_ACTION");
  if (currentPlayerId(state) !== ctx.actorId) fail("NOT_YOUR_TURN");
}

function handleDraw(state: GameState, ctx: Ctx): EngineResult {
  requireMyTurn(state, ctx);
  // Drawing is always allowed on your turn (even when locked) — it ends the turn.
  return drawForPlayer(state, ctx.actorId, ctx.rng, "turn");
}

function handlePlay(state: GameState, ctx: Ctx, cardId: string, targetId?: string): EngineResult {
  requireMyTurn(state, ctx);
  const me = getPlayer(state, ctx.actorId);
  if (me.locked) fail("LOCKED");

  const card = me.hand.find((c) => c.id === cardId);
  if (!card) fail("INVALID_CARD");
  const spec = CARD_SPECS[card!.type];
  if (!isPlayable(card!.type) || card!.type === "FREEZE") fail("CANNOT_PLAY_CARD");

  if (spec.target === "player") {
    validatePlayerTarget(state, ctx.actorId, targetId);
  }

  const { state: afterRemove, removed } = removeFromHand(state, ctx.actorId, [cardId]);
  const held: HeldAction = {
    id: randomUUID(),
    actorId: ctx.actorId,
    cardType: card!.type,
    cards: removed,
    targetId: spec.target === "player" ? targetId : undefined,
  };
  const windowed = openNopeWindow(discardCards(afterRemove, removed), held, ctx.now);
  return noReveal(windowed, [
    { kind: "CARD_PLAYED", actorId: ctx.actorId, cardType: card!.type, targetId: held.targetId },
  ]);
}

function handleGang(
  state: GameState,
  ctx: Ctx,
  cardIds: string[],
  targetId?: string,
  declaredType?: import("../shared/cards").CardType,
): EngineResult {
  requireMyTurn(state, ctx);
  const me = getPlayer(state, ctx.actorId);
  if (me.locked) fail("LOCKED");

  const cards = cardIds.map((id) => me.hand.find((c) => c.id === id));
  if (cards.some((c) => !c)) fail("INVALID_CARD");
  const found = cards as Card[];
  if (!found.every((c) => isGangType(c.type))) fail("INVALID_GANG");

  const distinct = new Set(found.map((c) => c.type)).size;
  const combo = comboForCount(found.length, distinct);
  if (!combo) fail("INVALID_GANG");
  // Non-rainbow combos require a single matching type.
  if (combo !== "rainbow" && distinct !== 1) fail("INVALID_GANG");

  if (combo === "pair" || combo === "triple" || combo === "rainbow") {
    validatePlayerTarget(state, ctx.actorId, targetId);
  }
  if (combo === "triple") {
    if (!declaredType) fail("NEED_TARGET");
  }

  const { state: afterRemove, removed } = removeFromHand(state, ctx.actorId, cardIds);
  const held: HeldAction = {
    id: randomUUID(),
    actorId: ctx.actorId,
    cardType: found[0].type,
    cards: removed,
    combo: combo!,
    targetId: combo === "quad" ? undefined : targetId,
    declaredType: combo === "triple" ? declaredType : undefined,
  };
  const windowed = openNopeWindow(discardCards(afterRemove, removed), held, ctx.now);
  return noReveal(windowed, [
    {
      kind: "GANG_PLAYED",
      actorId: ctx.actorId,
      cardType: found[0].type,
      combo: combo!,
      targetId: held.targetId,
    },
  ]);
}

function handleFreeze(state: GameState, ctx: Ctx): EngineResult {
  if (state.phase.kind !== "nope_window") fail("WRONG_PHASE");
  const me = getPlayer(state, ctx.actorId);
  if (!me.hand.some((c) => c.type === "FREEZE")) fail("NO_FREEZE");
  return applyFreeze(state, ctx.actorId, ctx.now);
}

function handlePlaceBucket(state: GameState, ctx: Ctx, position: number): EngineResult {
  if (state.phase.kind !== "await_bucket") fail("WRONG_PHASE");
  if (state.phase.playerId !== ctx.actorId) fail("NOT_YOUR_TURN");
  return placeBucket(state, ctx.actorId, position);
}

function requireFavorActor(state: GameState, ctx: Ctx): GameState {
  if (state.phase.kind !== "await_favor") fail("WRONG_PHASE");
  if (state.phase.fromId !== ctx.actorId) fail("NOT_YOUR_TURN");
  return state;
}

// ------------------------------------------------------------
// Shared validation / mutation helpers
// ------------------------------------------------------------
function validatePlayerTarget(state: GameState, actorId: string, targetId?: string): void {
  if (!targetId) fail("NEED_TARGET");
  if (targetId === actorId) fail("INVALID_TARGET");
  const t = state.players[targetId!];
  if (!t || !t.alive) fail("INVALID_TARGET");
}

function removeFromHand(
  state: GameState,
  playerId: string,
  cardIds: string[],
): { state: GameState; removed: Card[] } {
  const player = getPlayer(state, playerId);
  const ids = new Set(cardIds);
  const removed = player.hand.filter((c) => ids.has(c.id));
  if (removed.length !== cardIds.length) throw new EngineError("INVALID_CARD");
  const hand = player.hand.filter((c) => !ids.has(c.id));
  return {
    state: { ...state, players: { ...state.players, [playerId]: { ...player, hand } } },
    removed,
  };
}

function discardCards(state: GameState, cards: Card[]): GameState {
  return { ...state, discard: [...state.discard, ...cards] };
}
