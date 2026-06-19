#!/usr/bin/env node
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBatonMcpServer } from "./server.ts";

function projectDirectory(argv: string[]): string {
  if (argv.length === 0) return resolve(process.env.BATON_PROJECT_DIR ?? process.cwd());
  if (argv.length === 2 && argv[0] === "--project" && argv[1]) return resolve(argv[1]);
  throw new Error("usage: baton-mcp [--project <directory>]");
}

async function main(): Promise<void> {
  const server = createBatonMcpServer(projectDirectory(process.argv.slice(2)));
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  process.stderr.write(`baton-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
