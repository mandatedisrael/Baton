# BATON

**Git for agent memory.** Hand off live coding-agent context between Claude Code, Codex, Cursor, and any MCP-compatible tool — verifiably, across machines, with cryptographic ownership and revocable sharing. Built on Sui + Walrus + Seal.

The mental model is a relay race: the runner (agent/model) changes; the race state travels in the baton, not the runner. You own the baton; agents are temporary runners hired per leg.

## Status

Phase 1 of 6 — foundation. Local-only: schema, content addressing, working state, store, CLI. No chain, no distiller yet.

| Phase | Scope |
|---|---|
| **1. Foundation** ← here | handoff schema v1, canonical JSON + SHA-256 content addressing, WorkingState + checkpoint patch ops, local store with verify-on-read, CLI skeleton |
| 2. Distiller | capture adapters (Claude Code hooks → transcripts), micro-checkpoint extraction, secrets scrubber, fidelity grader, review gate |
| 3. Chain & storage | Move package, Walrus blob storage, Seal encryption, async upload queue, verify-on-resume |
| 4. MCP + renderer | `baton-mcp` server, per-tool resume prompts, CLAUDE.md/AGENTS.md rendering, cross-examination (`baton_verify`) |
| 5. Identity & sharing | zkLogin, AccessCap share/revoke, Seal policy rotation, sponsored gas |
| 6. Viewer & hardening | Walrus Sites lineage viewer, failure-mode hardening, beta, demo |

## Quickstart (dev)

Requires Node ≥ 22.18 (runs TypeScript natively). Zero runtime dependencies.

```sh
npm install             # dev deps only (typescript, @types/node)
npm test
npm run baton init      # in a project directory
npm run baton status
npm run baton pass      # seal the working state into a handoff
npm run baton log
npm run baton doctor
```

## Design principles

- **Content-addressed.** A handoff's id is the SHA-256 hash of its canonical JSON (RFC 8785-style). Verification anywhere is "recompute and compare". The algorithm is recorded alongside hashes, so migrating (e.g. to BLAKE3) is a tagged change, not a flag day.
- **Verify on every read.** Tampered batons refuse to load — locally today, on resume from Walrus in phase 3. A hash mismatch is a loud failure, never a silent one.
- **Pure core.** State transitions (`applyPatch`, `finalize`) are pure functions; IO lives only in the store and CLI. The distiller and MCP server plug in without touching them.
- **Two-tier truth.** The distilled handoff is what gets injected; the raw source travels alongside (sealed, cited per claim) — we never throw away the source.
- **Honest fields.** `fidelity.score` is `null` until graded; `captureMode: "fallback"` says so when capture was degraded. No fake confidence.
- **No blockchain-speak in UX.** Users see batons, projects, verification — never blobs or epochs.
- **Zero dependencies in the foundation.** Node built-ins only (crypto, fs, test). Validation is strict: unknown keys are rejected, never silently stripped — a content-addressed document must contain exactly what gets hashed.

## Layout

```
src/
  schema/    handoff schema v1 + strict validator — the wire format
  core/      pure logic: canonicalize, hash, working state, finalize
  store/     local persistence (.baton/), atomic writes, verify-on-read
  cli/       thin command layer over the engine
tests/
```

## License

Apache-2.0
