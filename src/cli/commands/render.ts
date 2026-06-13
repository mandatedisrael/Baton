import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BatonError } from "../../core/errors.ts";
import { shortId } from "../../core/hash.ts";
import { ProjectStore } from "../../store/project.ts";
import {
  BEGIN_MARKER,
  END_MARKER,
  RULES_TARGETS,
  hasRulesContent,
  renderRulesBlock,
  upsertManagedBlock,
  type RulesFormat,
} from "../../render/rules.ts";
import { ok, warn } from "../output.ts";

function resolve(store: ProjectStore, idPrefix: string | undefined): string {
  if (idPrefix === undefined) {
    const head = store.config().head;
    if (head === null) throw new BatonError("NOT_FOUND", "no batons yet — run `baton pass` first");
    return head;
  }
  const matches = store.listHandoffIds().filter((id) => id.startsWith(idPrefix));
  if (matches.length === 0) throw new BatonError("NOT_FOUND", `no baton matching "${idPrefix}"`);
  if (matches.length > 1) {
    throw new BatonError("NOT_FOUND", `ambiguous id "${idPrefix}" (${matches.length} matches)`);
  }
  return matches[0]!;
}

/**
 * `baton render <format> [id] [--write]` — project a handoff into a per-tool
 * rules file. Prints to stdout by default; `--write` upserts the BATON-managed
 * block into the conventional file at the project root, leaving any
 * hand-written content intact.
 */
export function runRender(cwd: string, format: RulesFormat, idPrefix?: string, write = false): void {
  const store = ProjectStore.open(cwd);
  const id = resolve(store, idPrefix);
  const handoff = store.loadHandoff(id); // verifies the hash before rendering

  if (!hasRulesContent(handoff)) {
    warn(`baton ${shortId(id)} has no verbatim rules or env notes to render — nothing written`);
    return;
  }

  const body = renderRulesBlock(handoff, shortId(id));
  const target = RULES_TARGETS[format];

  if (!write) {
    process.stdout.write(`${BEGIN_MARKER}\n${body}\n${END_MARKER}\n`);
    return;
  }

  const path = join(store.root, target.filename);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const next = upsertManagedBlock(existing, body);
  if (next === existing) {
    ok(`${target.filename} already up to date`);
    return;
  }

  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, next);
    renameSync(tmp, path);
  } catch (err) {
    throw new BatonError("IO_ERROR", `failed writing ${path}`, { cause: err });
  }
  ok(`${existing === "" ? "wrote" : "updated"} ${target.filename} from baton ${shortId(id)}`);
}
