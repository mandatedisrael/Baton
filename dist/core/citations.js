import { BatonError } from "./errors.js";
/** Resolve a distilled claim and require that it carries source evidence. */
export function findCitedClaim(handoff, claimId) {
    const decision = handoff.decisions.find((item) => item.id === claimId);
    if (decision) {
        if (!decision.citation)
            throw new BatonError("NOT_FOUND", `decision ${claimId} has no source citation`);
        return { kind: "decision", id: claimId, summary: decision.choice, citation: decision.citation };
    }
    const graveyard = handoff.graveyard.find((item) => item.id === claimId);
    if (graveyard) {
        if (!graveyard.citation) {
            throw new BatonError("NOT_FOUND", `graveyard entry ${claimId} has no source citation`);
        }
        return { kind: "graveyard", id: claimId, summary: graveyard.approach, citation: graveyard.citation };
    }
    throw new BatonError("NOT_FOUND", `no decision or graveyard entry named ${claimId}`);
}
/** Extract an inclusive, 1-based line span without changing its source text. */
export function extractCitationSpan(source, citation) {
    const text = typeof source === "string" ? source : Buffer.from(source).toString("utf8");
    const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
    if (citation.fromLine < 1 || citation.toLine > lines.length || citation.toLine < citation.fromLine) {
        throw new BatonError("INVALID_HANDOFF", `citation lines ${citation.fromLine}-${citation.toLine} fall outside attachment (${lines.length} lines)`);
    }
    return lines.slice(citation.fromLine - 1, citation.toLine);
}
export function renderCitationEvidence(claim, lines) {
    const numbered = lines.map((line, index) => `${claim.citation.fromLine + index}: ${line}`).join("\n");
    return [
        `${claim.kind} ${claim.id}: ${claim.summary}`,
        `source ${claim.citation.attachmentId}, lines ${claim.citation.fromLine}-${claim.citation.toLine} (verified)`,
        "",
        numbered,
        "",
    ].join("\n");
}
//# sourceMappingURL=citations.js.map