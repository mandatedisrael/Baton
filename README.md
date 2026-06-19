# BATON

**Git for agent memory.** Baton hands off live coding-agent context between Claude Code, Codex, Cursor, and any MCP-compatible tool — verifiably, across machines, with cryptographic ownership and revocable sharing.

When you switch agents or sit down at another machine, you normally re-explain the project from scratch — what you're building, what's already decided, what was tried and failed. The new agent doesn't know, so it repeats mistakes, and the moment you run `/clear` the context is gone. Baton turns that throwaway context into a durable, verifiable artifact you own and can hand to any agent.

---

## The mental model: a relay race

The runner changes; the race state travels in the **baton**, not the runner.

In Baton, the *runner* is the agent (Claude Code now, Codex in twenty minutes, a teammate's agent tomorrow). The agents are temporary — hired per leg of the race. What persists is the baton: the working state of the task, passed cleanly from one runner to the next. **You are the coach.** You own the baton; agents read and write through it but never own it.

A baton is a *commit*, not a one-shot summary — sealed, content-addressed, and chained to its parents, exactly like git. Switching from Claude Code to Codex is handing off the baton; the next runner picks up mid-stride, already knowing what the last one tried and why it failed.

---

## What's in a baton

A handoff is a small, structured document — typically a few kilobytes — capturing everything a fresh agent needs to continue:

| Field | What it holds |
|---|---|
| `mission` | The current goal, in a sentence or two. |
| `status` | `done` · `in-progress` · `blocked`. |
| `decisions[]` | What was chosen and **why** — each with a citation into the source. |
| `graveyard[]` | **Approaches that were tried and failed, and why.** The single highest-value field — it stops the next agent repeating dead ends. |
| `repoMap` | Files touched, files that matter, entry points — with content hashes. |
| `nextActions[]` | Ordered, concrete next steps. |
| `envNotes[]` | Versions, quirks, setup landmines. |
| `verbatimRules[]` | Project rules destined for `CLAUDE.md` / `AGENTS.md` / `.cursorrules`. |
| `attachments[]` | The full, secrets-scrubbed source the distillation was drawn from. |
| `fidelity` | How faithful the distillation is to its source (0–1) — or `null` until graded. |
| `meta` | Project, branch, tool, capture mode, model, author, timestamp, and **parent baton ids** (the lineage DAG). |

### Two-tier truth

A baton keeps two layers, and never throws either away:

- **The distilled handoff** — small, cheap to inject, what a resuming agent actually reads.
- **The sealed source** — the full transcript it was distilled from, scrubbed before storage and travelling alongside as a content-addressed attachment. Every distilled claim cites the exact line span it came from.

So fidelity is always *recoverable*: if a summary is ever in doubt, the receiving agent can cross-examine it against the ground truth. Most systems extract context and discard the source; Baton seals the source and measures how well the summary matches it.

---

## How it works

```
   you work in an agent                          you (or a teammate) resume
   ┌──────────────────┐                          ┌──────────────────────┐
   │   Claude Code     │                          │   Codex / Cursor /    │
   │   Codex / Cursor  │                          │   Claude Code / web   │
   └────────┬─────────┘                           └───────────▲──────────┘
            │ session hooks                                    │ resume prompt
            ▼                                                  │
   ┌──────────────────┐    baton pass    ┌───────────────┐   │
   │  micro-checkpoints │ ───────────────▶│  sealed baton  │──┘
   │  → WorkingState    │   (distill,      │ (content-addr, │  verify hash,
   │  (rolling, local)  │    scrub, grade, │  signed,       │  render per tool
   └──────────────────┘    seal)          │  lineage DAG)  │
                                          └───────────────┘
```

1. **Capture (continuous, invisible).** As you work, session hooks fire micro-checkpoints. Each looks at just the recent delta and proposes small patches to a rolling *working state*: add a decision, move a failed approach to the graveyard, update status. Small targets mean small, self-correcting errors — later checkpoints overwrite earlier mistakes ("latest truth wins").

2. **Pass = commit.** `baton pass` finalizes the accumulated working state into an immutable baton: a final consistency sweep, a **secrets scrub** (so pasted API keys never get sealed), an optional **fidelity grade** against the source, then content-addressing and sealing. Sealing is fast because the work was done incrementally — there's no single summarization step to get wrong.

3. **Resume.** On another tool or machine, Baton fetches the head baton, **verifies its hash**, and renders a tool-specific resume prompt: the mission, the decisions, and — front and center — the graveyard. The new agent picks up knowing what the last one already failed at, and can verify any claim against the cited source before acting.

Lineage is a DAG, like git: every baton points at its parents, parallel sessions create siblings, and merges have two parents.

---

## Architecture

Baton is layered so the hard guarantees live in a small, pure core and everything else plugs in around it.

```
src/
  schema/    the wire format — handoff schema + strict validator
  core/      pure logic: canonical JSON, SHA-256 content addressing,
             working-state patch ops, finalize (pass = commit)
  distiller/ capture adapters, secrets scrubber, micro-checkpoint
             extractor, fidelity grader
  llm/       provider-agnostic model client (the distiller's boundary)
  store/     local persistence (.baton/), atomic writes, verify-on-read
  render/    resume prompts + CLAUDE.md / AGENTS.md / .cursorrules
  cli/       thin command layer + Claude Code hook integration
```

- **Schema** is the contract every part agrees on — a strict validator that *rejects* unknown keys rather than stripping them, because a content-addressed document must contain exactly what gets hashed.
- **Core** is pure functions: `canonicalize` → bytes, `hash` → identity, `applyPatch`/`finalize` → state transitions. No IO, no clock beyond what callers pass in. This is what makes verification deterministic across machines.
- **The distiller** turns raw sessions into batons. It runs extraction and grading on *your own* model (via a provider-agnostic client), so your code and context never leave your account just to be summarized.
- **The store** persists batons and their source attachments under `.baton/` (mirroring git's shape) with atomic writes and verify-on-read.
- **Renderers and the CLI** are thin; the same engine backs an MCP server so any MCP-compatible tool drives identical logic.

**Built on Sui + Walrus + Seal.** Beyond the local engine, a baton's content lives encrypted on **Walrus** (decentralized blob storage), its hashes, lineage, and fidelity attestations are anchored on **Sui**, and **Seal** provides client-side, policy-based encryption with revocable, capability-based sharing. The complete owner and delegated-reader Testnet paths are implemented and verified against live infrastructure. Invitation-scoped sponsored registration is also live on Testnet; Mainnet deployment and zkLogin remain future work.

---

## Trust & verification

Baton's guarantees come from content addressing, not from trusting a server.

- **Content-addressed.** A baton's id *is* the SHA-256 of its canonical JSON (RFC 8785-style: sorted keys, deterministic serialization). The algorithm is recorded alongside every hash, so a future migration is a tagged change, not a flag day.
- **Verify on every read.** Every baton loaded from disk — or fetched on resume — is re-hashed and compared to its id. A mismatch is a loud, fatal refusal, never a silent one. Tampered batons don't load.
- **No one in the trust path sees your plaintext.** Encryption is client-side; storage sees ciphertext; the chain sees only hashes and scores. There is no relayer that reads your code.
- **Cryptographic sharing and revocation.** Access is granted by capability objects and enforced by encryption policy. Revoking someone rotates the policy — their next fetch decrypts nothing. (Revocation is forward-only: it can't unread what was already fetched, and Baton says so rather than pretending otherwise.)
- **Measured fidelity.** The hash proves *integrity* (nothing changed since sealing). A separate grade measures *faithfulness* (how well the summary matches its source) and is attested alongside — a signal, honestly scored, not a guarantee.

---

## Capture modes

Different tools expose different ground truth, so Baton has one protocol with several capture adapters. The mode is recorded on every baton — quality is never overstated.

| Mode | Where | Source of truth |
|---|---|---|
| `transcript` | Claude Code, Codex, Cursor (local session files) | the raw transcript on disk — highest fidelity |
| `self-report` | ChatGPT / Claude web (via MCP) | the model fills the schema; a human review gate confirms before sealing |
| `import` | exported conversation archives | processed client-side |
| `fallback` | anywhere, no transcript or model available | a degraded baton assembled from git state + plan/TODO files; fidelity stays `null` |

---

## Design principles

- **Content-addressed.** Verification anywhere is "recompute and compare."
- **Verify on every read.** A hash mismatch is a loud failure, never silent.
- **Pure core.** State transitions are pure functions; IO lives only in the store and CLI. Everything else plugs in without touching them.
- **Two-tier truth.** The distilled handoff is injected; the full source travels alongside, secrets-scrubbed, sealed, and cited. We never throw away the evidence behind a claim.
- **Honest fields.** `fidelity.score` is `null` until graded; `captureMode: "fallback"` says so when capture was degraded. No fake confidence.
- **No blockchain-speak in the UX.** You see batons, projects, and verification — never blobs or epochs.
- **Zero runtime dependencies in the core.** Node built-ins only. Validation is strict: unknown keys are rejected, because a content-addressed document must contain exactly what gets hashed.

---

## Getting started

Requires **Node ≥ 22.18** (runs TypeScript natively). The pure core has zero runtime dependencies; network adapters use the official Mysten SDKs.

```sh
npm install -g https://github.com/mandatedisrael/Baton/releases/download/v0.4.0/baton-0.4.0.tgz
baton --version
```

For repository development:

```sh
npm install
npm test
```

Then, in a project directory:

```sh
baton init           # set up .baton/ and auto-wire the Claude Code hook
baton login          # create/load your protected Sui identity
baton faucet         # fund it on Testnet, or use a sponsor invitation below
baton fund-storage   # exchange Testnet SUI for WAL storage funds
baton register       # create this project's on-chain memory object
# …just work in your agent — checkpoints accrue automatically…
baton pass           # seal the working state into a baton
baton queue encrypt  # encrypt queued payloads through Seal
baton publish        # encrypt, upload to Walrus, and anchor on Sui
baton fetch <id>     # recover a missing baton through Sui, Walrus, and Seal
baton resume         # verify/recover, then render for the next agent
baton share <address> --out teammate.json  # grant revocable read access
# on the recipient's machine:
baton accept teammate.json                 # verify the grant and join
# back on the owner's machine:
baton revoke <address>                     # deny future Seal key requests
```

(In this repo, run commands as `npm run baton -- <command>` until installed globally.)

To register without first owning SUI, use a one-use invitation from a Baton sponsor operator:

```sh
baton register --sponsor https://sponsor.example --invite <token>
```

The user signs the exact transaction locally and remains the project owner; the sponsor adds only the gas signature. The client refuses changes to the sender, sponsor, package, project, gas coin, budget, or expiry. Invitations are random, stored only as hashes, bound to one user and project on first use, and cannot be replayed for another registration.

For the safest invitation, the user sends the operator the address printed by `baton login` and the project ID printed by `baton status`. The operator binds both before sharing the token:

```sh
baton-sponsor invite --state /var/lib/baton/sponsor.json --ttl-hours 24 \
  --recipient 0xUSER --project PROJECT_ID
baton-sponsor serve --state /var/lib/baton/sponsor.json --identity /secure/sponsor-identity.json
```

The service binds to `127.0.0.1`, signs only Baton's constrained Testnet `create_project` transaction, reserves a concrete gas coin per pending invitation, verifies the user's signature before spending, and never receives the user's private key. File-backed state operations are atomically serialized across the live daemon and operator processes. Operators can inspect invitation status with `baton-sponsor list [--json]`, revoke an unused invitation with `baton-sponsor revoke --id <id>`, and remove expired or revoked records with `baton-sponsor prune`; completed results remain as durable audit records. Baton does not currently operate a public sponsor endpoint.

With `ANTHROPIC_API_KEY` set, checkpoints distill automatically and passes are graded for fidelity. Without it, Baton still works: checkpoints wait, and `baton pass` produces a useful fallback baton from your git working tree. `baton doctor` tells you exactly what's wired up.

### Commands

| Command | What it does |
|---|---|
| `baton init [--no-hooks]` | Initialize a project and register the Claude Code checkpoint hook. |
| `baton login` | Create or load the protected Ed25519 identity in `~/.baton/identity.json`. |
| `baton faucet` | Request SUI for that identity from the official Testnet faucet. |
| `baton fund-storage [--amount <mist>]` | Exchange Testnet SUI for WAL through the official Walrus exchange. |
| `baton register [--package <id>] [--rpc <url>] [--sponsor <url> --invite <token>]` | Register against the canonical Testnet package, optionally with invitation-scoped sponsored gas. |
| `baton publish` | Resume every queued baton through Seal encryption, Walrus certification, and Sui anchoring. |
| `baton fetch <full-id>` | Recover and authenticate a missing baton and all attachments from Sui, Walrus, and Seal. |
| `baton share <address> [--out <file>]` | Grant address-bound read access on Sui and write a public invitation. |
| `baton accept <file>` | Verify a recipient-owned, active `AccessCap` and join the shared project. |
| `baton revoke <address>` | Revoke delegated access on-chain; future uncached decryptions are denied. |
| `baton status` | Show the current working state. |
| `baton pass` | Seal the working state into a baton (commit). |
| `baton log` | List batons, newest first (`*` marks the head). |
| `baton show <id>` | Print a verified baton (short ids ok). |
| `baton resume [id] [--tool <id>]` | Render the resume prompt for a baton (head if omitted). |
| `baton verify <claim-id> [id]` | Verify and print the sealed source lines behind a decision or graveyard entry. |
| `baton queue status` | Show crash-safe progress for batons waiting to be published remotely. |
| `baton queue encrypt` | Encrypt pending canonical handoffs and attachments through Seal. |
| `baton queue upload` | Resume encrypted payloads through Walrus registration, upload, and certification. |
| `baton queue anchor` | Anchor certified Walrus blob references in the project's Sui manifest. |
| `baton render <claude-md\|agents-md\|cursorrules> [id] [--write]` | Project a baton into a per-tool rules file. |
| `baton install` / `uninstall` | Add or remove the Claude Code checkpoint hook. |
| `baton doctor` | Diagnose the install and verify local batons. |

### MCP server

Install Baton globally, then point any stdio-compatible MCP client at the project it may access:

```sh
npm install -g https://github.com/mandatedisrael/Baton/releases/download/v0.4.0/baton-0.4.0.tgz
baton-mcp --project /absolute/path/to/project
```

The server exposes verified status, log, search, show, resume, and citation tools plus guarded self-report checkpoint and pass tools. Each server process is pinned to one project root; `baton_pass` requires explicit confirmation. See [docs/mcp.md](docs/mcp.md) for tool contracts, Codex configuration, generic client configuration, and safety behavior.

---

## Where Baton sits

Handoffs are clearly the primitive every agent vendor wants — Cursor and Codex have each shipped their own. The difference is that a single-vendor handoff lives inside one vendor's walls. A handoff that works *across* Claude Code, Codex, Cursor, and the web can only live on neutral infrastructure that no vendor owns.

- `HANDOFF.md` / `AGENTS.md` files are local prose: no versioning, no verification, no sharing, and they die with your laptop.
- Memory products extract atomic *facts* and discard the source. Baton hands off full *working state* — as verifiable commits — and keeps the source, cited.

Baton is the handoff layer **nobody owns but you**: encrypted client-side, stored on neutral infrastructure, verifiable on-chain, shareable and revocable.

The complete owner-controlled storage path and raw-keypair delegated-reader path are deployed and verified on Testnet: Seal encryption/decryption, resumable Walrus storage/retrieval, Sui manifest anchoring, attachment restoration, automatic recovery during `resume`, address-bound sharing, on-chain revocation, and invitation-scoped sponsored registration all run against live infrastructure. Exact object, blob, hash, capability, and transaction evidence lives in [docs/deployments.md](docs/deployments.md). A public sponsor deployment, zkLogin, external beta hardening, and Mainnet deployment remain in progress, so Baton does not yet claim Mainnet readiness.

---

## License

Apache-2.0
