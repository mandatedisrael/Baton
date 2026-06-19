/** Build the schema Attachment that travels alongside a handoff for this session. */
export function transcriptAttachment(session, id) {
    return {
        id,
        kind: "transcript",
        contentHash: session.raw.hash,
        bytes: session.raw.bytes,
        blobRef: null, // assigned on Walrus upload (phase 3)
    };
}
//# sourceMappingURL=transcript.js.map