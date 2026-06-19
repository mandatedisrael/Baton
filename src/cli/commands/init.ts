import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectStore } from "../../store/project.ts";
import { installHooks } from "../hooks.ts";
import { ok, warn } from "../output.ts";
import { runRender } from "./render.ts";

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

  // Print MCP setup hints for Codex, Cursor, and generic clients so agents can call tools directly.
  console.log("\nAgent integration:");
  console.log("  Claude Code: hook installed — checkpoints happen automatically on Stop.");
  console.log("  For Codex / Cursor / other MCP clients, add this to your MCP config:");
  console.log(
    "    {\n" +
      '      "mcpServers": {\n' +
      '        "baton": {\n' +
      '          "command": "baton-mcp",\n' +
      `          "args": ["--project", "${store.root}"]\n` +
      "        }\n" +
      "      }\n" +
      "    }",
  );
  console.log("  Then start sessions with `baton resume` (or let the agent call it).");

  // Auto-generate a CLAUDE.md for immediate agent awareness (non-destructive if exists).
  // Only if there's already a head baton (otherwise render will no-op with warning).
  try {
    runRender(store.root, "claude-md", undefined, true);
    ok("wrote CLAUDE.md with current baton context (re-runnable via `baton render claude-md --write`)");
  } catch {
    warn("skipped auto-rendering CLAUDE.md (run `baton render claude-md --write` manually if desired)");
  }

  console.log(
    "\nnext: just work — checkpoints accrue. Use `baton status`, `baton pass`, or tell your agent to use baton_* MCP tools.",
  );
}
