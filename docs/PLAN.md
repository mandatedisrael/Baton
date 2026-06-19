# BATON — Build Plan
### The verifiable handoff & memory protocol for coding agents, on Sui + Walrus + Seal

**Status:** Phases 1–4 are complete. Two raw-keypair Phase 5 slices are live on Testnet: delegated sharing/revocation and invitation-scoped sponsored registration for zero-balance users. A supported-provider zkLogin flow, a public sponsor deployment, and broader multi-user testing remain.

> **Implementation note (kept in sync with the code):** the foundation hashes canonical JSON with **SHA-256** (a Node built-in — preserves the zero-runtime-dependency rule), not BLAKE3. The algorithm is recorded alongside every hash, so a future move to BLAKE3 is a *tagged migration*, not a flag day. The runtime is **Node ≥ 22.18** (native TypeScript execution).

---
## 0. Market & research findings

1. **MemWal exists.** Mysten Labs shipped MemWal (Apache-2.0, `MystenLabs/MemWal`): a "privacy-first AI memory layer" on Walrus — `remember()/recall()/restore()`, semantic search, Seal encryption, **relayer-based architecture** (relayer does embedding + encryption, stores vector metadata in Postgres, returns plaintext). This is validation AND a positioning hazard. Full response in §1.0 and §10. **Rule: never say "memory layer" first. Say "handoff protocol."**
2. **Seal is mainnet** (whitepaper, threshold encryption, on-chain Move policies, key rotation, TS SDK). De-risks the encryption/revocation work and gives a clean "built on Seal" story.
3. **Capture feasibility confirmed:** Claude Code hooks pass `transcript_path` (JSONL) — the micro-checkpoint trigger is documented and real. ChatGPT custom MCP **write actions exist** but full-MCP/developer mode is partially Enterprise/Edu-gated → the live MCP path for web chat is the fragile one; the export-zip path is the reliable one.
4. **Vendors are building single-vendor handoffs:** Cursor CLI shipped "Cloud Handoff"; Codex shipped sub-agent handoffs. Open-source repo-local handoff skills are appearing (`agent-handoff-skill`, `ai-memory`, `agentmemory`). The concept is validated; none are verifiable, shareable, or revocable. **The neutral cross-vendor layer is the moat.**

---
## 1. Product Definition
**One-liner:** Git for agent memory. BATON lets a developer (or team) hand off live coding-agent context between Claude Code, Codex, Cursor, and any MCP-compatible tool — verifiably, across machines, with cryptographic ownership and revocable sharing.

**The mental model (use this everywhere):** a relay race. The runner (agent/model) changes; the race state travels in the baton, not the runner. The user is the coach who owns the baton; agents are temporary runners hired per leg.

### 1.0 The MemWal posture (read before pitching anything)
MemWal is a bet — by the team behind Walrus itself — that "verifiable, portable agent memory on Walrus" is the future. Treat it as the best thing that happened to this project, and handle it deliberately:

- **Different primitive:** MemWal is RAM — atomic facts, semantic recall. BATON is git — sealed commits of full session working-state with lineage, graveyard, and citations. MemWal can tell a new agent what the user prefers; it cannot tell Claude Code what Codex tried 20 minutes ago, why it failed, and prove it.
- **Different trust model:** MemWal's default relayer sees plaintext (it embeds, encrypts, and returns plaintext results). BATON has no server in the trust path: client-side Seal, user keys, hashes on-chain. For sessions full of proprietary code and pasted API keys, this is the disqualifying difference — *"even Walrus's own memory product asks you to trust a relayer; BATON trusts no one."* Say this respectfully, factually, once.
- **Different audience:** MemWal integrates with the Vercel AI SDK — agents you *build*. BATON captures from agents you *already use*, via MCP + session hooks.
- **Complement, don't compete:** same peer deps (`@mysten/seal`, `@mysten/walrus`, `@mysten/sui`). Frame as "the layer above MemWal." Stretch goal: a MemWal adapter that mirrors handoff facts into a MemWal namespace for semantic recall — literal interop.

