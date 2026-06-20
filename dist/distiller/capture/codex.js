/** Codex rollout JSONL capture adapter and project-scoped session discovery. */
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync, } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { BatonError } from "../../core/errors.js";
import { hashBytes } from "../../core/hash.js";
function record(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
}
function textBlocks(value) {
    if (typeof value === "string")
        return value;
    if (!Array.isArray(value))
        return "";
    return value
        .map((raw) => {
        const block = record(raw);
        return block && typeof block.text === "string" ? block.text : "";
    })
        .filter(Boolean)
        .join("\n");
}
function toolInput(payload) {
    const value = payload.input ?? payload.arguments;
    if (typeof value !== "string")
        return value ?? {};
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function isMetaUserText(text) {
    const trimmed = text.trimStart();
    return trimmed.startsWith("<environment_context>") || trimmed.startsWith("<permissions instructions>");
}
function messageAt(line, timestamp, role) {
    return {
        line,
        role,
        uuid: null,
        parentUuid: null,
        isSidechain: false,
        isMeta: false,
        timestamp,
        text: "",
        thinking: "",
        toolUses: [],
        toolResults: [],
    };
}
/** Parse a Codex rollout JSONL file while preserving source line citations. */
export function parseCodexTranscript(raw) {
    const lines = raw.split("\n");
    const messages = [];
    let sessionId = null;
    let cwd = null;
    let gitBranch = null;
    let model = null;
    for (let index = 0; index < lines.length; index += 1) {
        const source = lines[index];
        if (source.trim() === "")
            continue;
        let item;
        try {
            const parsed = record(JSON.parse(source));
            if (!parsed)
                continue;
            item = parsed;
        }
        catch {
            continue;
        }
        const payload = record(item.payload);
        if (!payload)
            continue;
        const timestamp = typeof item.timestamp === "string" ? item.timestamp : null;
        if (item.type === "session_meta") {
            if (typeof payload.id === "string")
                sessionId = payload.id;
            if (typeof payload.cwd === "string")
                cwd = payload.cwd;
            const git = record(payload.git);
            if (git && typeof git.branch === "string")
                gitBranch = git.branch;
            continue;
        }
        if (item.type === "turn_context") {
            if (typeof payload.cwd === "string")
                cwd = payload.cwd;
            if (typeof payload.model === "string")
                model = payload.model;
            continue;
        }
        if (item.type !== "response_item")
            continue;
        const type = payload.type;
        if (type === "message") {
            if (payload.role !== "user" && payload.role !== "assistant")
                continue;
            const role = payload.role;
            const message = messageAt(index + 1, timestamp, role);
            message.text = textBlocks(payload.content);
            message.isMeta = role === "user" && isMetaUserText(message.text);
            messages.push(message);
            continue;
        }
        if (type === "custom_tool_call" || type === "function_call") {
            const use = {
                id: typeof payload.call_id === "string" ? payload.call_id : "",
                name: typeof payload.name === "string" ? payload.name : "",
                input: toolInput(payload),
            };
            const message = messageAt(index + 1, timestamp, "assistant");
            message.toolUses.push(use);
            messages.push(message);
            continue;
        }
        if (type === "custom_tool_call_output" || type === "function_call_output") {
            const result = {
                toolUseId: typeof payload.call_id === "string" ? payload.call_id : "",
                text: textBlocks(payload.output),
                isError: payload.is_error === true,
            };
            const message = messageAt(index + 1, timestamp, "system");
            message.toolResults.push(result);
            messages.push(message);
        }
    }
    const lineCount = lines.length > 0 && lines.at(-1) === "" ? lines.length - 1 : lines.length;
    return {
        tool: "codex",
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
export function captureCodexFile(path) {
    try {
        return parseCodexTranscript(readFileSync(path, "utf8"));
    }
    catch (err) {
        throw new BatonError("IO_ERROR", `failed reading Codex transcript ${path}`, { cause: err });
    }
}
function sessionCwd(path) {
    let fd;
    try {
        fd = openSync(path, "r");
        const buffer = Buffer.alloc(64 * 1024);
        const bytes = readSync(fd, buffer, 0, buffer.length, 0);
        const firstLine = buffer.subarray(0, bytes).toString("utf8").split("\n", 1)[0];
        if (!firstLine)
            return null;
        const payload = record(record(JSON.parse(firstLine))?.payload);
        return payload && typeof payload.cwd === "string" ? payload.cwd : null;
    }
    catch {
        return null;
    }
    finally {
        if (fd !== undefined)
            closeSync(fd);
    }
}
/** Find the newest Codex rollout whose recorded cwd is this project. */
export function findLatestCodexSession(projectRoot, sessionsRoot = join(homedir(), ".codex", "sessions")) {
    const target = resolve(projectRoot);
    const stack = [sessionsRoot];
    let latest = null;
    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(path);
            }
            else if (entry.isFile() && entry.name.endsWith(".jsonl") && sessionCwd(path) === target) {
                const mtimeMs = statSync(path).mtimeMs;
                if (!latest || mtimeMs > latest.mtimeMs)
                    latest = { path, mtimeMs };
            }
        }
    }
    return latest?.path ?? null;
}
//# sourceMappingURL=codex.js.map