/**
 * Deterministic fallback distiller (plan §3.3 step 6).
 *
 * When there's no transcript and no model in the loop, BATON still produces an
 * honest, useful handoff from what it can read off disk: the git working tree
 * (which files were touched, with content hashes), the current branch, and
 * unchecked TODO items from a TODO/plan file. The result is flagged
 * `captureMode: "fallback"` with `fidelity.score: null` — no fake confidence.
 *
 * The parsing/derivation functions are pure (string in, struct out) so they
 * test without touching git or the filesystem; `gatherFallbackSignal` is the
 * one IO entry point and degrades gracefully (a non-git directory yields an
 * empty signal, never an error).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FileRef } from "../schema/handoff.ts";
import type { PatchOp } from "../core/working-state.ts";
import { hashBytes } from "../core/hash.ts";

export interface FallbackSignal {
  branch: string | null;
  touched: FileRef[];
  nextActions: string[];
  envNotes: string[];
}

/** Unquote a path as emitted by `git status --porcelain` (quoted when special). */
function unquoteGitPath(p: string): string {
  if (p.startsWith('"') && p.endsWith('"')) {
    try {
      return JSON.parse(p) as string; // git uses C-style escapes, JSON-compatible enough
    } catch {
      return p.slice(1, -1);
    }
  }
  return p;
}

/** Parse `git status --porcelain` output into the set of touched paths. */
export function parseGitStatusPorcelain(out: string): string[] {
  const paths: string[] = [];
  for (const line of out.split("\n")) {
    if (line.trim() === "") continue;
    // Format: "XY <path>" or rename "XY <old> -> <new>".
    const rest = line.slice(3);
    const arrow = rest.indexOf(" -> ");
    const raw = arrow === -1 ? rest : rest.slice(arrow + 4);
    paths.push(unquoteGitPath(raw.trim()));
  }
  return paths;
}

/** Extract unchecked markdown checkbox items (`- [ ] ...`), capped. */
export function extractCheckboxTodos(markdown: string, max = 10): string[] {
  const todos: string[] = [];
  for (const line of markdown.split("\n")) {
    const m = /^\s*[-*]\s+\[ \]\s+(.*\S)\s*$/.exec(line);
    if (m) todos.push(m[1]!);
    if (todos.length >= max) break;
  }
  return todos;
}

/** Pure: turn gathered repo signal into checkpoint patch ops (latest truth wins). */
export function fallbackPatchOps(signal: FallbackSignal): PatchOp[] {
  const ops: PatchOp[] = [];
  if (signal.touched.length > 0) ops.push({ kind: "touch_files", files: signal.touched });
  if (signal.nextActions.length > 0) ops.push({ kind: "set_next_actions", actions: signal.nextActions });
  for (const note of signal.envNotes) ops.push({ kind: "add_env_note", note });
  return ops;
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null; // not a git repo, git missing, etc. — degrade silently
  }
}

const TODO_FILES = ["TODO.md", "TODO", "docs/TODO.md"];

/** Read repo signal from disk. Never throws; missing pieces are simply absent. */
export function gatherFallbackSignal(cwd: string): FallbackSignal {
  // `branch --show-current` reports the branch even on an unborn HEAD (a repo
  // with no commits yet) and is empty in detached-HEAD state.
  const branchRaw = git(cwd, ["branch", "--show-current"]);
  const branch = branchRaw && branchRaw.trim() !== "" ? branchRaw.trim() : null;

  const touched: FileRef[] = [];
  const status = git(cwd, ["status", "--porcelain"]);
  if (status !== null) {
    for (const rel of parseGitStatusPorcelain(status)) {
      // Never record BATON's own metadata directory as a touched file.
      if (rel === ".baton" || rel === ".baton/" || rel.startsWith(".baton/")) continue;
      const abs = join(cwd, rel);
      const ref: FileRef = { path: rel };
      if (existsSync(abs)) {
        try {
          ref.contentHash = hashBytes(readFileSync(abs));
        } catch {
          // unreadable (e.g. a directory entry) — keep the path without a hash
        }
      }
      touched.push(ref);
    }
  }

  const nextActions: string[] = [];
  for (const name of TODO_FILES) {
    const p = join(cwd, name);
    if (existsSync(p)) {
      try {
        nextActions.push(...extractCheckboxTodos(readFileSync(p, "utf8")));
      } catch {
        /* ignore */
      }
      break;
    }
  }

  const envNotes = ["fallback capture: derived from the git working tree; no session transcript was distilled"];

  return { branch, touched, nextActions, envNotes };
}
