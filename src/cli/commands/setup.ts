import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { BatonError } from "../../core/errors.ts";
import { installHooks } from "../hooks.ts";
import { ok } from "../output.ts";

export type SetupAgent = "codex" | "claude-code" | "cursor";

export interface McpLaunch {
  command: string;
  args: string[];
}

const TOML_BEGIN = "# baton:mcp:begin";
const TOML_END = "# baton:mcp:end";

export function currentMcpLaunch(): McpLaunch {
  const cli = realpathSync(process.argv[1]!);
  const extension = cli.endsWith(".ts") ? ".ts" : ".js";
  const mcp = resolve(dirname(cli), `../mcp/index${extension}`);
  if (!existsSync(mcp)) throw new BatonError("NOT_FOUND", `Baton MCP entrypoint is missing: ${mcp}`);
  return {
    command: process.execPath,
    args: [...(extension === ".ts" ? ["--experimental-strip-types"] : []), mcp],
  };
}

function quoteToml(value: string): string {
  return JSON.stringify(value);
}

function upsertCodex(root: string, launch: McpLaunch): string {
  const path = join(root, ".codex", "config.toml");
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const begin = existing.indexOf(TOML_BEGIN);
  const end = existing.indexOf(TOML_END);
  if ((begin === -1) !== (end === -1) || (begin !== -1 && end < begin)) {
    throw new BatonError("INVALID_STATE", `${path} has an incomplete Baton managed block`);
  }
  if (begin === -1 && /^\s*\[mcp_servers\.baton\]\s*$/m.test(existing)) {
    throw new BatonError(
      "ALREADY_INITIALIZED",
      `${path} already defines mcp_servers.baton outside Baton's managed block; remove or rename it first`,
    );
  }
  const args = [...launch.args, "--project", root];
  const block = [
    TOML_BEGIN,
    "[mcp_servers.baton]",
    `command = ${quoteToml(launch.command)}`,
    `args = [${args.map(quoteToml).join(", ")}]`,
    "required = true",
    "startup_timeout_sec = 20",
    "tool_timeout_sec = 120",
    TOML_END,
  ].join("\n");
  const next = begin === -1
    ? `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${existing ? "\n" : ""}${block}\n`
    : `${existing.slice(0, begin)}${block}${existing.slice(end + TOML_END.length)}`;
  writeFileSync(path, next);
  return path;
}

function upsertJsonMcp(path: string, root: string, launch: McpLaunch): string {
  mkdirSync(dirname(path), { recursive: true });
  let config: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected an object");
      config = parsed as Record<string, unknown>;
    } catch (err) {
      throw new BatonError("INVALID_STATE", `cannot safely update invalid JSON config ${path}`, { cause: err });
    }
  }
  const currentServers = config.mcpServers;
  const mcpServers = currentServers && typeof currentServers === "object" && !Array.isArray(currentServers)
    ? currentServers as Record<string, unknown>
    : {};
  config.mcpServers = {
    ...mcpServers,
    baton: { command: launch.command, args: [...launch.args, "--project", root] },
  };
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

export function setupAgents(root: string, agents: SetupAgent[], launch: McpLaunch = currentMcpLaunch()): string[] {
  const paths: string[] = [];
  for (const agent of agents) {
    if (agent === "codex") paths.push(upsertCodex(root, launch));
    else if (agent === "claude-code") {
      paths.push(upsertJsonMcp(join(root, ".mcp.json"), root, launch));
      installHooks(root);
    } else paths.push(upsertJsonMcp(join(root, ".cursor", "mcp.json"), root, launch));
  }
  return paths;
}

export function runSetup(root: string, target: SetupAgent | "all"): void {
  const agents: SetupAgent[] = target === "all" ? ["codex", "claude-code", "cursor"] : [target];
  for (const path of setupAgents(root, agents)) ok(`configured ${path}`);
  ok("restart the configured agent so it discovers the Baton MCP tools");
}
