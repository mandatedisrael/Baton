import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ProjectStore } from "../src/store/project.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "baton-mcp-test-"));
  ProjectStore.init(root);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

async function connectedClient() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "src/mcp/index.ts"), "--project", root],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name: "baton-test-client", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

test("stdio MCP server exposes and executes the complete Baton tool surface", async () => {
  const { client } = await connectedClient();
  try {
    const tools = await client.listTools();
    assert.match(client.getInstructions() ?? "", /baton_status first/);
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [
        "baton_checkpoint",
        "baton_log",
        "baton_pass",
        "baton_resume",
        "baton_search",
        "baton_show",
        "baton_status",
        "baton_verify",
      ],
    );
    assert.equal(tools.tools.find((tool) => tool.name === "baton_status")?.annotations?.readOnlyHint, true);
    assert.equal(tools.tools.find((tool) => tool.name === "baton_pass")?.annotations?.readOnlyHint, false);

    const status = await client.callTool({ name: "baton_status", arguments: {} });
    assert.equal(status.isError, undefined);
    assert.equal((status.structuredContent as { head: null }).head, null);

    const checkpoint = await client.callTool({
      name: "baton_checkpoint",
      arguments: {
        mission: "ship the MCP server",
        decisions: [{ id: "d1", choice: "stdio", rationale: "local process isolation" }],
        nextActions: ["run client smoke test"],
        touchedFiles: [{ path: "src/mcp/server.ts" }],
      },
    });
    assert.equal(checkpoint.isError, undefined);
    assert.equal((checkpoint.structuredContent as { checkpointCount: number }).checkpointCount, 1);

    const passed = await client.callTool({
      name: "baton_pass",
      arguments: { confirm: true, sourceTool: "opencode" },
    });
    assert.equal(passed.isError, undefined);
    const batonId = (passed.structuredContent as { id: string }).id;
    assert.match(batonId, /^[a-f0-9]{64}$/);
    assert.equal(ProjectStore.open(root).loadHandoff(batonId).meta.tool, "opencode");

    const log = await client.callTool({ name: "baton_log", arguments: { limit: 5 } });
    assert.equal((log.structuredContent as { entries: unknown[] }).entries.length, 1);

    const search = await client.callTool({ name: "baton_search", arguments: { query: "MCP" } });
    assert.equal((search.structuredContent as { results: unknown[] }).results.length, 1);

    const shown = await client.callTool({ name: "baton_show", arguments: { id: batonId.slice(0, 12) } });
    assert.equal((shown.structuredContent as { id: string }).id, batonId);

    const resumed = await client.callTool({
      name: "baton_resume",
      arguments: { id: batonId, receivingTool: "codex" },
    });
    assert.match((resumed.structuredContent as { prompt: string }).prompt, /You are Codex resuming/);

    const invalidPass = await client.callTool({ name: "baton_pass", arguments: { confirm: false } });
    assert.equal(invalidPass.isError, true);
  } finally {
    await client.close();
  }
});

test("MCP tool failures stay inside protocol error results", async () => {
  const { client } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "baton_verify",
      arguments: { claimId: "missing-claim" },
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /no batons yet|no batons/i);
  } finally {
    await client.close();
  }
});
