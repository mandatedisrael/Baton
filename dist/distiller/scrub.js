/**
 * Secrets scrubber (plan §3.3 step 3) — runs before anything is sealed.
 *
 * Developers paste API keys, tokens, and private keys into agent sessions
 * constantly; a content-addressed, shareable handoff must not immortalize
 * them. Two detection layers:
 *
 *   1. Known-format patterns — provider key shapes (sk-ant-..., AKIA..., ghp_,
 *      JWTs, PEM private-key blocks, ...). High precision.
 *   2. Contextual assignments — a credential-ish key name (`api_key`, `secret`,
 *      `password`, ...) followed by a value. Catches keys we don't have a
 *      format for.
 *
 * Two deliberate non-goals, both to protect fidelity (over-redaction silently
 * corrupts the handoff just as badly as a leak):
 *   - No broad entropy sweep. A blind "redact any high-entropy token" pass
 *     mangles legitimate content — including BATON's own 64-hex SHA-256 ids.
 *     Entropy is exported as a helper and used to *gate* contextual matches,
 *     not to hunt freely.
 *   - Line-count preserving. Every replacement is single-line and PEM blocks
 *     are redacted line-by-line, so a scrubbed transcript has the exact same
 *     line numbers as the original — citations stay valid against it.
 */
const token = (type) => `[REDACTED:${type}]`;
/** Shannon entropy in bits per character. Exported for callers and tests. */
export function shannonEntropy(s) {
    if (s.length === 0)
        return 0;
    const freq = new Map();
    for (const ch of s)
        freq.set(ch, (freq.get(ch) ?? 0) + 1);
    let bits = 0;
    for (const n of freq.values()) {
        const p = n / s.length;
        bits -= p * Math.log2(p);
    }
    return bits;
}
// Order matters: more specific provider shapes first so a generic rule can't
// swallow part of one. Every `re` is global and single-line (no newlines in a
// match) so line counts are preserved.
const PATTERNS = [
    { type: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{16,}/g },
    { type: "openai-key", re: /sk-(?:proj-)?[A-Za-z0-9]{20,}/g },
    { type: "github-pat", re: /github_pat_[A-Za-z0-9_]{22,}/g },
    { type: "github-token", re: /gh[pousr]_[A-Za-z0-9]{36,}/g },
    { type: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
    { type: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
    { type: "slack-token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
    { type: "stripe-key", re: /\b[rs]k_(?:live|test)_[0-9A-Za-z]{16,}\b/g },
    {
        type: "jwt",
        re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    },
    {
        type: "bearer-token",
        re: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/g,
        replace: (t) => `$1${token(t)}`,
    },
];
// `key: value` / `key = value` where the key name looks like a credential.
// Value is unquoted-no-space or quoted; length-gated to avoid trivia.
const ASSIGNMENT = /(\b(?:api[_-]?key|apikey|secret|secret[_-]?key|access[_-]?key|client[_-]?secret|password|passwd|pwd|auth[_-]?token|token|bearer)\b\s*[:=]\s*)(["']?)([^\s"']{12,})(["']?)/gi;
// PEM block markers (handled line-by-line so the block's line count survives).
const PEM_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const PEM_END = /-----END [A-Z0-9 ]*PRIVATE KEY-----/;
/** Redact secrets from a single string. Line count is preserved. */
export function scrub(input) {
    const counts = new Map();
    const bump = (type, n = 1) => {
        counts.set(type, (counts.get(type) ?? 0) + n);
    };
    const lines = input.split("\n");
    let inPemBlock = false;
    const cleaned = lines.map((line) => {
        // PEM private-key block: redact every line of it, preserving line count.
        if (inPemBlock) {
            if (PEM_END.test(line))
                inPemBlock = false;
            return token("private-key");
        }
        if (PEM_BEGIN.test(line)) {
            inPemBlock = !PEM_END.test(line); // single-line PEM is possible but rare
            bump("private-key");
            return token("private-key");
        }
        let out = line;
        for (const { type, re, replace } of PATTERNS) {
            out = out.replace(re, (...args) => {
                bump(type);
                return replace ? replace(type).replace("$1", args[1]) : token(type);
            });
        }
        out = out.replace(ASSIGNMENT, (whole, prefix, openQ, value, closeQ) => {
            // Gate on entropy so obvious non-secrets (e.g. password=description-here
            // is excluded by the no-space rule already; this catches dictionary-y
            // values) aren't redacted — but keep recall high for real credentials.
            if (shannonEntropy(value) < 2.5)
                return whole;
            bump("assignment");
            return `${prefix}${openQ}${token("assignment")}${closeQ}`;
        });
        return out;
    });
    const findings = [...counts.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => a.type.localeCompare(b.type));
    return { clean: cleaned.join("\n"), findings };
}
function mergeFindings(into, from) {
    for (const f of from)
        into.set(f.type, (into.get(f.type) ?? 0) + f.count);
}
/**
 * Recursively scrub every string in a JSON-able value (objects, arrays,
 * strings). Used to clean a WorkingState / handoff distillate before sealing.
 * Returns a new value; the input is not mutated.
 */
export function scrubDeep(value) {
    const counts = new Map();
    const walk = (v) => {
        if (typeof v === "string") {
            const r = scrub(v);
            mergeFindings(counts, r.findings);
            return r.clean;
        }
        if (Array.isArray(v))
            return v.map(walk);
        if (v && typeof v === "object") {
            const out = {};
            for (const [k, val] of Object.entries(v))
                out[k] = walk(val);
            return out;
        }
        return v;
    };
    const cleaned = walk(value);
    const findings = [...counts.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => a.type.localeCompare(b.type));
    return { value: cleaned, findings };
}
//# sourceMappingURL=scrub.js.map