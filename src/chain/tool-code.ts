import { BatonError } from "../core/errors.ts";
import type { ToolId } from "../schema/handoff.ts";

/**
 * Stable numeric values understood by the deployed v2 Move package.
 *
 * These values are protocol data, not array indexes. The current contract
 * accepts 0..4, so newer clients intentionally anchor OpenCode as `other`
 * while retaining `opencode` inside the encrypted canonical handoff.
 */
const ON_CHAIN_TOOL_CODES: Readonly<Record<ToolId, number>> = {
  "claude-code": 0,
  codex: 1,
  cursor: 2,
  "chatgpt-web": 3,
  other: 4,
  opencode: 4,
};

export function onChainToolCode(tool: ToolId): number {
  const code = ON_CHAIN_TOOL_CODES[tool];
  if (!Number.isInteger(code) || code < 0 || code > 4) {
    throw new BatonError("INVALID_HANDOFF", `tool ${tool} has no deployed on-chain encoding`);
  }
  return code;
}
