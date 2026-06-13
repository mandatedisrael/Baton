import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectStore } from "../../store/project.ts";
import { ok, warn } from "../output.ts";

export function runInit(cwd: string): void {
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

  console.log("\nnext: work normally; run `baton pass` to seal a handoff, `baton status` to inspect");
}
