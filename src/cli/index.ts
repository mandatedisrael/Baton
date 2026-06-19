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
import { runQueueAnchor, runQueueEncrypt, runQueueStatus, runQueueUpload } from "./commands/queue.ts";
import { runLogin } from "./commands/login.ts";
import { runRegister } from "./commands/register.ts";
import { runFaucet } from "./commands/faucet.ts";
import { runPublish } from "./commands/publish.ts";
import { runFundStorage } from "./commands/fund-storage.ts";
import { runFetch } from "./commands/fetch.ts";
import { runShare } from "./commands/share.ts";
import { runRevoke } from "./commands/revoke.ts";
import { runAccept } from "./commands/accept.ts";
import { runAudit } from "./commands/audit.ts";
import { TOOL_IDS, type ToolId } from "../schema/handoff.ts";
import { RULES_TARGETS, type RulesFormat } from "../render/rules.ts";
import { readFileSync } from "node:fs";

const USAGE = `baton — verifiable handoffs between coding agents (git for agent memory)

Usage: baton <command>

Commands:
  init         initialize a baton project in the current directory
  login        create or load the user's protected Sui identity (--zk for Google zkLogin with real address)
  faucet       fund that identity from the official Testnet faucet
  fund-storage exchange Testnet SUI for WAL storage funds
  register     register this project on Sui Testnet
  publish      encrypt, store, and anchor every queued baton
  fetch <id>   recover and verify a full baton from Sui, Walrus, and Seal
  audit <id>   authenticate a remote baton without changing local state
  share <address> grant read access and write a recipient invitation
  accept <file> verify and join a shared project from an invitation
  revoke <address> revoke delegated read access immediately
  status       show the current working state
  pass         seal the current working state into a handoff (commit)
  log          list handoffs, newest first (* = head)
  show <id>    print a verified handoff by id (short ids ok)
  resume [id]  render the resume prompt for a handoff (head if omitted)
  verify <claim-id> [id]
               show the verified source lines behind a distilled claim
  queue status show crash-safe remote publication progress
  queue encrypt encrypt pending payloads through Seal
  queue upload  upload encrypted payloads and certify them on Walrus
  queue anchor  anchor uploaded handoff manifests on Sui
  render <fmt> project a handoff into a rules file (${Object.keys(RULES_TARGETS).join(" | ")})
  install      register the Claude Code checkpoint hook for this project
  uninstall    remove the Claude Code checkpoint hook
  mcp setup    print ready-to-paste MCP config for Codex / Cursor / generic clients
  doctor       diagnose the installation and verify local batons

Options:
  -h, --help        show this help
  -v, --version     show version
  --no-hooks        (init) skip Claude Code hook installation
  --review          (pass) preview the distillation and confirm before sealing
  --tool <id>       (resume) receiving tool dialect: ${TOOL_IDS.join(" | ")}
  --write           (render) upsert the rules file instead of printing to stdout
  --package <id>    (register) override the canonical Baton package
  --rpc <url>       (register) override the Testnet RPC endpoint
  --sponsor <url>   (register) use a constrained Baton sponsor service
  --invite <token>  (register) one-use sponsor invitation token
  --out <file>      (share) invitation output path
  --amount <mist>   (fund-storage) SUI MIST to exchange (default 100000000)
`;

