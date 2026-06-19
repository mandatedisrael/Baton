/**
 * Filesystem layout. A BATON project mirrors git's shape:
 *
 *   <project>/.baton/
 *     config.json        project identity + head pointer
 *     state/working.json rolling WorkingState (local, private)
 *     state/cursor.json  checkpoint cursor (last distilled transcript position)
 *     handoffs/<id>.json sealed commits (local until anchored, phase 3)
 *     attachments/<hash> raw source bytes, addressed and verified by content
 *     queue/<id>.json    crash-safe remote publication jobs
 *     remote/<id>.json   completed Walrus + Sui publication metadata
 *
 * `findProjectRoot` walks up from cwd like git does, so every command works
 * from any subdirectory.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
export const BATON_DIR = ".baton";
export function batonDir(root) {
    return join(root, BATON_DIR);
}
export function configPath(root) {
    return join(batonDir(root), "config.json");
}
export function workingStatePath(root) {
    return join(batonDir(root), "state", "working.json");
}
export function cursorPath(root) {
    return join(batonDir(root), "state", "cursor.json");
}
export function handoffsDir(root) {
    return join(batonDir(root), "handoffs");
}
export function handoffPath(root, id) {
    return join(handoffsDir(root), `${id}.json`);
}
export function attachmentsDir(root) {
    return join(batonDir(root), "attachments");
}
export function attachmentPath(root, contentHash) {
    return join(attachmentsDir(root), contentHash);
}
export function queueDir(root) {
    return join(batonDir(root), "queue");
}
export function uploadJobPath(root, handoffId) {
    return join(queueDir(root), `${handoffId}.json`);
}
export function encryptedPayloadsDir(root, handoffId) {
    return join(queueDir(root), "payloads", handoffId);
}
export function encryptedPayloadPath(root, handoffId, contentHash) {
    return join(encryptedPayloadsDir(root, handoffId), `${contentHash}.seal`);
}
export function remoteDir(root) {
    return join(batonDir(root), "remote");
}
export function remoteSidecarPath(root, handoffId) {
    return join(remoteDir(root), `${handoffId}.json`);
}
/** Walk up from `start` looking for a Baton project config. Null if none.
 * The global identity also lives in ~/.baton, so the directory alone is not
 * a sufficient project marker.
 */
export function findProjectRoot(start) {
    let dir = start;
    for (;;) {
        if (existsSync(configPath(dir)))
            return dir;
        const parent = dirname(dir);
        if (parent === dir)
            return null;
        dir = parent;
    }
}
//# sourceMappingURL=paths.js.map