**The pitch hierarchy (the "isn't this Mem0/MemWal?" defense, in order):**
1. Mem0 freed your memory from OpenAI — and locked it in Mem0's servers.
2. MemWal freed storage from servers — but its relayer still sees your plaintext, and it remembers *facts*, not *working state*.
3. HANDOFF.md files are local prose: no versioning, no verification, no sharing, dies with your laptop.
4. Mem0 extracts your context and **discards the source**; if extraction was wrong, the truth is gone. BATON **seals the source** — fidelity is recoverable, measurable, and attested.
5. BATON is the handoff layer **nobody owns but you**: encrypted client-side (Seal), stored on neutral infrastructure (Walrus), versioned and verifiable on-chain (Sui), shareable and revocable via capability objects.

**Market fit:** applications that handle large, off-chain, or verifiable data — and the existence of MemWal proves the thesis that portable, verifiable agent memory on neutral infrastructure is where this is heading. Anchor every design decision to the words *verifiable* and *handoff*. Bonus narrative: Cursor's Cloud Handoff and Codex sub-agents show every vendor building handoffs *inside their own walls* — the cross-vendor layer can only live on neutral infrastructure.

### 1.1 Personas (build for #1, demo #2, mention #3)
1. **The solo multi-tool dev** — Claude Code for reasoning, Codex for mechanical multi-file work, switches when friction appears. Pain: re-explaining the project, agents repeating failed approaches, context dying with `/clear`. *(Note: MemWal cannot serve this persona at all without writing a custom agent — this is the wedge.)*
2. **The small team** — two or three devs sharing one codebase, each running their own agents. Pain: "what did your agent already try?" Slack archaeology; no shared agent memory; offboarding a contractor means hoping.
3. **The agent fleet operator** — parallel/overnight agentic sessions. Pain: handoffs between runs are distributed-systems state with no state store.

