/**
 * Claude Code hook integration — what makes BATON automatic.
 *
 * Registering a `Stop` hook in the project's `.claude/settings.json` means
 * `baton checkpoint` fires at the end of every Claude Code turn, distilling new
 * turns into the working state with zero user effort. The merge is
 * non-destructive (other settings and hooks are preserved) and idempotent
 * (re-running updates our entry in place).
 *
 * The pure functions (`upsertCheckpointHook`, `removeCheckpointHook`) operate on
 * a parsed settings object so the merge logic is testable without the filesystem.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
export function claudeSettingsPath(root) {
    return join(root, ".claude", "settings.json");
}
/** The command Claude Code runs on Stop. Absolute paths so it works in dev and when installed. */
export function checkpointCommand() {
    return `"${process.execPath}" "${process.argv[1]}" checkpoint`;
}
/** True if a hook command is BATON's checkpoint handler (however it's invoked). */
function isBatonHook(command) {
    return typeof command === "string" && /\bcheckpoint\b/.test(command) && /baton/i.test(command);
}
/** Insert or refresh BATON's Stop hook in a settings object. Pure. */
export function upsertCheckpointHook(settings, command) {
    const next = { ...settings };
    const hooks = { ...(typeof next.hooks === "object" && next.hooks ? next.hooks : {}) };
    const stop = Array.isArray(hooks.Stop) ? [...hooks.Stop] : [];
    const ours = stop.find((e) => Array.isArray(e.hooks) && e.hooks.some((h) => isBatonHook(h.command)));
    const entry = { hooks: [{ type: "command", command }] };
    let status;
    if (!ours) {
        stop.push(entry);
        status = "installed";
    }
    else {
        const existing = ours.hooks?.find((h) => isBatonHook(h.command));
        status = existing && existing.command === command ? "unchanged" : "updated";
        if (existing)
            existing.command = command;
    }
    hooks.Stop = stop;
    next.hooks = hooks;
    return { settings: next, status };
}
/** Remove BATON's Stop hook from a settings object. Pure. */
export function removeCheckpointHook(settings) {
    if (!settings.hooks || typeof settings.hooks !== "object")
        return { settings, removed: false };
    const hooks = { ...settings.hooks };
    if (!Array.isArray(hooks.Stop))
        return { settings, removed: false };
    let removed = false;
    const stop = hooks.Stop
        .map((e) => ({
        ...e,
        hooks: (e.hooks ?? []).filter((h) => {
            if (isBatonHook(h.command)) {
                removed = true;
                return false;
            }
            return true;
        }),
    }))
        .filter((e) => (e.hooks?.length ?? 0) > 0);
    if (stop.length > 0)
        hooks.Stop = stop;
    else
        delete hooks.Stop;
    const next = { ...settings, hooks };
    if (Object.keys(hooks).length === 0)
        delete next.hooks;
    return { settings: next, removed };
}
function readSettings(root) {
    const path = claudeSettingsPath(root);
    if (!existsSync(path))
        return {};
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
function writeSettings(root, settings) {
    const path = claudeSettingsPath(root);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
    renameSync(tmp, path);
}
/** Whether BATON's checkpoint hook is currently registered. */
export function hooksInstalled(root) {
    const stop = readSettings(root).hooks?.Stop;
    return (Array.isArray(stop) &&
        stop.some((e) => (e.hooks ?? []).some((h) => isBatonHook(h.command))));
}
/** Register the checkpoint hook. Returns what changed. */
export function installHooks(root) {
    const { settings, status } = upsertCheckpointHook(readSettings(root), checkpointCommand());
    if (status !== "unchanged")
        writeSettings(root, settings);
    return status;
}
/** Remove the checkpoint hook. Returns true if one was present. */
export function uninstallHooks(root) {
    const { settings, removed } = removeCheckpointHook(readSettings(root));
    if (removed)
        writeSettings(root, settings);
    return removed;
}
//# sourceMappingURL=hooks.js.map