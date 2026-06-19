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
import { runRender } from "./commands/render.ts";
import { runCheckpoint } from "./commands/checkpoint.ts";
import { runInstall, runUninstall } from "./commands/install.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runVerify } from "./commands/verify.ts";
import { runQueueStatus } from "./commands/queue.ts";
import { TOOL_IDS, type ToolId } from "../schema/handoff.ts";
import { RULES_TARGETS, type RulesFormat } from "../render/rules.ts";

const USAGE = `baton — verifiable handoffs between coding agents (git for agent memory)

Usage: baton <command>

Commands:
  init         initialize a baton project in the current directory
  status       show the current working state
  pass         seal the current working state into a handoff (commit)
  log          list handoffs, newest first (* = head)
  show <id>    print a verified handoff by id (short ids ok)
  resume [id]  render the resume prompt for a handoff (head if omitted)
  verify <claim-id> [id]
               show the verified source lines behind a distilled claim
  queue status show crash-safe remote publication progress
  render <fmt> project a handoff into a rules file (${Object.keys(RULES_TARGETS).join(" | ")})
  install      register the Claude Code checkpoint hook for this project
  uninstall    remove the Claude Code checkpoint hook
  doctor       diagnose the installation and verify local batons

Options:
  -h, --help        show this help
  -v, --version     show version
  --no-hooks        (init) skip Claude Code hook installation
  --review          (pass) preview the distillation and confirm before sealing
  --tool <id>       (resume) receiving tool dialect: ${TOOL_IDS.join(" | ")}
  --write           (render) upsert the rules file instead of printing to stdout
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
      return runInit(process.cwd(), { hooks: !rest.includes("--no-hooks") });
    case "checkpoint":
      // Hook handler: must never disrupt the host session — always exit 0.
      void runCheckpoint().finally(() => process.exit(0));
      return;
    case "install":
      return runInstall(process.cwd());
    case "uninstall":
      return runUninstall(process.cwd());
    case "status":
      return runStatus(process.cwd());
    case "pass":
      void runPass(process.cwd(), { review: rest.includes("--review") }).catch(die);
      return;
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
    case "verify": {
      const claimId = rest[0];
      if (!claimId) {
        process.stderr.write("usage: baton verify <claim-id> [handoff-id]\n");
        process.exitCode = 2;
        return;
      }
      return runVerify(process.cwd(), claimId, rest[1]);
    }
    case "queue":
      if (rest.length > 1 || (rest[0] !== undefined && rest[0] !== "status")) {
        process.stderr.write("usage: baton queue [status]\n");
        process.exitCode = 2;
        return;
      }
      return runQueueStatus(process.cwd());
    case "render": {
      const format = rest[0];
      if (!format || !(format in RULES_TARGETS)) {
        process.stderr.write(`usage: baton render <${Object.keys(RULES_TARGETS).join("|")}> [id] [--write]\n`);
        process.exitCode = 2;
        return;
      }
      const write = rest.includes("--write");
      const id = rest.slice(1).find((a) => !a.startsWith("--"));
      return runRender(process.cwd(), format as RulesFormat, id, write);
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
