import { ProjectStore } from "../../store/project.js";
import { findProjectRoot } from "../../store/paths.js";
import { hooksInstalled } from "../hooks.js";
import { fail, ok, warn } from "../output.js";
import { loadIdentity, isZkLoginIdentity } from "../../chain/identity.js";
import { probeHttpsEndpoint } from "../../chain/network-health.js";
/**
 * `baton doctor` — diagnose the local installation and project.
 * Every check is independent; doctor never throws, it reports.
 */
export async function runDoctor(cwd, options = {}) {
    let healthy = true;
    const check = (label, fn) => {
        try {
            const detail = fn();
            ok(detail ? `${label}: ${detail}` : label);
        }
        catch (err) {
            healthy = false;
            fail(`${label}: ${err instanceof Error ? err.message : String(err)}`);
        }
    };
    check("runtime", () => {
        const bun = process.versions["bun"];
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
        for (const id of ids)
            store.loadHandoff(id); // verify-on-read throws on tampering
        return `${ids.length} baton(s) verified`;
    });
    check("head pointer", () => {
        const head = store.config().head;
        if (head === null)
            return "(none yet)";
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
            const remote = store.config().remote;
            return `${remote.network} · ${remote.projectObjectId}`;
        });
        if (options.network) {
            const remote = store.config().remote;
            const endpoints = [
                ["Sui RPC", remote.rpcUrl],
                ["Walrus upload relay", remote.walrus.uploadRelayUrl],
                ["Walrus aggregator", remote.walrus.aggregatorUrl],
                ...remote.seal.serverConfigs
                    .filter((server) => server.aggregatorUrl)
                    .map((server, index) => [`Seal aggregator ${index + 1}`, server.aggregatorUrl]),
            ];
            const probes = await Promise.allSettled(endpoints.map(async ([label, url]) => ({ label, result: await probeHttpsEndpoint(url) })));
            for (let index = 0; index < probes.length; index += 1) {
                const [label] = endpoints[index];
                const probe = probes[index];
                if (probe.status === "fulfilled") {
                    ok(`${label}: reachable · ${probe.value.result.address} · HTTP ${probe.value.result.status}`);
                }
                else {
                    healthy = false;
                    fail(`${label}: ${probe.reason instanceof Error ? probe.reason.message : String(probe.reason)}`);
                }
            }
        }
    }
    else {
        warn("remote project: not registered — local handoffs still work; run `baton login` then `baton register`");
    }
    // Capture readiness — surfaced so users can see whether automatic
    // checkpointing is actually wired up, without digging through configs.
    check("checkpoint hook", () => hooksInstalled(store.root)
        ? "installed (Claude Code Stop hook)"
        : "not installed — run `baton install` for automatic checkpoints");
    check("distiller key", () => process.env.ANTHROPIC_API_KEY
        ? "ANTHROPIC_API_KEY set"
        : "ANTHROPIC_API_KEY not set — checkpoints no-op; `pass` uses the git fallback");
    process.exit(healthy ? 0 : 1);
}
//# sourceMappingURL=doctor.js.map