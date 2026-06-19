#!/usr/bin/env node
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { loadIdentity, requireEd25519Identity } from "../chain/identity.ts";
import {
  BATON_CORE_TESTNET_ORIGINAL_PACKAGE,
  BATON_CORE_TESTNET_PACKAGE,
  TESTNET_RPC_URL,
} from "../chain/networks.ts";
import { SPONSORED_REGISTRATION_GAS_BUDGET } from "../chain/sponsorship.ts";
import { BatonError } from "../core/errors.ts";
import { createSponsorServer } from "./server.ts";
import { reconcileSponsorState } from "./reconcile.ts";
import {
  defaultSponsorStatePath,
  issueSponsorInviteDetails,
  listSponsorInvites,
  pruneSponsorInvites,
  revokeSponsorInvite,
  withSponsorStateLock,
} from "./state.ts";

const USAGE = `baton-sponsor — constrained Testnet gas sponsorship for Baton onboarding

Usage:
  baton-sponsor invite [--state <file>] [--ttl-hours <1-168>] [--recipient <address>] [--project <id>]
  baton-sponsor list [--state <file>] [--json]
  baton-sponsor revoke --id <invite-id> [--state <file>]
  baton-sponsor prune [--state <file>]
  baton-sponsor reconcile [--state <file>]
  baton-sponsor serve [--state <file>] [--identity <file>] [--port <port>]
    [--trust-proxy] [--rate-limit <per-minute>] [--daily-limit <count>] [--max-active <count>]

The HTTP service binds to 127.0.0.1 only. Put a TLS reverse proxy in front of
it for remote users; invitation tokens must never cross plaintext networks.
`;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new BatonError("INVALID_STATE", `${name} requires a value`);
  return value;
}

function positiveIntegerFlag(args: string[], name: string, envName: string, fallback: number): number {
  const raw = flag(args, name) ?? process.env[envName] ?? String(fallback);
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || !Number.isSafeInteger(Number(raw))) {
    throw new BatonError("INVALID_STATE", `${name} must be a positive integer`);
  }
  return Number(raw);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "-h" || command === "--help" || command === "help") {
    process.stdout.write(USAGE);
    return;
  }
  const statePath = flag(args, "--state") ?? process.env.BATON_SPONSOR_STATE ?? defaultSponsorStatePath();
  if (command === "invite") {
    const rawTtl = flag(args, "--ttl-hours") ?? "24";
    if (!/^\d+$/.test(rawTtl)) throw new BatonError("INVALID_STATE", "--ttl-hours must be an integer");
    const issued = await withSponsorStateLock(statePath, () => issueSponsorInviteDetails(statePath, new Date(), Number(rawTtl), {
      recipient: flag(args, "--recipient"),
      projectId: flag(args, "--project"),
    }));
    process.stdout.write(`${issued.token}\n`);
    process.stderr.write(`Sponsor invitation ${issued.id} created · valid ${rawTtl} hour(s) · stored hashed in ${statePath}\n`);
    return;
  }
  if (command === "list") {
    const invites = await withSponsorStateLock(statePath, () => listSponsorInvites(statePath));
    if (args.includes("--json")) process.stdout.write(`${JSON.stringify(invites, null, 2)}\n`);
    else if (invites.length === 0) process.stdout.write("No sponsor invitations.\n");
    else {
      for (const invite of invites) {
        const binding = [invite.recipient, invite.projectId].filter(Boolean).join(" · ") || "unbound";
        process.stdout.write(`${invite.id}  ${invite.status.padEnd(9)}  ${invite.expiresAt}  ${binding}${invite.digest ? `  ${invite.digest}` : ""}\n`);
      }
    }
    return;
  }
  if (command === "revoke") {
    const id = flag(args, "--id");
    if (!id) throw new BatonError("INVALID_STATE", "revoke requires --id <invite-id>");
    await withSponsorStateLock(statePath, () => revokeSponsorInvite(statePath, id));
    process.stderr.write(`Sponsor invitation ${id} revoked.\n`);
    return;
  }
  if (command === "prune") {
    const removed = await withSponsorStateLock(statePath, () => pruneSponsorInvites(statePath));
    process.stderr.write(`Pruned ${removed} expired or revoked sponsor invitation(s).\n`);
    return;
  }
  if (command === "reconcile") {
    const client = new SuiJsonRpcClient({ network: "testnet", url: TESTNET_RPC_URL });
    const summary = await reconcileSponsorState({
      client,
      statePath,
      typePackageId: BATON_CORE_TESTNET_ORIGINAL_PACKAGE,
    });
    process.stderr.write(
      `Reconciled ${summary.completed}/${summary.checked} submitted registration(s) · ${summary.pending} still pending.\n`,
    );
    return;
  }
  if (command !== "serve") throw new BatonError("INVALID_STATE", `unknown sponsor command: ${command}`);
  const rawPort = flag(args, "--port") ?? "8787";
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new BatonError("INVALID_STATE", "--port must be 1–65535");
  }
  const identityPath = flag(args, "--identity") ?? process.env.BATON_SPONSOR_IDENTITY;
  const loaded = loadIdentity(identityPath);
  const { record, keypair } = requireEd25519Identity(loaded);
  const client = new SuiJsonRpcClient({ network: "testnet", url: TESTNET_RPC_URL });
  const recovered = await reconcileSponsorState({
    client,
    statePath,
    typePackageId: BATON_CORE_TESTNET_ORIGINAL_PACKAGE,
  });
  if (recovered.checked > 0) {
    process.stderr.write(
      `Sponsor reconciliation · ${recovered.completed} completed · ${recovered.pending} still pending\n`,
    );
  }
  const balance = await client.getBalance({ owner: record.address });
  if (BigInt(balance.totalBalance) < SPONSORED_REGISTRATION_GAS_BUDGET) {
    throw new BatonError(
      "INVALID_STATE",
      `sponsor ${record.address} needs at least ${SPONSORED_REGISTRATION_GAS_BUDGET} MIST on Testnet`,
    );
  }
  const server = createSponsorServer({
    client,
    sponsorKeypair: keypair,
    statePath,
    policyPackageId: BATON_CORE_TESTNET_PACKAGE,
    typePackageId: BATON_CORE_TESTNET_ORIGINAL_PACKAGE,
    trustProxy: args.includes("--trust-proxy") || process.env.BATON_SPONSOR_TRUST_PROXY === "1",
    rateLimitPerMinute: positiveIntegerFlag(args, "--rate-limit", "BATON_SPONSOR_RATE_LIMIT", 30),
    maxDailyRegistrations: positiveIntegerFlag(args, "--daily-limit", "BATON_SPONSOR_DAILY_LIMIT", 100),
    maxActiveReservations: positiveIntegerFlag(args, "--max-active", "BATON_SPONSOR_MAX_ACTIVE", 10),
  });
  const port = Number(rawPort);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  process.stderr.write(`Baton sponsor listening on http://127.0.0.1:${port} · ${record.address}\n`);
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((err) => {
  process.stderr.write(`baton-sponsor: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
