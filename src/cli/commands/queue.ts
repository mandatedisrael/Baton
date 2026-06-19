import { renderQueueStatus } from "../../render/queue.ts";
import { ProjectStore } from "../../store/project.ts";

export function runQueueStatus(cwd: string): void {
  const store = ProjectStore.open(cwd);
  process.stdout.write(renderQueueStatus(store.listUploadJobs()));
}
