// ============================================================
// ENGINE — public API (the only surface the transport should import)
// ============================================================
// Wraps the internal reducer and window resolver so that every public
// step commits its events into state.log exactly once. Keep the transport
// layer ignorant of the internal modules; it talks to this barrel only.
// ============================================================

import type { ClientCommand } from "../shared/protocol";
import type { GameState, EngineResult, Ctx } from "./state";
import { applyCommand } from "./reduce";
import { resolveNopeWindow } from "./nope";

/** Append a step's events into the running log (called once at each boundary). */
function commit(result: EngineResult): EngineResult {
  return {
    ...result,
    state: { ...result.state, log: [...result.state.log, ...result.events] },
  };
}

/** Validate + apply a client command. Throws EngineError(code) if illegal. */
export function reduce(state: GameState, cmd: ClientCommand, ctx: Ctx): EngineResult {
  return commit(applyCommand(state, cmd, ctx));
}

/** Resolve the freeze window when its timer fires (transport guards the phase). */
export function resolveWindow(state: GameState, ctx: Ctx): EngineResult {
  return commit(resolveNopeWindow(state, ctx.rng));
}

// ---- re-exports the transport needs ----
export { EngineError } from "./errors";
export { makeRng, makeSecureRng, type Rng } from "./rng";
export {
  createInitialState,
  addPlayer,
  removePlayerFromLobby,
  setConnected,
  isNameTaken,
  findDisconnectedByName,
  newRoomId,
} from "./lobby";
export { serializeForViewer, handFor } from "./serialize";
export { nextAutoStep, needsAuto, type AutoStep } from "./auto";
export { currentPlayerId } from "./turn";
export { FREEZE_WINDOW_MS } from "./state";
export type { GameState, EngineResult, Ctx, Player, PrivateReveal } from "./state";

export type { ClientCommand };
