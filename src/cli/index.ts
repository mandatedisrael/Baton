#!/usr/bin/env node
/**
 * baton — Git for agent memory.
 * Thin command layer: all behavior lives in core/store so the MCP server
 * (phase 4) drives the exact same engine. Zero dependencies: a six-command
 * CLI does not need an argument-parsing framework.
 */
import { die } from "./output.ts";
import { runInit } from "./commands/init.ts";
import { runStatus } from "./commands/status.ts";
import { runPass } from "./commands/pass.ts";
import { runLog } from "./commands/log.ts";
import { runShow } from "./commands/show.ts";
import { runDoctor } from "./commands/doctor.ts";

const USAGE = `baton — verifiable handoffs between coding agents (git for agent memory)

Usage: baton <command>

Commands:
  init         initialize a baton project in the current directory
  status       show the current working state
  pass         seal the current working state into a handoff (commit)
  log          list handoffs, newest first (* = head)
  show <id>    print a verified handoff by id (short ids ok)
  doctor       diagnose the installation and verify local batons

Options:
  -h, --help     show this help
  -v, --version  show version
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
