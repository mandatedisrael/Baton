# Baton introduction video

Editable Remotion source for Baton's 4K project-submission and YouTube introduction.

## Deliverables

- `out/baton-introduction-4k.mp4` — 3840×2160, H.264, AAC stereo, 68.84 seconds
- `out/baton-thumbnail-4k.png` — 3840×2160 YouTube thumbnail
- `out/baton-introduction-preview.mp4` — lightweight 960×540 review copy

The `out/` directory is intentionally ignored by Git. Rendered media remains local while the complete editable source is versioned.

## Commands

```sh
npm install
npm run audio   # regenerate the original electronic sound bed
npm run dev     # open Remotion Studio
npm run lint    # lint and typecheck
npm run render  # render the 4K master
npm run still   # render the 4K thumbnail
```

## Narration

> Your AI agent remembers the task—until you switch tools. Then decisions, failed attempts, and next steps disappear. Meet Baton: Git for agent memory. Baton turns live working context into an immutable, content-addressed commit. It preserves the mission, decisions, the graveyard of failed approaches, and the scrubbed source behind them. Seal encrypts and controls access. Walrus stores the sealed handoff. Sui anchors its lineage, ownership, and publication manifest. Pass once from OpenCode or Codex, then resume in Claude Code—or any MCP-compatible agent. Share access with a teammate. Revoke it on-chain. Verify the payload without trusting a backend. Baton is working on Sui Testnet today, with two hundred and sixty-seven TypeScript tests and nine Move tests passing. Baton. The handoff layer nobody owns but you.

All visuals and the electronic sound bed are original and generated within this project. The narration uses the local macOS Daniel system voice.
