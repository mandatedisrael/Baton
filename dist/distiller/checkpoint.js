/** The new turns since `prev`, plus the advanced position. Pure. */
export function sliceDelta(session, prev) {
    const sameSession = session.sessionId !== null && session.sessionId === prev.sessionId;
    const fromLine = sameSession ? prev.line : 0;
    const delta = session.messages.filter((m) => m.line > fromLine);
    const line = session.messages.reduce((mx, m) => Math.max(mx, m.line), fromLine);
    return { delta, cursor: { sessionId: session.sessionId, line } };
}
/**
 * The stable attachment id for a session's transcript. Derived from the session
 * id (not the content hash, which changes as the transcript grows), so a
 * citation minted during an early checkpoint still resolves to the attachment
 * that `pass` eventually seals.
 */
export function transcriptAttachmentId(session) {
    return session.sessionId ? `transcript-${session.sessionId}` : undefined;
}
//# sourceMappingURL=checkpoint.js.map