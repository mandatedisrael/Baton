#!/usr/bin/env node
/**
 * baton — Git for agent memory.
 * Thin command layer: all behavior lives in core/store so the MCP server
 * (phase 4) drives the exact same engine. Zero dependencies: a small CLI
 * does not need an argument-parsing framework.
 */
import { die } from "./output.ts";
import { runInit } from "./commands/init.ts";
import { runStatus } from "./commands/status.ts";
import { runPass } from "./commands/pass.ts";
import { runLog } from "./commands/log.ts";
import { runShow } from "./commands/show.ts";
import { runResume } from "./commands/resume.ts";
import { runDoctor } from "./commands/doctor.ts";
import { TOOL_IDS, type ToolId } from "../schema/handoff.ts";

const USAGE = `baton — verifiable handoffs between coding agents (git for agent memory)

Usage: baton <command>

Commands:
  init         initialize a baton project in the current directory
  status       show the current working state
  pass         seal the current working state into a handoff (commit)
  log          list handoffs, newest first (* = head)
  show <id>    print a verified handoff by id (short ids ok)
  resume [id]  render the resume prompt for a handoff (head if omitted)
  doctor       diagnose the installation and verify local batons

Options:
  -h, --help        show this help
  -v, --version     show version
  --tool <id>       (resume) receiving tool dialect: ${TOOL_IDS.join(" | ")}
`;

const VERSION = "0.1.0";

function main(argv: string[]): void {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case "-h":
    case "--help":
    case "help":
      process.stdout.write(USAGE);
      return;
    case "-v":
    case "--version":
      process.stdout.write(`baton ${VERSION}\n`);
      return;
    case "init":
      return runInit(process.cwd());
    case "status":
      return runStatus(process.cwd());
    case "pass":
      return runPass(process.cwd());
    case "log":
      return runLog(process.cwd());
    case "show": {
      const id = rest[0];
      if (!id) {
        process.stderr.write("usage: baton show <id>\n");
        process.exitCode = 2;
        return;
      }
      return runShow(process.cwd(), id);
    }
    case "resume": {
      const toolFlag = rest.indexOf("--tool");
      let receivingTool: ToolId | undefined;
      if (toolFlag !== -1) {
        const value = rest[toolFlag + 1];
        if (!value || !(TOOL_IDS as readonly string[]).includes(value)) {
          process.stderr.write(`usage: baton resume [id] [--tool ${TOOL_IDS.join("|")}]\n`);
          process.exitCode = 2;
          return;
        }
        receivingTool = value as ToolId;
      }
      const id = rest.find((a, i) => !a.startsWith("--") && rest[i - 1] !== "--tool");
      return runResume(process.cwd(), id, receivingTool);
    }
    case "doctor":
      return runDoctor(process.cwd());
    default:
      process.stderr.write(`baton: unknown command "${command}"\n\n${USAGE}`);
      process.exitCode = 2;
      return;
  }
}

try {
  main(process.argv.slice(2));
} catch (err) {
  die(err);
}
