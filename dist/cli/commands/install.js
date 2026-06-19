import { ProjectStore } from "../../store/project.js";
import { claudeSettingsPath, installHooks, uninstallHooks } from "../hooks.js";
import { ok } from "../output.js";
/** `baton install` — (re)register the Claude Code checkpoint hook. */
export function runInstall(cwd) {
    const store = ProjectStore.open(cwd);
    const status = installHooks(store.root);
    const where = claudeSettingsPath(store.root);
    if (status === "installed")
        ok(`installed Claude Code checkpoint hook → ${where}`);
    else if (status === "updated")
        ok(`updated Claude Code checkpoint hook → ${where}`);
    else
        ok(`checkpoint hook already up to date → ${where}`);
}
/** `baton uninstall` — remove the Claude Code checkpoint hook. */
export function runUninstall(cwd) {
    const store = ProjectStore.open(cwd);
    const removed = uninstallHooks(store.root);
    ok(removed ? "removed Claude Code checkpoint hook" : "no checkpoint hook was installed");
}
//# sourceMappingURL=install.js.map