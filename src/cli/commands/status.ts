import { ProjectStore } from "../../store/project.ts";
import { shortId } from "../../core/hash.ts";

export function runStatus(cwd: string): void {
  const store = ProjectStore.open(cwd);
  const config = store.config();
  const state = store.loadWorkingState();

  console.log(`project   ${config.projectId}`);
  console.log(`head      ${config.head ? shortId(config.head) : "(none — no baton passed yet)"}`);
  console.log(`mission   ${state.mission || "(not set)"}`);
  console.log(`status    ${state.status}`);
  console.log(
    `state     ${state.decisions.length} decision(s), ${state.graveyard.length} graveyard, ` +
      `${state.nextActions.length} next action(s), ${state.checkpointCount} checkpoint(s)`,
  );
  if (state.nextActions.length > 0) {
    console.log("next");
    for (const [i, action] of state.nextActions.entries()) console.log(`  ${i + 1}. ${action}`);
  }
}
