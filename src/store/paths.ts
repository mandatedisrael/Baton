/**
 * Filesystem layout. A BATON project mirrors git's shape:
 *
 *   <project>/.baton/
 *     config.json        project identity + head pointer
 *     state/working.json rolling WorkingState (local, private)
 *     handoffs/<id>.json sealed commits (local until anchored, phase 3)
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

export function handoffsDir(root: string): string {
  return join(batonDir(root), "handoffs");
}

export function handoffPath(root: string, id: string): string {
  return join(handoffsDir(root), `${id}.json`);
}

/** Walk up from `start` looking for a .baton directory. Null if none. */
export function findProjectRoot(start: string): string | null {
  let dir = start;
  for (;;) {
    if (existsSync(batonDir(dir))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
