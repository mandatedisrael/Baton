import { ProjectStore } from "../../store/project.js";
import { auditHandoffFromRemote } from "../remote.js";
import { ok } from "../output.js";
export async function runAudit(cwd, handoffId) {
    const store = ProjectStore.open(cwd);
    const report = await auditHandoffFromRemote(store, handoffId);
    ok(`remote baton ${handoffId.slice(0, 12)} is fully authenticated`);
    process.stdout.write(`anchor       ${report.anchorTx}\n`);
    process.stdout.write(`handoff blob ${report.handoffBlobId}\n`);
    process.stdout.write(`attachments  ${report.attachments.length}\n`);
    process.stdout.write(`plaintext    ${report.totalPlaintextBytes} bytes verified without local writes\n`);
}
//# sourceMappingURL=audit.js.map