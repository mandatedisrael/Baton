import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectStatus } from "../core/status.ts";
import { ProjectStore } from "../store/project.ts";

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

  return server;
}
