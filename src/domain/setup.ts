// ============================================================
// SETUP — start a game and rematch
// ============================================================
import type { GameEvent } from "../shared/events";
import type { GameState, EngineResult, Ctx } from "./state";
import { dealGame, lavaCatCount, HAND_SIZE } from "./deck";

const MIN_PLAYERS = 2;

/** Deal hands, bury the Lava Cats, and begin the first turn. */
export function startGame(state: GameState, ctx: Ctx): EngineResult {
  const ids = state.turnOrder.filter((id) => state.players[id]);
  const { deck, hands } = dealGame(ids, ctx.rng);

  const players = { ...state.players };
  for (const id of ids) {
    players[id] = {
      ...players[id],
      hand: hands[id],
      alive: true,
      hasBunker: false,
      locked: false,
    };
  }

  const firstId = ids[0];
  const s: GameState = {
    ...state,
    players,
    deck,
    discard: [],
    status: "playing",
    currentTurnIndex: 0,
    direction: 1,
    turnsRemaining: 1,
    held: null,
    bucketCard: null,
    winnerId: null,
    phase: { kind: "turn", playerId: firstId },
    log: [],
  };

  const events: GameEvent[] = [
    { kind: "GAME_STARTED", handSize: HAND_SIZE, lavaCount: lavaCatCount(ids.length) },
    { kind: "TURN_STARTED", playerId: firstId },
  ];
  // log starts empty here; the public boundary (commit) appends `events`.
  return { state: s, events, reveals: [] };
}

/** Reset a finished game to a fresh deal with the same roster. */
export function rematch(state: GameState, ctx: Ctx): EngineResult {
  const players = { ...state.players };
  for (const id of Object.keys(players)) {
    players[id] = { ...players[id], hand: [], alive: true, hasBunker: false, locked: false };
  }
  return startGame({ ...state, players }, ctx);
}

export { MIN_PLAYERS };
