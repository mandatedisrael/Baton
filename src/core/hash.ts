/**
 * Content hashing. A handoff's id IS its hash (content-addressed, like git).
 * Integrity verification anywhere in the system is "recompute and compare".
 *
 * SHA-256 via node:crypto — zero dependencies, available everywhere. The
 * algorithm is exported as a constant; on-chain manifests (phase 3) record
 * it, so a future move to BLAKE3 is a tagged migration, not a flag day.
 */
import { createHash } from "node:crypto";
import { canonicalize } from "./canonical.ts";

export const HASH_ALGORITHM = "sha256" as const;

/** Hex digest of arbitrary bytes. */
export function hashBytes(data: Uint8Array | string): string {
  return createHash(HASH_ALGORITHM).update(data).digest("hex");
}

/** Hex digest of a value's canonical JSON form. */
export function hashCanonical(value: unknown): string {
  return hashBytes(canonicalize(value));
}

/** Short display form of a content hash (like git's abbreviated SHA). */
export function shortId(hash: string): string {
  return hash.slice(0, 12);
}
