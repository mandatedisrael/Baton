/**
 * Error taxonomy. Small on purpose: every failure a user can hit maps to one
 * of these codes, and the CLI renders them uniformly.
 */

export type BatonErrorCode =
  | "NOT_INITIALIZED"
  | "ALREADY_INITIALIZED"
  | "INVALID_HANDOFF"
  | "INVALID_STATE"
  | "HASH_MISMATCH"
  | "NOT_FOUND"
  | "IO_ERROR";

export class BatonError extends Error {
  readonly code: BatonErrorCode;

  constructor(code: BatonErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BatonError";
    this.code = code;
  }
}

export function isBatonError(err: unknown): err is BatonError {
  return err instanceof BatonError;
}
