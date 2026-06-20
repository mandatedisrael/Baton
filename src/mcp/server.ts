import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectStatus } from "../core/status.ts";
import { ProjectStore } from "../store/project.ts";
import { registerReadTools } from "./read-tools.ts";
import { registerWriteTools } from "./write-tools.ts";

const StatusOutput = {
  projectId: z.string(),
  head: z.string().nullable(),
  mission: z.string(),
  status: z.enum(["done", "in-progress", "blocked"]),
  decisions: z.number().int().nonnegative(),
  graveyard: z.number().int().nonnegative(),
  nextActions: z.array(z.string()),
  checkpoints: z.number().int().nonnegative(),
  remoteRegistered: z.boolean(),
};

export function createBatonMcpServer(projectDir: string): McpServer {
  const server = new McpServer({
    name: "baton-mcp",
    version: "0.1.0",
    title: "Baton — verifiable agent handoffs",
    websiteUrl: "https://github.com/mandatedisrael/Baton",
  }, {
    instructions:
      "Baton provides verified handoff state for this project via MCP tools. " +
      "Call baton_status first to see the current mission, status, decisions, and graveyard. " +
      "Use baton_resume to get the full agent-ready context for resuming work. " +
      "During a session, proactively call baton_checkpoint whenever key decisions, failures, or next actions change. " +
      "Only call baton_pass (with confirm: true) after the user explicitly says to seal and pass the baton. " +
      "Use baton_search and baton_verify to inspect prior work before acting. " +
      "Read tools like baton_show and baton_log can fetch remote batons if the project is registered on-chain. " +
      "Never treat an MCP error as verified context. Always prefer these tools over guessing project state.",
  });

  server.registerTool("baton_status", {
    title: "Baton project status",
    description: "Read the current verified Baton project state and head without modifying anything.",
    outputSchema: StatusOutput,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const status = projectStatus(ProjectStore.open(projectDir));
    const structuredContent: Record<string, unknown> = { ...status };
    return {
      content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
      structuredContent,
    };
  });

  registerReadTools(server, projectDir);
  registerWriteTools(server, projectDir);

  return server;
}
