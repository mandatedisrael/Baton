import { ProjectStore } from "../../store/project.ts";
import { shortId } from "../../core/hash.ts";
import { projectStatus } from "../../core/status.ts";

export function runStatus(cwd: string): void {
  const store = ProjectStore.open(cwd);
  const state = projectStatus(store);

  console.log(`project   ${state.projectId}`);
  console.log(`head      ${state.head ? shortId(state.head) : "(none — no baton passed yet)"}`);
  console.log(`mission   ${state.mission || "(not set)"}`);
  console.log(`status    ${state.status}`);
  console.log(
    `state     ${state.decisions} decision(s), ${state.graveyard} graveyard, ` +
      `${state.nextActions.length} next action(s), ${state.checkpoints} checkpoint(s)`,
  );
  if (state.nextActions.length > 0) {
    console.log("next");
    for (const [i, action] of state.nextActions.entries()) console.log(`  ${i + 1}. ${action}`);
  }
}
