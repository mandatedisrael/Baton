import { ProjectStore } from "../../store/project.ts";
import { shortId } from "../../core/hash.ts";

export function runLog(cwd: string): void {
  const store = ProjectStore.open(cwd);
  const head = store.config().head;

  const entries = store
    .listHandoffIds()
    .map((id) => ({ id, handoff: store.loadHandoff(id) }))
    .sort((a, b) => b.handoff.meta.timestamp.localeCompare(a.handoff.meta.timestamp));

  if (entries.length === 0) {
    console.log("no batons yet — run `baton pass`");
    return;
  }

  for (const { id, handoff } of entries) {
    const mark = id === head ? "*" : " ";
    const fidelity = handoff.fidelity.score === null ? "—" : handoff.fidelity.score.toFixed(2);
    console.log(
      `${mark} ${shortId(id)}  ${handoff.meta.timestamp}  ${handoff.meta.tool}  ` +
        `fidelity ${fidelity}  ${handoff.mission || "(no mission)"}`,
    );
  }
}
