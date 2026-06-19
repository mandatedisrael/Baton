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

export function batonDir(root: string): string {
  return join(root, BATON_DIR);
}

export function configPath(root: string): string {
  return join(batonDir(root), "config.json");
}

export function workingStatePath(root: string): string {
  return join(batonDir(root), "state", "working.json");
}

export function cursorPath(root: string): string {
  return join(batonDir(root), "state", "cursor.json");
}

export function handoffsDir(root: string): string {
  return join(batonDir(root), "handoffs");
}

export function handoffPath(root: string, id: string): string {
  return join(handoffsDir(root), `${id}.json`);
}

export function attachmentsDir(root: string): string {
  return join(batonDir(root), "attachments");
}

export function attachmentPath(root: string, contentHash: string): string {
  return join(attachmentsDir(root), contentHash);
}

export function queueDir(root: string): string {
  return join(batonDir(root), "queue");
}

export function uploadJobPath(root: string, handoffId: string): string {
  return join(queueDir(root), `${handoffId}.json`);
}

export function encryptedPayloadsDir(root: string, handoffId: string): string {
  return join(queueDir(root), "payloads", handoffId);
}

export function encryptedPayloadPath(root: string, handoffId: string, contentHash: string): string {
  return join(encryptedPayloadsDir(root, handoffId), `${contentHash}.seal`);
}

export function remoteDir(root: string): string {
  return join(batonDir(root), "remote");
}

export function remoteSidecarPath(root: string, handoffId: string): string {
  return join(remoteDir(root), `${handoffId}.json`);
}

/** Walk up from `start` looking for a Baton project config. Null if none.
 * The global identity also lives in ~/.baton, so the directory alone is not
 * a sufficient project marker.
 */
export function findProjectRoot(start: string): string | null {
  let dir = start;
  for (;;) {
    if (existsSync(configPath(dir))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
