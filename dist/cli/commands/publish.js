import { ok } from "../output.js";
import { runQueueAnchor, runQueueEncrypt, runQueueUpload } from "./queue.js";
const DEFAULT_STAGES = {
    encrypt: runQueueEncrypt,
    upload: runQueueUpload,
    anchor: runQueueAnchor,
};
/** Run the durable publication stages in dependency order; each stage remains independently resumable. */
export async function runPublish(cwd, stages = DEFAULT_STAGES) {
    await stages.encrypt(cwd);
    await stages.upload(cwd);
    await stages.anchor(cwd);
    ok("publication queue is fully encrypted, stored, and anchored");
}
//# sourceMappingURL=publish.js.map