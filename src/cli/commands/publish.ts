import { ok } from "../output.ts";
import { runQueueAnchor, runQueueEncrypt, runQueueUpload } from "./queue.ts";

export interface PublicationStages {
  encrypt(cwd: string): Promise<void>;
  upload(cwd: string): Promise<void>;
  anchor(cwd: string): Promise<void>;
}

const DEFAULT_STAGES: PublicationStages = {
  encrypt: runQueueEncrypt,
  upload: runQueueUpload,
  anchor: runQueueAnchor,
};

/** Run the durable publication stages in dependency order; each stage remains independently resumable. */
export async function runPublish(cwd: string, stages: PublicationStages = DEFAULT_STAGES): Promise<void> {
  await stages.encrypt(cwd);
  await stages.upload(cwd);
  await stages.anchor(cwd);
  ok("publication queue is fully encrypted, stored, and anchored");
}
