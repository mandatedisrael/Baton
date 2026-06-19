#!/usr/bin/env node
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { loadIdentity } from "../chain/identity.ts";
import {
  BATON_CORE_TESTNET_ORIGINAL_PACKAGE,
  BATON_CORE_TESTNET_PACKAGE,
  TESTNET_RPC_URL,
} from "../chain/networks.ts";
import { SPONSORED_REGISTRATION_GAS_BUDGET } from "../chain/sponsorship.ts";
import { BatonError } from "../core/errors.ts";
import { createSponsorServer } from "./server.ts";
import { defaultSponsorStatePath, issueSponsorInvite } from "./state.ts";

const USAGE = `baton-sponsor — constrained Testnet gas sponsorship for Baton onboarding

Usage:
  baton-sponsor invite [--state <file>] [--ttl-hours <1-168>]
  baton-sponsor serve [--state <file>] [--identity <file>] [--port <port>]

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
    const token = issueSponsorInvite(statePath, new Date(), Number(rawTtl));
    process.stdout.write(`${token}\n`);
    process.stderr.write(`Sponsor invitation created · valid ${rawTtl} hour(s) · stored hashed in ${statePath}\n`);
    return;
  }
  if (command !== "serve") throw new BatonError("INVALID_STATE", `unknown sponsor command: ${command}`);
  const rawPort = flag(args, "--port") ?? "8787";
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new BatonError("INVALID_STATE", "--port must be 1–65535");
  }
  const identityPath = flag(args, "--identity") ?? process.env.BATON_SPONSOR_IDENTITY;
  const { record, keypair } = loadIdentity(identityPath);
  const client = new SuiJsonRpcClient({ network: "testnet", url: TESTNET_RPC_URL });
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
