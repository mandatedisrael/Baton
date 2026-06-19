import { ProjectStore } from "../../store/project.ts";
import { findProjectRoot } from "../../store/paths.ts";
import { hooksInstalled } from "../hooks.ts";
import { fail, ok, warn } from "../output.ts";
import { loadIdentity, isZkLoginIdentity } from "../../chain/identity.ts";

/**
 * `baton doctor` — diagnose the local installation and project.
 * Every check is independent; doctor never throws, it reports.
 */
export function runDoctor(cwd: string): void {
  let healthy = true;
  const check = (label: string, fn: () => string | void): void => {
    try {
      const detail = fn();
      ok(detail ? `${label}: ${detail}` : label);
    } catch (err) {
      healthy = false;
      fail(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  check("runtime", () => {
    const bun = (process.versions as Record<string, string | undefined>)["bun"];
    return bun ? `bun ${bun}` : `node ${process.versions.node}`;
  });

  const root = findProjectRoot(cwd);
  if (root === null) {
    warn("not inside a baton project — run `baton init` (project checks skipped)");
    process.exit(healthy ? 0 : 1);
  }

  const store = ProjectStore.open(cwd);
  check("project config", () => `project ${store.config().projectId}`);
  check("working state", () => {
    const s = store.loadWorkingState();
    return `${s.checkpointCount} checkpoint(s)`;
  });
  check("handoff integrity", () => {
    const ids = store.listHandoffIds();
    for (const id of ids) store.loadHandoff(id); // verify-on-read throws on tampering
    return `${ids.length} baton(s) verified`;
  });
  check("head pointer", () => {
    const head = store.config().head;
    if (head === null) return "(none yet)";
    store.loadHandoff(head);
    return "resolves and verifies";
  });
  check("publication queue", () => {
    const jobs = store.listUploadJobs();
    const open = jobs.filter((job) => job.status !== "complete").length;
    return `${jobs.length} job(s), ${open} open`;
  });
  if (store.config().remote) {
    const id = loadIdentity();
    const scheme = isZkLoginIdentity(id) ? "zkLogin (google)" : "Ed25519";
    check("Sui identity", () => `${id.record.address} (${scheme})`);
    check("remote project", () => {
      const remote = store.config().remote!;
      return `${remote.network} · ${remote.projectObjectId}`;
    });
  } else {
    warn("remote project: not registered — local handoffs still work; run `baton login` then `baton register`");
  }

  // Capture readiness — surfaced so users can see whether automatic
  // checkpointing is actually wired up, without digging through configs.
  check("checkpoint hook", () =>
    hooksInstalled(store.root)
      ? "installed (Claude Code Stop hook)"
      : "not installed — run `baton install` for automatic checkpoints",
  );
  check("distiller key", () =>
    process.env.ANTHROPIC_API_KEY
      ? "ANTHROPIC_API_KEY set"
      : "ANTHROPIC_API_KEY not set — checkpoints no-op; `pass` uses the git fallback",
  );

  process.exit(healthy ? 0 : 1);
}
