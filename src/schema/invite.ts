import { normalizeSuiAddress } from "@mysten/sui/utils";
import { parseProjectConfig, type RemoteProjectConfig } from "./project.ts";
import { isoDatetime, literal, obj, str, ValidationError } from "./validate.ts";

export interface ShareInvitation {
  schemaVersion: 1;
  projectId: string;
  grantee: string;
  head: string;
  grantTx: string;
  grantedAt: string;
  remote: RemoteProjectConfig;
}

export function parseShareInvitation(value: unknown): ShareInvitation {
  const r = obj(value, "invitation", [
    "schemaVersion",
    "projectId",
    "grantee",
    "head",
    "grantTx",
    "grantedAt",
    "remote",
  ]);
  const projectId = str(r.projectId, "invitation.projectId", { min: 1 });
  const remote = parseProjectConfig({
    schemaVersion: 1,
    projectId,
    createdAt: r.grantedAt,
    head: r.head,
    remote: r.remote,
  }).remote!;
  if (remote.authority.kind !== "delegate") {
    throw new Error("invitation remote authority must be delegated");
  }
  const head = str(r.head, "invitation.head", { min: 1 });
  if (!/^[a-f0-9]{64}$/.test(head)) {
    throw new ValidationError("invitation.head", "expected a full lowercase baton id");
  }
  return {
    schemaVersion: literal(r.schemaVersion, "invitation.schemaVersion", 1),
    projectId,
    grantee: normalizeSuiAddress(str(r.grantee, "invitation.grantee", { min: 1 })),
    head,
    grantTx: str(r.grantTx, "invitation.grantTx", { min: 1 }),
    grantedAt: isoDatetime(r.grantedAt, "invitation.grantedAt"),
    remote,
  };
}
