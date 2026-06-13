/**
 * CLI output helpers. No blockchain-speak in UX (plan §1.2) — users see
 * batons, projects, and verification, never blobs or epochs.
 */
import { isBatonError } from "../core/errors.ts";

export const ok = (msg: string): void => console.log(`✓ ${msg}`);
export const warn = (msg: string): void => console.warn(`! ${msg}`);
export const fail = (msg: string): void => console.error(`✗ ${msg}`);

/** Uniform error rendering + exit. */
export function die(err: unknown): never {
  if (isBatonError(err)) {
    fail(err.message);
  } else if (err instanceof Error) {
    fail(`unexpected error: ${err.message}`);
  } else {
    fail(`unexpected error: ${String(err)}`);
  }
  process.exit(1);
}