### 1.2 What BATON is NOT (scope law)
- Not a general chat-memory extension (Mem0's lane — stay out).
- Not a semantic-recall fact store (MemWal's lane — stay out; integrate later).
- Not a model router or proxy; we never sit between dev and model.
- Not a new agent; BATON is infrastructure existing agents read/write through MCP.
- Not blockchain-visible: no wallet-speak, no "blob," no "epoch" in UX. A future zkLogin flow must use a provider supported by Sui; GitHub is not currently one of them.

---
## 2. Core Concepts & Data Model
### 2.1 The Working State & the Handoff
Two things (the core architectural distinction):

**WorkingState (rolling, local):** a continuously-updated structured state of the live session, built by micro-checkpoints (§3.3). Lives in local encrypted cache during the session.

**Handoff (sealed commit):** `/baton pass` finalizes the current WorkingState into an immutable, sealed, anchored handoff — a *commit*, not a one-shot summary. Schema v1 (canonical JSON, SHA-256-hashed — BLAKE3 is a tagged future migration):
- `meta`: project_id, branch, tool (claude-code | codex | cursor | chatgpt-web | other), capture_mode (transcript | self-report | import | fallback), model, author, timestamp, parent_handoff_id(s)
- `mission`: current goal, 1–3 sentences
- `status`: done / in-progress / blocked
- `decisions[]`: choice + rationale + **citation** (transcript span ref)
- `graveyard[]`: failed approach + why it failed + **citation** ← highest-value field
- `repo_map`: files touched / files that matter / entry points (paths + content hashes)
- `next_actions[]`: ordered, concrete
- `env_notes`: versions, quirks, setup landmines
- `attachments[]`: content-addressed source metadata — **full scrubbed transcript (always, in transcript-mode)**, large diffs, plan files; lazy-loaded
- `verbatim_rules`: content destined for CLAUDE.md / AGENTS.md rendering
- `fidelity`: score (0–1), grader model id, grading rubric version, per-section confidence
- `schema_version`

> *Wire-format note:* the implemented canonical JSON uses **camelCase** field names (`projectId`, `parents`, `repoMap`, `nextActions`, `captureMode`, `verbatimRules`, `schemaVersion`). Because the document is content-addressed and shared cross-tool, this casing is a permanent, byte-significant decision — every writer must agree. The snake_case names above are the conceptual field list; the code (`src/schema/handoff.ts`) is the normative wire format.

Two-tier truth: the **distilled handoff** (~2–8 KB) is what gets injected — cheap tokens, instant resumes. The **full source** is secrets-scrubbed before it travels alongside as an attachment, and every claim cites spans of it. We never throw away the evidence behind a claim. (Mem0 structurally cannot do this; their economics assume raw context is discarded. MemWal stores memories but has no source/citation model — there is no "source" behind a fact. Ours assumes the source is sealed — Walrus makes keeping it affordable.)

### 2.2 On-chain objects (Move)
- **ProjectMemory** (shared): root. Project metadata, head handoff per branch, member capability registry, Seal policy id.
- **HandoffManifest** (dynamic field under ProjectMemory): version, content hash, Walrus blob ids, parent pointer(s) → lineage DAG (merges = two parents, like git), **fidelity_score + grader attestation**, capture_mode.
- **AccessCap** (capability, transferable + revocable): read or read/write on a ProjectMemory. Revocation = registry flip + Seal policy rotation → cryptographic, not cosmetic.
- **ToolAttestation** (event): which tool/session consumed which handoff, hash-verified — the audit trail.

Principle: **chain stores hashes, pointers, policy, and fidelity attestations — never content.** The chain attests two distinct things: *integrity* (nothing changed since sealing) and *measured fidelity* (this distillation scored 0.93 against its source, graded by model X under rubric v1). No one else in this space — including MemWal — attests the second thing.

### 2.3 Trust model
- Client-side Seal encryption before anything leaves the machine. Walrus sees ciphertext; Sui sees hashes and scores. **No relayer, no server, nothing in the trust path that sees plaintext** (contrast with MemWal default flow — state this in the threat-model doc, factually).
- Verify-on-resume: fetch → decrypt → canonicalize → SHA-256 → compare to manifest. Mismatch = loud refusal.
- Receiving model can **cross-examine** (§3.4): spot-check any distilled claim against its cited transcript span before acting.
- Identity via zkLogin; raw-keypair mode for CI/headless.
- Seal is mainnet with threshold encryption across independent key servers + on-chain Move policies + documented key rotation. Verify rotation semantics in practice during the chain-and-storage phase.

---
## 3. System Architecture
### 3.1 Components
1. **`baton` CLI** (TypeScript, Node ≥22.18 native TS) — init, login, pass, resume, log, share, revoke, doctor, review. Also the engine the MCP server shells into; one codebase.
2. **MCP server** (`baton-mcp`) — the universal integration surface. Tools: `baton_pass`, `baton_resume`, `baton_verify`, `baton_log`, `baton_search`. Claude Code, Codex, Cursor, and ChatGPT/Claude web (custom connectors / "apps") all speak MCP → one integration, zero per-tool plugins. *(Note: ChatGPT renamed connectors → "apps"; custom MCP apps support write actions; developer mode partially Enterprise/Edu-gated — verify exact consumer-tier capabilities before depending on the live web path.)*
3. **Distillation engine** — §3.3. The product lives here.
4. **Fidelity grader** — at pass-time, a second (cheap) model grades the distillation against the source transcript: decisions captured? graveyard matches actual failures? next_actions consistent with session end-state? Outputs score + per-section confidence → written into the manifest. Rubric versioned.
5. **Dialect renderer** — projects canonical handoff into CLAUDE.md / AGENTS.md / .cursorrules and the per-tool resume prompt.
6. **Storage layer** — Walrus TS SDK (blob put/get), Seal TS SDK (encrypt/decrypt/policy), Sui TS SDK (PTBs) — same peer deps MemWal uses; we use them directly, no relayer. Async write queue (`pass` returns <1s locally, uploads in background with retry); local encrypted cache (own-latest resume is instant).
7. **Move package** (`baton_core`) — §2.2 objects + events. <600 lines, boring on purpose.
8. **Web viewer** (read-only, hosted on Walrus Sites) — lineage DAG, handoff browser, diff view, fidelity scores per node.

### 3.2 Capture modes (the asymmetry, made explicit)
| Mode | Where | Source of truth | Fidelity ceiling |
|---|---|---|---|
| **transcript** | Claude Code, Codex CLI, Cursor (local session files: JSONL etc. — Claude Code hooks deliver `transcript_path` directly ✓ verified) | Raw transcript on disk | Highest — distill from ground truth, attach source |
| **self-report** | ChatGPT web, Claude web (MCP connector/app) | Model fills the handoff schema as tool-call args | Medium — schema-forced structure + mandatory human review gate |
| **import** | ChatGPT/Claude data-export zips → BATON web app | Exported conversations.json | High for history, processed client-side in browser |

Architecture stays one protocol with multiple capture adapters; schema, Walrus, Seal, Move never change between modes.

### 3.3 Distillation pipeline — continuous micro-checkpointing
1. **Micro-checkpoints (transcript mode):** session hooks fire on events — every N turns, every tool call, every test run / git commit. Each fires a tiny extraction over just the delta (recent turns + rolling state as context) that proposes patch operations to the WorkingState: ADD a decision, UPDATE status, MOVE an approach to graveyard, NOOP. Small targets, small errors, self-correcting — later checkpoints overwrite earlier mistakes ("latest truth wins").
2. **Pass = commit:** `/baton pass` finalizes the already-accumulated WorkingState (final consistency sweep, secrets scrub, citation check), so sealing takes seconds and isn't a single point of summarization failure.
3. **Secrets scrubbing** (regex + entropy scan over both distillate AND attachments) runs *before* encryption — devs paste API keys into sessions constantly; we must not immortalize them.
4. **Fidelity grading** runs on the finalized handoff vs. source; score into manifest.
5. **Review gate:** in self-report mode (web chats), the user sees the distillation diff and approves before sealing — 10 seconds that convert the weakest capture mode into the most user-trusted one. Optional in transcript mode (`baton pass --review`).
6. **Deterministic fallback:** no transcript access and no model available → assemble a degraded handoff from git status + plan files + todo lists, flagged `capture_mode: fallback`, fidelity score null.

Extraction uses the *user's own current model/session* where possible — no BATON-side LLM costs, no content leaving their account; the grader runs on a cheap model via the user's configured key.

### 3.4 The flows
**CHECKPOINT (continuous, invisible):** event → delta extraction → patch WorkingState in local encrypted cache.
**PASS:** finalize WorkingState → scrub → canonicalize → hash → fidelity grade → Seal-encrypt (handoff + attachments) → Walrus put (async queue) → PTB: HandoffManifest under ProjectMemory (hash, blob ids, parents, fidelity) → `baton #48 passed ✓ fidelity 0.93 (verifiable @ suiscan link)`.
**RESUME:** read head manifest → fetch (cache-first) → decrypt → verify hash → render resume prompt for the receiving tool → inject, with lineage line: `resuming #48 ← #47 (codex) ← #46 (claude-code)`.
**VERIFY (cross-examination):** receiving model calls `baton_verify(claim_id)` → returns the cited transcript span → model confirms or flags before acting. Distrust-by-default between models, ground truth one fetch away.
**SHARE / REVOKE:** `baton share ada@team --read` mints AccessCap + Seal policy add → her `resume` just works. `baton revoke` flips registry + rotates policy → her next fetch decrypts nothing. (Forward-only — §9.)

### 3.5 Stack (locked)
TypeScript end-to-end; Node ≥22.18 (native TypeScript execution); Move 2024 edition; testnet during development, mainnet for release (Seal mainnet-ready ✓). Baton content has no plaintext backend: the CLI talks directly to Sui, Walrus, and Seal. The optional constrained sponsor signs only registration gas and never receives content or user keys. The web viewer is static on Walrus Sites.

---
## 4. User Journeys (write the docs from these)
### Journey A — Sarah, the cross-tool dev (the hero use case)
Setup once: install the versioned tarball from the GitHub Release → `baton login` → `baton init`. Then: 3-hour Codex session, micro-checkpoints accumulating silently; Codex fumbles a refactor; `/baton pass` → one second → `baton #13 passed ✓ fidelity 0.94`. Opens Claude Code on a different laptop → "Resume from baton #13 (Codex, 4 min ago)?" → Claude: *"Picking up the auth refactor. Codex tried wrapping the middleware twice — failed on the session-token race (verified ✓). Plan says queue approach next; starting there."* She never re-explained anything; the new model knows what the old one failed at, and checked.

### Journey B — Daniel, ChatGPT → Claude (the bigger-than-coding case)
Two weeks of startup planning in ChatGPT. **Path 1 (live):** BATON MCP app in ChatGPT → "pass the baton" → model fills the schema as a tool call → review gate shows him exactly what travels → approve → sealed. **Path 2 (history, more robust):** Settings→Export zip → BATON web app distills client-side in his browser → review → sealed per-project batons. In Claude: add the BATON connector → "pick up my startup project" → verified resume. Two weeks of thinking now belongs to him, not OpenAI. *(The live web path depends on platform connector/app gating; the export path is the dependable fallback.)*

### Journey C — the team
Ada joins the project: `baton share ada --read` → her agents resume with full project memory and the graveyard of everything already tried. She leaves: `baton revoke ada` → policy rotated → her next fetch decrypts nothing.

---
## 5. Production-Readiness Bar
- Clean-machine install (`npm i -g` → working in 5 min), tested in Docker on macOS/Linux.
- zkLogin onboarding; sponsored gas (gas station) for free tier — users never buy SUI to try it.
- Graceful degradation: Walrus down → local queue + warn, never lose a handoff; chain down → local-only with deferred anchoring; hash mismatch → loud refusal to inject; partial uploads resume; idempotent retries.
- Secrets scrubber on by default; threat model document published (incl. the factual relayer-vs-no-relayer comparison); `sui move test` suite + external security review of the Move package.
- Opt-in telemetry, counts not content.
- Docs: 5-min quickstart, per-tool MCP setup, schema reference, threat model, **Known Limitations page (§9 verbatim — honesty as a feature)**.
- `schema_version` + migration path from day one. Fidelity rubric versioned.

---
## 6. Roadmap — six phases
The build proceeds in six phases; each is shippable and dogfoodable on its own. Phases 1 and 2 form the completed local engine; later phases layer chain, storage, and integrations on top without weakening the pure core.

**Phase 1 — Foundation** *(done)*
Handoff schema v1 + strict validator (the wire format). Canonical JSON + SHA-256 content addressing. WorkingState + checkpoint patch ops (ADD/UPDATE/GRAVEYARD/NOOP). Local store (`.baton/`) with atomic writes and verify-on-read. Six-command CLI skeleton (init/status/pass/log/show/doctor). Zero runtime dependencies.

**Phase 2 — Distiller** *(done for Claude Code; Codex/Cursor adapters remain integration work)*
Claude Code hooks → transcripts. The micro-checkpoint loop: event hooks → delta extraction → WorkingState patch ops. Pass-as-commit finalization. Secrets scrubber over the distillate and source. Durable content-addressed attachments. Fidelity grader + rubric v1. Review-gate UX. Dialect renderer + resume prompts. Deterministic fallback and `baton verify` cross-examination. **Dogfood from the start: build BATON using BATON.** Tracked metrics: graveyard recall (does the handoff contain what actually failed?) and fidelity-score distribution.

**Phase 3 — Chain & storage** *(done for the owner-controlled Testnet path)*
The deployed Move package provides `ProjectMemory`, owner capabilities, branch-aware `HandoffManifest` dynamic fields, bounded metadata, ownership transfer, and project-scoped Seal policies. The CLI generates real Ed25519 identities, acquires official Testnet WAL, registers shared project objects, encrypts canonical handoffs and attachments through Seal, persists every recoverable Walrus SDK checkpoint, certifies blobs, and anchors their manifests on Sui. Publication is independently resumable at encryption, registration, upload, certification, and anchoring boundaries; interrupted anchors are verified on-chain before retrying. On recovery, Baton strictly parses the Sui dynamic field, downloads bounded ciphertext from a configured HTTPS aggregator, verifies any local ciphertext receipt, checks the embedded Seal identity/package, obtains keys through the applicable owner or delegated policy, verifies every plaintext hash and manifest field, then persists the complete set atomically. `resume` automatically invokes this path for missing batons or attachments.

**Phase 4 — MCP + renderer** *(done for local stdio clients)*
`baton-mcp` is a project-scoped stdio server built on the official MCP TypeScript SDK. It exposes `baton_status`, `baton_log`, `baton_search`, `baton_show`, `baton_resume`, `baton_verify`, `baton_checkpoint`, and `baton_pass` with strict schemas and truthful read/write/open-world annotations. CLI and MCP share the same verified query, resume, citation, self-report, scrub, and pass engines. Server initialization carries concise agent workflow instructions; writes never print into protocol stdout, self-report snapshots replace latest-truth sections without duplicate retries, and immutable pass creation requires explicit `confirm=true`. Protocol tests spawn a real client/server pair over stdio and exercise discovery, schema validation, reads, writes, error framing, and resume rendering. The npm artifact explicitly allowlists runtime source and README so local settings, tests, and untracked workspace files cannot leak into a release.

**Phase 5 — Identity & sharing**
Raw-keypair delegated access is complete on Testnet: non-transferable address-bound `AccessCap`s, live recipient verification, generation-safe re-granting, invitation acceptance, delegated recovery, and revocation enforced by Seal key servers. Invitation-scoped sponsored registration is also proven on Testnet with a zero-balance user: user and sponsor sign identical bytes, the sponsor reconstructs only the allowed `create_project` call, concrete gas coins are reserved, and invitations are hashed, one-use, and identity/project-bound. Remaining: zkLogin onboarding through a Sui-supported OAuth provider, public sponsor deployment/operations, and broader multi-user Journey C testing.

**Phase 6 — Viewer & hardening**
Walrus Sites lineage viewer (DAG, handoff browser, fidelity badges; diff view). Failure-mode hardening — kill wifi mid-pass, corrupt a blob, revoke mid-session; every failure graceful and *narratable*. Self-report mode against ChatGPT web + import path for export zips. Mainnet release. Beta with external devs; collect installs, batons passed, cross-tool resumes, mean fidelity.

*(If scope pressure mounts, pre-committed cuts in order: (1) viewer diff feature, (2) import-zip path, (3) Cursor adapter, (4) MemWal adapter stretch goal. **Never cut:** two-machine cross-tool resume, verify-on-resume, share/revoke.)*

---
## 7. Roles
- **Lead:** architecture, Move package, Sui/Walrus/Seal integration, distiller + fidelity grader, ecosystem relationships, narrative.
- **CLI/UX:** CLI commands, dialect renderer, docs.
- **Web/QA:** web viewer, testing matrix, demo production.
- **Security review:** Move review + threat-model second pair of eyes.

(Roles, not headcount — one person can wear several early on.)

---
## 8. Demo walkthrough (≈120 seconds)
1. (0:00) Split screen, two machines. Left: Codex mid-task, hits a wall. `/baton pass` → one second → `baton #12 ✓ fidelity 0.94`.
2. (0:20) Right: Claude Code greets — *"Resuming baton #12 from Codex — hash verified ✓. Codex tried Redis pub/sub; failed on connection pooling (I checked the transcript). Continuing with SSE, step 3 of 5."* Beat: the new model knows what the old one failed at — **and verified it.**
3. (0:50) Walrus Sites viewer: the project's lineage DAG — every handoff, every tool switch, fidelity score on every node.
4. (1:10) Trust beat: `baton share` → teammate resumes live; `baton revoke` → her next fetch fails to decrypt. "Try revoking a markdown file."
5. (1:30) Numbers: installs, batons passed, cross-tool resumes, mean fidelity — and our own DAG, since we built BATON with BATON.
6. (1:50) Close: "Mem0 extracts your memory and throws away the source. MemWal remembers facts — through a relayer. BATON hands off working state, seals the source, grades the summary, and puts the receipt on-chain — same Walrus stack, one layer up, trusting no one. The handoff layer nobody owns but you."

---
## 9. Known Limitations (publish this — honesty is a feature)
- **Fidelity gap:** the hash proves integrity (nothing changed after sealing), not that the distillation was a faithful summary. Our answer is layered, not absolute: distill from raw transcripts where we have them; micro-checkpoint so errors are small and self-correcting; grade every handoff and attest the score; preserve the source so fidelity is *recoverable*; let the receiving model cross-examine. We measure fidelity — we don't pretend to guarantee it.
- **Capture asymmetry:** CLI capture is complete (local transcripts); web-chat capture is what the model volunteers + human review. Quality is platform-dependent and we say so (capture_mode is on every manifest).
- **Revocation is forward-only:** revoking cuts off all future decryption; it cannot unread what someone already fetched. No cryptosystem fixes that; claiming otherwise would be dishonest.
- **Semantic translation:** a handoff distilled by GPT and read by Claude can be misweighted — hence per-tool resume rendering + verify-on-resume, but it's mitigation, not elimination.
- **Branch divergence:** parallel sessions create sibling batons; the DAG handles structure (merge = two parents) but merging *meaning* is on the user in v1 — we warn loudly and let them pick a head.
- **Platform fragility:** web platforms can change connector/app policies under us. This is precisely the argument for the protocol layer living on neutral infrastructure they can't take away.
- **Tool-call size limits:** self-report mode is bounded by tool-arg token limits; large attachments are CLI-mode only.
- **No semantic search in v1:** BATON resumes by lineage, not by similarity. If you want "recall everything about X across projects," that's a fact-store problem — MemWal's lane, and a future integration, not a v1 feature.

---
## 10. Competitive Posture
| | HANDOFF.md / AGENTS.md | Mem0 / OpenMemory | **MemWal** | **BATON** |
|---|---|---|---|---|
| Primitive | static project briefing | atomic facts/preferences | atomic memories + semantic recall | full working state of sessions, as commits |
| Capture | manual prose | continuous extraction (intercepted messages) | explicit `remember()` calls from agents you build | continuous micro-checkpoints + sealed commits from tools you already use |
| Source retention | n/a | **discarded after extraction** | stores the memory, no source/citation model | **sealed on Walrus, cited per claim** |
| Fidelity | unmeasured | mitigated by incrementalism, unverifiable | n/a (no distillation step) | measured, scored, attested on-chain; cross-examinable |
| Trust path | your laptop | Mem0's servers | **relayer sees plaintext** (default flow); storage decentralized | client-side encrypted; no server, no relayer |
| Verification | none | none | blob-integrity proofs | hash-verified on every resume + fidelity attestation |
| Lineage / versioning | none | none | none | git-style DAG, merge parents |
| Sharing/revocation | copy the file / hope | account features | namespace sharing via relayer | capability objects + cryptographic policy rotation |
| Cross-machine | no | yes (their cloud) | yes (Walrus + their relayer) | yes (no one's cloud) |

The philosophical forks to state plainly: *Mem0's architecture assumes raw context is discarded; BATON's assumes it is sealed and kept. MemWal's architecture assumes a relayer in the trust path; BATON's assumes no one is. They validate our thesis on our exact stack — and cannot copy our moves without becoming different products.*

Also name the vendor trend: Cursor Cloud Handoff and Codex sub-agent handoffs prove handoffs are the primitive everyone wants — each locked inside one vendor. The cross-vendor version structurally requires neutral infrastructure. That's the whole company.

---
## 11. Risks & Mitigations
- **"Isn't this MemWal?" (top risk)** → §1.0 posture + §10 table; never lead with "memory layer"; engage the MemWal community early so the complement story is established; relayer-trust contrast stated factually in threat model.
- **Distillation quality mediocre** → phase 2 fully dedicated to it; dogfood from the start; graveyard-recall + fidelity distribution as tracked metrics; fall back to more verbatim context when confidence is low.
- **Seal revocation semantics surprise us** → spike during phase 3 (Seal is mainnet with documented rotation — risk reduced, not zero); fallback = per-member key-wrapping with on-chain wrapped-key registry.
- **MCP behavior differs across clients** (incl. ChatGPT app-tier gating) → test all four with an explicit go/no-go for the live web path; the CLI remains the universal fallback so demos never depend on one client's quirks.
- **Walrus latency in hot path** → async queue + cache from day one; `pass` never blocks on network.
- **"Isn't this Mem0?"** → §1.0 hierarchy + §10 table + the source-retention fork.
- **Fidelity grader gamed/noisy** → versioned rubric, grader model id attested, score is a signal not a guarantee (and we say so — §9).
- **Someone else claims "Git for agent memory" first** (open-source handoff skills multiplying) → ship publicly early; the phrase + the verifiable version of the idea must be ours before the category names itself.
- **Scope creep** → §1.2 is law; pre-committed cut list in §6.

## 12. Path to product
Free tier (sponsored gas, public-good CLI/protocol) → Team tier (shared ProjectMemory, seats, SSO) → Fleet tier (CI/headless agents, attested audit trails for the compliance crowd — the fidelity attestations become a regulatory product). Open protocol + paid convenience: the Git → GitHub playbook. Natural ecosystem fit: BATON handoffs feeding MemWal namespaces for semantic recall = a two-layer memory stack.

---
*Next drafts: Move module signatures (full skeleton), handoff JSON schema v1 (formal, with citation + fidelity fields), micro-checkpoint extraction prompt v1 + fidelity rubric v1.*