const packageMetadata = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  version?: unknown;
};
const VERSION = typeof packageMetadata.version === "string" ? packageMetadata.version : "unknown";

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
    case "login": {
      const zk = rest.includes("--zk") || rest.includes("--google");
      let clientId: string | undefined;
      for (let i = 0; i < rest.length; i++) {
        const val = rest[i + 1];
        if (rest[i] === "--client-id" && val && !val.startsWith("--")) {
          clientId = val;
          break;
        }
      }
      void runLogin({ zk, clientId }).catch(die);
      return;
    }
    case "faucet":
      void runFaucet().catch(die);
      return;
    case "fund-storage": {
      let amount = 100_000_000n;
      if (rest.length > 0) {
        if (rest.length !== 2 || rest[0] !== "--amount" || !/^\d+$/.test(rest[1]!)) {
          process.stderr.write("usage: baton fund-storage [--amount <mist>]\n");
          process.exitCode = 2;
          return;
        }
        amount = BigInt(rest[1]!);
      }
      void runFundStorage(amount).catch(die);
      return;
    }
    case "register": {
      let packageId: string | undefined;
      let rpcUrl: string | undefined;
      let sponsorUrl: string | undefined;
      let inviteToken: string | undefined;
      for (let i = 0; i < rest.length; i += 2) {
        const flag = rest[i];
        const value = rest[i + 1];
        if (!value || value.startsWith("--") || !["--package", "--rpc", "--sponsor", "--invite"].includes(flag!)) {
          process.stderr.write("usage: baton register [--package <id>] [--rpc <url>] [--sponsor <url> --invite <token>]\n");
          process.exitCode = 2;
          return;
        }
        if (flag === "--package") packageId = value;
        else if (flag === "--rpc") rpcUrl = value;
        else if (flag === "--sponsor") sponsorUrl = value;
        else inviteToken = value;
      }
      void runRegister(process.cwd(), { packageId, rpcUrl, sponsorUrl, inviteToken }).catch(die);
      return;
    }
    case "publish":
      void runPublish(process.cwd()).catch(die);
      return;
    case "fetch": {
      const id = rest[0];
      if (rest.length !== 1 || !id) {
        process.stderr.write("usage: baton fetch <full-handoff-id>\n");
        process.exitCode = 2;
        return;
      }
      void runFetch(process.cwd(), id).catch(die);
      return;
    }
    case "audit": {
      const id = rest[0];
      if (rest.length !== 1 || !id) {
        process.stderr.write("usage: baton audit <full-handoff-id>\n");
        process.exitCode = 2;
        return;
      }
      void runAudit(process.cwd(), id).catch(die);
      return;
    }
    case "share": {
      const grantee = rest[0];
      const outFlag = rest.indexOf("--out");
      const outputPath = outFlag === -1 ? undefined : rest[outFlag + 1];
      if (!grantee || (outFlag !== -1 && !outputPath) || rest.some((arg, i) => i > 0 && i !== outFlag && i !== outFlag + 1)) {
        process.stderr.write("usage: baton share <address> [--out <file>]\n");
        process.exitCode = 2;
        return;
      }
      void runShare(process.cwd(), grantee, outputPath).catch(die);
      return;
    }
    case "accept": {
      const path = rest[0];
      if (!path || rest.length !== 1) {
        process.stderr.write("usage: baton accept <invitation-file>\n");
        process.exitCode = 2;
        return;
      }
      void runAccept(process.cwd(), path).catch(die);
      return;
    }
    case "revoke": {
      const grantee = rest[0];
      if (!grantee || rest.length !== 1) {
        process.stderr.write("usage: baton revoke <address>\n");
        process.exitCode = 2;
        return;
      }
      void runRevoke(process.cwd(), grantee).catch(die);
      return;
    }
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
      void runResume(process.cwd(), id, receivingTool).catch(die);
      return;
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
      if (rest.length > 1 || ![undefined, "status", "encrypt", "upload", "anchor"].includes(rest[0])) {
        process.stderr.write("usage: baton queue [status|encrypt|upload|anchor]\n");
        process.exitCode = 2;
        return;
      }
      if (rest[0] === "encrypt") {
        void runQueueEncrypt(process.cwd()).catch(die);
        return;
      }
      if (rest[0] === "upload") {
        void runQueueUpload(process.cwd()).catch(die);
        return;
      }
      if (rest[0] === "anchor") {
        void runQueueAnchor(process.cwd()).catch(die);
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
    case "mcp": {
      const sub = rest[0];
      if (sub === "setup" || sub === "config") {
        const tool = rest[1] || "all";
        printMcpSetup(tool);
        return;
      }
      process.stderr.write("usage: baton mcp setup [codex | cursor | generic | all]\n");
      process.exitCode = 2;
      return;
    }
    default:
      process.stderr.write(`baton: unknown command "${command}"\n\n${USAGE}`);
      process.exitCode = 2;
      return;
  }
}

function printMcpSetup(tool: string) {
  const project = process.cwd();
  const cmd = "baton-mcp";

  console.log("Copy the relevant section into your MCP client config:\n");

  if (tool === "codex" || tool === "all") {
    console.log("Codex (add via `codex mcp add baton --` or edit .codex/config.toml):");
    console.log(`[mcp_servers.baton]
command = "${cmd}"
args = ["--project", "${project}"]
required = true
startup_timeout_sec = 20
tool_timeout_sec = 120
`);
  }

  if (tool === "cursor" || tool === "all") {
    console.log("Cursor (paste into Cursor settings → MCP or .cursor/mcp.json):");
    console.log(JSON.stringify({
      mcpServers: {
        baton: {
          command: cmd,
          args: ["--project", project],
        },
      },
    }, null, 2) + "\n");
  }

  if (tool === "generic" || tool === "all") {
    console.log("Generic / Claude Desktop / other MCP clients:");
    console.log(JSON.stringify({
      mcpServers: {
        baton: {
          command: cmd,
          args: ["--project", project],
        },
      },
    }, null, 2) + "\n");
  }

  console.log("After configuring, run `baton resume` (or tell your agent to call the baton_resume tool) when starting a new session.");
}

try {
  main(process.argv.slice(2));
} catch (err) {
  die(err);
}
