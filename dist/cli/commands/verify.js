import { BatonError } from "../../core/errors.js";
import { extractCitationSpan, findCitedClaim, renderCitationEvidence } from "../../core/citations.js";
import { ProjectStore } from "../../store/project.js";
import { resolveHandoffId } from "../resolve.js";
/** Build the verified attachment evidence for a distilled claim. */
export function verificationEvidence(cwd, claimId, idPrefix) {
    const store = ProjectStore.open(cwd);
    return verificationEvidenceFromStore(store, claimId, idPrefix);
}
export function verificationEvidenceFromStore(store, claimId, idPrefix) {
    const handoff = store.loadHandoff(resolveHandoffId(store, idPrefix));
    const claim = findCitedClaim(handoff, claimId);
    const attachment = handoff.attachments.find((item) => item.id === claim.citation.attachmentId);
    if (!attachment) {
        throw new BatonError("INVALID_HANDOFF", `citation for ${claimId} references missing attachment ${claim.citation.attachmentId}`);
    }
    const lines = extractCitationSpan(store.loadAttachment(attachment), claim.citation);
    return renderCitationEvidence(claim, lines);
}
/** Print the verified attachment lines supporting a distilled claim. */
export function runVerify(cwd, claimId, idPrefix) {
    process.stdout.write(verificationEvidence(cwd, claimId, idPrefix));
}
//# sourceMappingURL=verify.js.map