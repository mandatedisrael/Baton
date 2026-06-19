import { ProjectStore } from "../../store/project.ts";
import { auditHandoffFromRemote } from "../remote.ts";
import { ok } from "../output.ts";

export async function runAudit(cwd: string, handoffId: string): Promise<void> {
  const store = ProjectStore.open(cwd);
  const report = await auditHandoffFromRemote(store, handoffId);
  ok(`remote baton ${handoffId.slice(0, 12)} is fully authenticated`);
  process.stdout.write(`anchor       ${report.anchorTx}\n`);
  process.stdout.write(`handoff blob ${report.handoffBlobId}\n`);
  process.stdout.write(`attachments  ${report.attachments.length}\n`);
  process.stdout.write(`plaintext    ${report.totalPlaintextBytes} bytes verified without local writes\n`);
}
