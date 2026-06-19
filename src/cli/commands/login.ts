import { loadOrCreateIdentity } from "../../chain/identity.ts";
import { ok } from "../output.ts";

export function runLogin(identityPath?: string): void {
  const { record } = loadOrCreateIdentity(identityPath);
  ok(`Baton identity ready: ${record.address}`);
}
