// ============================================================
// EngineError — typed, localizable failures
// ============================================================
// The engine throws EngineError with a machine-readable ErrorCode. The
// transport layer catches it and sends { t: "ERROR", code } to the
// client, which localizes it. The engine never produces user-facing
// strings.
// ============================================================

import type { ErrorCode } from "../shared/protocol";

export class EngineError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code);
    this.name = "EngineError";
  }
}

export function fail(code: ErrorCode): never {
  throw new EngineError(code);
}
