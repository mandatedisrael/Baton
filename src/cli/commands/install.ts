import { ProjectStore } from "../../store/project.ts";
import { claudeSettingsPath, installHooks, uninstallHooks } from "../hooks.ts";
import { ok } from "../output.ts";

/** `baton install` — (re)register the Claude Code checkpoint hook. */
export function runInstall(cwd: string): void {
  const store = ProjectStore.open(cwd);
  const status = installHooks(store.root);
  const where = claudeSettingsPath(store.root);
  if (status === "installed") ok(`installed Claude Code checkpoint hook → ${where}`);
  else if (status === "updated") ok(`updated Claude Code checkpoint hook → ${where}`);
  else ok(`checkpoint hook already up to date → ${where}`);
}

/** `baton uninstall` — remove the Claude Code checkpoint hook. */
export function runUninstall(cwd: string): void {
  const store = ProjectStore.open(cwd);
  const removed = uninstallHooks(store.root);
  ok(removed ? "removed Claude Code checkpoint hook" : "no checkpoint hook was installed");
}
