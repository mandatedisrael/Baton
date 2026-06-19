import { BatonError } from "../../core/errors.ts";
import { extractCitationSpan, findCitedClaim, renderCitationEvidence } from "../../core/citations.ts";
import { ProjectStore } from "../../store/project.ts";
import { resolveHandoffId } from "../resolve.ts";

/** Build the verified attachment evidence for a distilled claim. */
export function verificationEvidence(cwd: string, claimId: string, idPrefix?: string): string {
  const store = ProjectStore.open(cwd);
  const handoff = store.loadHandoff(resolveHandoffId(store, idPrefix));
  const claim = findCitedClaim(handoff, claimId);
  const attachment = handoff.attachments.find((item) => item.id === claim.citation.attachmentId);
  if (!attachment) {
    throw new BatonError(
      "INVALID_HANDOFF",
      `citation for ${claimId} references missing attachment ${claim.citation.attachmentId}`,
    );
  }
  const lines = extractCitationSpan(store.loadAttachment(attachment), claim.citation);
  return renderCitationEvidence(claim, lines);
}

/** Print the verified attachment lines supporting a distilled claim. */
export function runVerify(cwd: string, claimId: string, idPrefix?: string): void {
  process.stdout.write(verificationEvidence(cwd, claimId, idPrefix));
}
