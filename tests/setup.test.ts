import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupAgents } from "../src/cli/commands/setup.ts";

const launch = { command: "/opt/node", args: ["/opt/baton/mcp.js"] };

test("setupAgents writes project-scoped configs with absolute launch and preserves unrelated settings", () => {
  const root = mkdtempSync(join(tmpdir(), "baton-setup-"));
  try {
    mkdirSync(join(root, ".codex"), { recursive: true });
    writeFileSync(join(root, ".codex", "config.toml"), "model = \"gpt-test\"\n");
    writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { github: { url: "https://example" } } }));
    writeFileSync(join(root, "opencode.json"), JSON.stringify({ theme: "system", mcp: { github: { type: "remote" } } }));
    setupAgents(root, ["codex", "claude-code", "cursor", "opencode"], launch);

    const codex = readFileSync(join(root, ".codex", "config.toml"), "utf8");
    assert.match(codex, /model = "gpt-test"/);
    assert.match(codex, /# baton:mcp:begin/);
    assert.match(codex, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const claude = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
    assert.equal(claude.mcpServers.github.url, "https://example");
    assert.equal(claude.mcpServers.baton.command, "/opt/node");
    assert.deepEqual(claude.mcpServers.baton.args, ["/opt/baton/mcp.js", "--project", root]);

    const cursor = JSON.parse(readFileSync(join(root, ".cursor", "mcp.json"), "utf8"));
    assert.equal(cursor.mcpServers.baton.command, "/opt/node");

    const opencode = JSON.parse(readFileSync(join(root, "opencode.json"), "utf8"));
    assert.equal(opencode.theme, "system");
    assert.equal(opencode.mcp.github.type, "remote");
    assert.equal(opencode.mcp.baton.type, "local");
    assert.equal(opencode.mcp.baton.enabled, true);
    assert.deepEqual(opencode.mcp.baton.command, ["/opt/node", "/opt/baton/mcp.js", "--project", root]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex setup is idempotent and refuses an unmanaged duplicate Baton section", () => {
  const root = mkdtempSync(join(tmpdir(), "baton-setup-idempotent-"));
  try {
    setupAgents(root, ["codex"], launch);
    setupAgents(root, ["codex"], launch);
    const managed = readFileSync(join(root, ".codex", "config.toml"), "utf8");
    assert.equal(managed.match(/\[mcp_servers\.baton\]/g)?.length, 1);

    const other = join(root, "other");
    mkdirSync(join(other, ".codex"), { recursive: true });
    writeFileSync(join(other, ".codex", "config.toml"), "[mcp_servers.baton]\ncommand = \"other\"\n");
    assert.throws(() => setupAgents(other, ["codex"], launch), /outside Baton's managed block/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
