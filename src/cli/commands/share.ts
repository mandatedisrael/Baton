import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { grantAccessOnSui } from "../../chain/sharing.ts";
import { loadIdentity } from "../../chain/identity.ts";
import { BatonError } from "../../core/errors.ts";
import type { ShareInvitation } from "../../schema/invite.ts";
import { ProjectStore } from "../../store/project.ts";
import { ok } from "../output.ts";

export async function runShare(cwd: string, grantee: string, outputPath?: string, identityPath?: string): Promise<void> {
  const store = ProjectStore.open(cwd);
  const config = store.config();
  if (!config.remote) throw new BatonError("INVALID_STATE", "project is local-only — register it before sharing");
  if (!config.head) throw new BatonError("INVALID_STATE", "pass and publish at least one baton before sharing");
  const loaded = loadIdentity(identityPath);
  const client = new SuiJsonRpcClient({ network: config.remote.network, url: config.remote.rpcUrl });
  const grantedAt = new Date().toISOString();
  const result = await grantAccessOnSui({ client, identity: loaded, remote: config.remote, grantee });
  const invitation: ShareInvitation = {
    schemaVersion: 1,
    projectId: config.projectId,
    grantee: result.grantee,
    head: config.head,
    grantTx: result.digest,
    grantedAt,
    remote: {
      ...config.remote,
      authority: { kind: "delegate", capId: result.accessCapId },
    },
  };
  const path = resolve(cwd, outputPath ?? `baton-invite-${result.grantee.slice(-8)}.json`);
  try {
    writeFileSync(path, `${JSON.stringify(invitation, null, 2)}\n`, { encoding: "utf8", mode: 0o644, flag: "wx" });
  } catch (err) {
    throw new BatonError(
      "IO_ERROR",
      `access was granted on-chain (${result.digest}) but the invitation could not be written to ${path}`,
      { cause: err },
    );
  }
  ok(`read access granted to ${result.grantee}`);
  ok(`invitation written: ${path}`);
  ok(`Sui transaction: ${result.digest}`);
}
