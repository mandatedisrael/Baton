import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectStore } from "../../store/project.js";
import { installHooks } from "../hooks.js";
import { ok, warn } from "../output.js";
export function runInit(cwd, opts = {}) {
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
    }
    else {
        warn("no .gitignore found — add .baton/ to it if this project uses git");
    }
    // Auto-wire the Claude Code Stop hook so checkpoints accrue with no effort.
    if (opts.hooks !== false) {
        const status = installHooks(store.root);
        if (status === "installed")
            ok("installed Claude Code checkpoint hook (.claude/settings.json)");
        else if (status === "updated")
            ok("updated Claude Code checkpoint hook (.claude/settings.json)");
    }
    if (!process.env.ANTHROPIC_API_KEY) {
        warn("ANTHROPIC_API_KEY not set — checkpoints will distill once it is; `baton pass` works now via the git fallback");
    }
    // Print MCP setup hints for Codex, Cursor, and generic clients so agents can call tools directly.
    console.log("\nAgent integration:");
    console.log("  Claude Code: hook installed — checkpoints happen automatically on Stop.");
    console.log("  For Codex / Cursor / other MCP clients, add this to your MCP config:");
    console.log('    {\n' +
        '      "mcpServers": {\n' +
        '        "baton": {\n' +
        '          "command": "baton-mcp",\n' +
        `          "args": ["--project", "${store.root}"]\n` +
        '        }\n' +
        '      }\n' +
        '    }');
    console.log("  Then start sessions with `baton resume` (or let the agent call it).");
    // Ensure a CLAUDE.md exists with helpful starter content + managed block for Baton.
    ensureStarterClaudeMd(store.root);
    console.log("\nNext steps: work in your agent (checkpoints happen automatically).\n" +
        "  • `baton status`          inspect current state\n" +
        "  • `baton pass`            seal & hand off when ready\n" +
        "  • `baton resume`          get fresh context for a new session\n" +
        "  • Tell your agent: \"use the baton tools to checkpoint or pass when done\"");
}
const BEGIN_MARKER = "<!-- baton:begin -->";
const END_MARKER = "<!-- baton:end -->";
function ensureStarterClaudeMd(root) {
    const path = join(root, "CLAUDE.md");
    const starterBody = [
        "## Project rules (managed by BATON)",
        "",
        "Edits inside this block are overwritten on the next `baton render`.",
        "",
        "- Run `baton resume` (or let your agent call it) at the start of new sessions.",
        "- Use `baton status` and `baton pass` (via CLI or MCP) to manage handoffs.",
        "- The \"graveyard\" section in batons lists approaches that failed — avoid repeating them.",
    ].join("\n");
    let existing = "";
    if (existsSync(path)) {
        existing = readFileSync(path, "utf8");
    }
    const block = `${BEGIN_MARKER}\n${starterBody}\n${END_MARKER}`;
    let newContent;
    const begin = existing.indexOf(BEGIN_MARKER);
    const end = existing.indexOf(END_MARKER);
    if (begin !== -1 && end !== -1 && end > begin) {
        // Preserve user content outside the markers
        newContent = existing.slice(0, begin) + block + existing.slice(end + END_MARKER.length);
    }
    else if (existing.trim() === "") {
        newContent = block + "\n";
    }
    else {
        const sep = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
        newContent = existing + sep + block + "\n";
    }
    if (newContent !== existing) {
        writeFileSync(path, newContent);
        ok("created/updated CLAUDE.md with starter content (Baton manages the marked block)");
    }
}
//# sourceMappingURL=init.js.map