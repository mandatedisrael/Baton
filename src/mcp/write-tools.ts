import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { passBaton, type PassReporter } from "../cli/commands/pass.ts";
import { projectStatus } from "../core/status.ts";
import { applySelfReportCheckpoint } from "../core/self-report.ts";
import { ProjectStore } from "../store/project.ts";

const ToolId = z.enum(["claude-code", "codex", "cursor", "chatgpt-web", "other", "opencode"]);

const Decision = z.object({
  id: z.string().min(1),
  choice: z.string().min(1),
  rationale: z.string(),
}).strict();

const Graveyard = z.object({
  id: z.string().min(1),
  approach: z.string().min(1),
  reason: z.string(),
}).strict();

const FileRef = z.object({
  path: z.string().min(1),
  contentHash: z.string().optional(),
}).strict();

const CheckpointInput = z.object({
  mission: z.string().optional().describe("Current project/session objective"),
  status: z.enum(["done", "in-progress", "blocked"]).optional(),
  decisions: z.array(Decision).optional().describe("Complete latest-truth decision list; replaces when supplied"),
  graveyard: z.array(Graveyard).optional().describe("Complete failed-approach list; replaces when supplied"),
  nextActions: z.array(z.string()).optional().describe("Ordered next steps; replaces when supplied"),
  envNotes: z.array(z.string()).optional().describe("Environment constraints; replaces when supplied"),
  verbatimRules: z.array(z.string()).optional().describe("Rules that receiving agents must preserve verbatim"),
  touchedFiles: z.array(FileRef).optional().describe("Files to merge into the touched-file map"),
}).strict().refine((value) => Object.keys(value).length > 0, "at least one checkpoint field is required");

function result(text: string, structuredContent: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

export function registerWriteTools(server: McpServer, projectDir: string): void {
  server.registerTool("baton_checkpoint", {
    title: "Checkpoint current agent state",
    description:
      "Persist a scrubbed self-report checkpoint. Supplied list sections replace latest truth; omitted sections remain unchanged.",
    inputSchema: CheckpointInput,
    outputSchema: {
      checkpointCount: z.number().int().nonnegative(),
      updatedAt: z.string(),
      scrubbedFindings: z.number().int().nonnegative(),
      status: z.record(z.string(), z.unknown()),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (checkpoint) => {
    const store = ProjectStore.open(projectDir);
    const applied = applySelfReportCheckpoint(store, checkpoint);
    const status: Record<string, unknown> = { ...projectStatus(store) };
    const structured = {
      checkpointCount: applied.state.checkpointCount,
      updatedAt: applied.state.updatedAt,
      scrubbedFindings: applied.findings.reduce((sum, finding) => sum + finding.count, 0),
      status,
    };
    return result(JSON.stringify(structured, null, 2), structured);
  });

  server.registerTool("baton_pass", {
    title: "Seal a Baton handoff",
    description:
      "Seal the current scrubbed WorkingState into a verified, content-addressed baton and queue remote publication.",
    inputSchema: z.object({
      confirm: z.literal(true).describe("Must be true to authorize creation of a new immutable baton"),
      sourceTool: ToolId.optional().describe("Calling agent; use opencode for an OpenCode self-report pass"),
    }).strict(),
    outputSchema: {
      id: z.string(),
      queued: z.boolean(),
      captureMode: z.string(),
      fidelity: z.number().nullable(),
      warnings: z.array(z.string()),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ sourceTool }) => {
    const warnings: string[] = [];
    const notices: string[] = [];
    const reporter: PassReporter = {
      warn: (message) => warnings.push(message),
      ok: (message) => notices.push(message),
      write: (message) => notices.push(message),
      confirm: async () => true,
    };
    const passed = await passBaton(projectDir, { review: false, sourceTool }, reporter);
    if (!passed.sealed || !passed.id || !passed.handoff) throw new Error("baton pass did not seal a handoff");
    const structured = {
      id: passed.id,
      queued: passed.queued === true,
      captureMode: passed.handoff.meta.captureMode,
      fidelity: passed.handoff.fidelity.score,
      warnings,
    };
    return result([...notices, ...warnings.map((warning) => `Warning: ${warning}`)].join("\n"), structured);
  });
}
