import { shortId } from "../core/hash.js";
function bullets(items, indent = "  ") {
    return items.map((i) => `${indent}- ${i}`).join("\n");
}
function decisionLine(d) {
    return d.rationale ? `${d.choice} — ${d.rationale}` : d.choice;
}
function graveLine(g) {
    return g.reason ? `${g.approach} — ${g.reason}` : g.approach;
}
export function renderReview(next, info) {
    const prev = info.parent?.handoff ?? null;
    const out = [];
    out.push(`About to seal a baton  ·  ${info.tool} · capture ${info.captureMode}`);
    out.push("─".repeat(60));
    out.push(`mission   ${next.mission || "(not set)"}`);
    out.push(`status    ${next.status}`);
    if (info.transcript) {
        out.push(`source    ${info.transcript.path}`);
        out.push(`transcript ${info.transcript.bytes} bytes · ${info.transcript.lines} lines · encrypted attachment`);
    }
    else {
        out.push("transcript none — working-tree fallback only");
    }
    const scrubbed = info.scrubbedFindings ?? [];
    out.push(scrubbed.length > 0
        ? `secrets   removed ${scrubbed.map((finding) => `${finding.count}× ${finding.type}`).join(", ")}`
        : "secrets   no recognized secret patterns found");
    out.push(info.remoteRegistered
        ? "delivery  local publication queue; `baton publish` encrypts to Walrus and anchors on Sui"
        : "delivery  local publication queue only; project is not registered remotely");
    if (next.decisions.length > 0) {
        out.push(`\ndecisions (${next.decisions.length})`);
        out.push(bullets(next.decisions.map(decisionLine)));
    }
    if (next.graveyard.length > 0) {
        out.push(`\ngraveyard (${next.graveyard.length}) — tried and failed`);
        out.push(bullets(next.graveyard.map(graveLine)));
    }
    if (next.nextActions.length > 0) {
        out.push(`\nnext actions`);
        out.push(next.nextActions.map((a, i) => `  ${i + 1}. ${a}`).join("\n"));
    }
    if (next.repoMap.touched.length > 0) {
        out.push(`\nfiles touched (${next.repoMap.touched.length})`);
        out.push(bullets(next.repoMap.touched.map((f) => f.path)));
    }
    if (next.envNotes.length > 0) {
        out.push(`\nenv notes`);
        out.push(bullets(next.envNotes));
    }
    if (next.verbatimRules.length > 0) {
        out.push(`\nrules`);
        out.push(bullets(next.verbatimRules));
    }
    // Change summary against the parent baton.
    if (prev) {
        const prevDecisions = new Set(prev.decisions.map((d) => d.id));
        const prevGrave = new Set(prev.graveyard.map((g) => g.id));
        const newDecisions = next.decisions.filter((d) => !prevDecisions.has(d.id));
        const newGrave = next.graveyard.filter((g) => !prevGrave.has(g.id));
        const changes = [];
        if (prev.status !== next.status)
            changes.push(`status ${prev.status} → ${next.status}`);
        if (newDecisions.length > 0)
            changes.push(`+${newDecisions.length} decision(s)`);
        if (newGrave.length > 0)
            changes.push(`+${newGrave.length} graveyard entry(ies)`);
        if (prev.mission !== next.mission)
            changes.push("mission changed");
        out.push("─".repeat(60));
        out.push(`since baton ${shortId(info.parent.id)}: ${changes.length > 0 ? changes.join(", ") : "no distilled changes"}`);
    }
    else {
        out.push("─".repeat(60));
        out.push("first baton in this project");
    }
    return out.join("\n") + "\n";
}
//# sourceMappingURL=review.js.map