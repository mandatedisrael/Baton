import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectStatus } from "../core/status.js";
import { ProjectStore } from "../store/project.js";
import { registerReadTools } from "./read-tools.js";
import { registerWriteTools } from "./write-tools.js";
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
export function createBatonMcpServer(projectDir) {
    const server = new McpServer({
        name: "baton-mcp",
        version: "0.1.0",
        title: "Baton — verifiable agent handoffs",
        websiteUrl: "https://github.com/mandatedisrael/Baton",
    }, {
        instructions: "Use baton_status first to understand the project. Use baton_resume to continue from the verified head, " +
            "baton_search to find prior work, and baton_verify before relying on cited decisions or failures. During work, " +
            "call baton_checkpoint with the latest complete truth for any supplied list section. Call baton_pass only after " +
            "the user explicitly approves sealing an immutable handoff; pass confirm=true. Read tools may recover encrypted " +
            "remote data through the registered Sui, Walrus, and Seal configuration. Never treat an MCP error as verified context.",
    });
    server.registerTool("baton_status", {
        title: "Baton project status",
        description: "Read the current verified Baton project state and head without modifying anything.",
        outputSchema: StatusOutput,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    }, async () => {
        const status = projectStatus(ProjectStore.open(projectDir));
        const structuredContent = { ...status };
        return {
            content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
            structuredContent,
        };
    });
    registerReadTools(server, projectDir);
    registerWriteTools(server, projectDir);
    return server;
}
//# sourceMappingURL=server.js.map