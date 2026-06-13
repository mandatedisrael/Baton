import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectStore } from "../../store/project.ts";
import { installHooks } from "../hooks.ts";
import { ok, warn } from "../output.ts";

export interface InitOptions {
  /** Skip Claude Code hook installation (`baton init --no-hooks`). */
  hooks?: boolean;
}

export function runInit(cwd: string, opts: InitOptions = {}): void {
  const store = ProjectStore.init(cwd);
  ok(`initialized baton project in ${store.root}/.baton`);

  // Keep local agent memory out of version control.
  const gitignore = join(cwd, ".gitignore");
  if (existsSync(gitignore)) {
    const content = readFileSync(gitignore, "utf8");
    if (!content.split("\n").some((l) => l.trim() === ".baton/" || l.trim() === ".baton")) {
      appendFileSync(gitignore, `${content.endsWith("\n") ? "" : "\n"}.baton/\n`);
      ok("added .baton/ to .gitignore");
    }
  } else {
    warn("no .gitignore found — add .baton/ to it if this project uses git");
  }

  // Auto-wire the Claude Code Stop hook so checkpoints accrue with no effort.
  if (opts.hooks !== false) {
    const status = installHooks(store.root);
    if (status === "installed") ok("installed Claude Code checkpoint hook (.claude/settings.json)");
    else if (status === "updated") ok("updated Claude Code checkpoint hook (.claude/settings.json)");
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    warn("ANTHROPIC_API_KEY not set — checkpoints will distill once it is; `baton pass` works now via the git fallback");
  }

  console.log(
    "\nnext: just work in Claude Code — checkpoints accrue automatically.\n" +
      "      `baton status` to inspect · `baton pass` to seal a handoff · `baton resume` to pick it up",
  );
}
