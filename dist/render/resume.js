const RECEIVER_INTRO = {
    "claude-code": "You are Claude Code resuming an in-progress task.",
    codex: "You are Codex resuming an in-progress task.",
    cursor: "You are resuming an in-progress task in Cursor.",
    opencode: "You are OpenCode resuming an in-progress task.",
};
function bullets(items) {
    return items.map((i) => `- ${i}`).join("\n");
}
function numbered(items) {
    return items.map((i, n) => `${n + 1}. ${i}`).join("\n");
}
function lineageLine(chain) {
    if (chain.length === 0)
        return "";
    const parts = chain.map((n) => `${n.shortId} (${n.tool})`);
    return `Lineage: ${parts.join(" ← ")}`;
}
export function renderResumePrompt(handoff, ctx) {
    const sections = [];
    const intro = (ctx.receivingTool && RECEIVER_INTRO[ctx.receivingTool]) || "You are resuming an in-progress task.";
    const self = ctx.chain[0];
    sections.push(`# Resuming baton ${self ? self.shortId : ""}`.trimEnd() +
        `\n\n${intro} The context below is a distilled handoff from a previous agent ` +
        `session — treat it as ground truth for what has already happened. Do not redo ` +
        `work that is already done, and do not repeat anything in the graveyard.` +
        `\n\nYou have access to Baton MCP tools (if the baton-mcp server is connected in this environment): ` +
        `use baton_status to inspect state, baton_resume for fresh context, baton_search for prior details, ` +
        `baton_verify to cross-check citations, baton_checkpoint to save progress mid-session, and baton_pass ` +
        `(with confirm=true) only when the user explicitly wants to seal an immutable handoff. Prefer tool calls over guessing.`);
    const lineage = lineageLine(ctx.chain);
    if (lineage)
        sections.push(lineage);
    sections.push(`## Mission\n${handoff.mission || "(not specified)"}`);
    sections.push(`## Status\n${handoff.status}`);
    if (handoff.graveyard.length > 0) {
        sections.push("## Graveyard — already tried and FAILED, do not repeat\n" +
            bullets(handoff.graveyard.map((g) => `**${g.approach}** — ${g.reason}`)));
    }
    if (handoff.decisions.length > 0) {
        sections.push("## Decisions already made (do not relitigate)\n" +
            bullets(handoff.decisions.map((d) => (d.rationale ? `**${d.choice}** — ${d.rationale}` : `**${d.choice}**`))));
    }
    if (handoff.nextActions.length > 0) {
        sections.push(`## Next actions\n${numbered(handoff.nextActions)}`);
    }
    const repo = handoff.repoMap;
    const repoLines = [];
    if (repo.touched.length > 0)
        repoLines.push(`Touched: ${repo.touched.map((f) => f.path).join(", ")}`);
    if (repo.important.length > 0)
        repoLines.push(`Important: ${repo.important.map((f) => f.path).join(", ")}`);
    if (repo.entryPoints.length > 0)
        repoLines.push(`Entry points: ${repo.entryPoints.join(", ")}`);
    if (repoLines.length > 0)
        sections.push(`## Files\n${repoLines.join("\n")}`);
    if (handoff.envNotes.length > 0)
        sections.push(`## Environment notes\n${bullets(handoff.envNotes)}`);
    if (handoff.verbatimRules.length > 0)
        sections.push(`## Rules (verbatim)\n${bullets(handoff.verbatimRules)}`);
    // Honest provenance footer.
    const fidelity = handoff.fidelity.score === null ? "ungraded" : `${(handoff.fidelity.score * 100).toFixed(0)}%`;
    const caveats = [];
    if (handoff.fidelity.score === null) {
        caveats.push("this handoff is ungraded — verify load-bearing claims before relying on them");
    }
    if (handoff.meta.captureMode === "fallback") {
        caveats.push("captured in fallback mode (no session transcript) — it reflects the working tree, not the full reasoning");
    }
    const footer = [
        "---",
        `Source: ${handoff.meta.tool} · capture ${handoff.meta.captureMode} · fidelity ${fidelity}` +
            (handoff.meta.timestamp ? ` · ${handoff.meta.timestamp}` : ""),
        ...(caveats.length > 0 ? [`Caution: ${caveats.join("; ")}.`] : []),
    ].join("\n");
    sections.push(footer);
    return sections.join("\n\n") + "\n";
}
//# sourceMappingURL=resume.js.map