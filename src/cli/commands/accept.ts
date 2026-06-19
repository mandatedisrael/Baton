import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { loadIdentity } from "../../chain/identity.ts";
import { verifyDelegatedAccess } from "../../chain/sharing.ts";
import { BatonError } from "../../core/errors.ts";
import { parseShareInvitation } from "../../schema/invite.ts";
import { ProjectStore } from "../../store/project.ts";
import { ok } from "../output.ts";

const MAX_INVITATION_BYTES = 64 * 1024;

export async function runAccept(cwd: string, invitationPath: string, identityPath?: string): Promise<void> {
  const path = resolve(cwd, invitationPath);
  let invitation;
  try {
    if (statSync(path).size > MAX_INVITATION_BYTES) {
      throw new BatonError("INVALID_STATE", "invitation exceeds the 64 KiB safety bound");
    }
    invitation = parseShareInvitation(JSON.parse(readFileSync(path, "utf8")));
  } catch (err) {
    if (err instanceof BatonError) throw err;
    throw new BatonError("INVALID_STATE", `invalid Baton invitation: ${path}`, { cause: err });
  }
  const { record } = loadIdentity(identityPath);
  if (normalizeSuiAddress(record.address) !== invitation.grantee) {
    throw new BatonError("INVALID_STATE", `invitation is for ${invitation.grantee}, not this Baton identity`);
  }
  const client = new SuiJsonRpcClient({ network: invitation.remote.network, url: invitation.remote.rpcUrl });
  await verifyDelegatedAccess({ client, remote: invitation.remote, grantee: record.address });

  let store: ProjectStore;
  try {
    store = ProjectStore.open(cwd);
  } catch (err) {
    if (!(err instanceof BatonError) || err.code !== "NOT_INITIALIZED") throw err;
    store = ProjectStore.init(resolve(cwd));
  }
  store.joinRemoteProject(invitation.projectId, invitation.head, invitation.remote);
  ok(`joined shared Baton project ${invitation.projectId}`);
  ok(`head ${invitation.head.slice(0, 12)} is ready to fetch or resume`);
}
