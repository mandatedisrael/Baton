/**
 * Claude Code transcript capture adapter.
 *
 * Claude Code hooks deliver a `transcript_path` to a JSONL file — one JSON
 * object per line. Conversational turns are `type: "user" | "assistant"`
 * (plus `"system"` markers); other line types (mode, permission-mode,
 * file-history-snapshot, ai-title, last-prompt, attachment) are session
 * bookkeeping and carry no turn content.
 *
 * Parsing is tolerant by design: a single malformed line (e.g. a partial
 * write at the tail of a live session) is skipped, never fatal — a partial
 * capture beats none, and the raw bytes are preserved verbatim as the
 * attachment regardless. Line numbers are 1-based and track the source file
 * exactly, so citations into the stored transcript stay valid.
 */
import { readFileSync } from "node:fs";
import { BatonError } from "../../core/errors.js";
import { hashBytes } from "../../core/hash.js";
/** Flatten a `content` value (string or block array) to plain text. */
function asText(content) {
    if (typeof content === "string")
        return content;
    if (Array.isArray(content)) {
        const parts = [];
        for (const it of content) {
            if (typeof it === "string")
                parts.push(it);
            else if (it && typeof it === "object" && typeof it.text === "string") {
                parts.push(it.text);
            }
        }
        return parts.join("\n");
    }
    return "";
}
/** Split a message's content into text / thinking / tool calls / tool results. */
function flatten(message) {
    const text = [];
    const thinking = [];
    const toolUses = [];
    const toolResults = [];
    const content = message.content;
    if (typeof content === "string") {
        text.push(content);
    }
    else if (Array.isArray(content)) {
        for (const raw of content) {
            if (!raw || typeof raw !== "object")
                continue;
            const it = raw;
            switch (it.type) {
                case "text":
                    if (typeof it.text === "string")
                        text.push(it.text);
                    break;
                case "thinking":
                    if (typeof it.thinking === "string")
                        thinking.push(it.thinking);
                    break;
                case "tool_use":
                    toolUses.push({
                        id: typeof it.id === "string" ? it.id : "",
                        name: typeof it.name === "string" ? it.name : "",
                        input: it.input,
                    });
                    break;
                case "tool_result":
                    toolResults.push({
                        toolUseId: typeof it.tool_use_id === "string" ? it.tool_use_id : "",
                        text: asText(it.content),
                        isError: it.is_error === true,
                    });
                    break;
            }
        }
    }
    return {
        text: text.join("\n"),
        thinking: thinking.join("\n"),
        toolUses,
        toolResults,
    };
}
/** Parse raw Claude Code JSONL transcript text into a normalized session. */
export function parseClaudeCodeTranscript(raw) {
    const lines = raw.split("\n");
    const messages = [];
    let sessionId = null;
    let cwd = null;
    let gitBranch = null;
    let model = null;
    for (let i = 0; i < lines.length; i++) {
        const lineStr = lines[i];
        if (lineStr.trim() === "")
            continue;
        let o;
        try {
            const parsed = JSON.parse(lineStr);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
                continue;
            o = parsed;
        }
        catch {
            continue; // tolerate a partial/corrupt line; raw bytes still preserved
        }
        // Session-level metadata can appear on any line; keep the latest seen.
        if (typeof o.sessionId === "string")
            sessionId = o.sessionId;
        if (typeof o.cwd === "string")
            cwd = o.cwd;
        if (typeof o.gitBranch === "string")
            gitBranch = o.gitBranch;
        const type = o.type;
        if (type !== "user" && type !== "assistant" && type !== "system")
            continue;
        const role = type;
        const message = o.message && typeof o.message === "object" && !Array.isArray(o.message)
            ? o.message
            : {};
        if (role === "assistant" && typeof message.model === "string")
            model = message.model;
        const flat = flatten(message);
        // `system` lines carry their text at the top level rather than in `message`.
        if (role === "system" && flat.text === "" && typeof o.content === "string") {
            flat.text = o.content;
        }
        messages.push({
            line: i + 1,
            role,
            uuid: typeof o.uuid === "string" ? o.uuid : null,
            parentUuid: typeof o.parentUuid === "string" ? o.parentUuid : null,
            isSidechain: o.isSidechain === true,
            isMeta: o.isMeta === true,
            timestamp: typeof o.timestamp === "string" ? o.timestamp : null,
            text: flat.text,
            thinking: flat.thinking,
            toolUses: flat.toolUses,
            toolResults: flat.toolResults,
        });
    }
    const lineCount = lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
    return {
        tool: "claude-code",
        sessionId,
        model,
        cwd,
        gitBranch,
        messages,
        raw: {
            bytes: Buffer.byteLength(raw, "utf8"),
            hash: hashBytes(raw),
            lineCount,
        },
    };
}
/** Read and parse a Claude Code transcript file from disk. */
export function captureClaudeCodeFile(path) {
    let raw;
    try {
        raw = readFileSync(path, "utf8");
    }
    catch (err) {
        throw new BatonError("IO_ERROR", `failed reading transcript ${path}`, { cause: err });
    }
    return parseClaudeCodeTranscript(raw);
}
//# sourceMappingURL=claude-code.js.map