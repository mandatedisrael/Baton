/**
 * CLI output helpers. No blockchain-speak in UX (plan §1.2) — users see
 * batons, projects, and verification, never blobs or epochs.
 */
import { createInterface } from "node:readline";
import { isBatonError } from "../core/errors.js";
export const ok = (msg) => console.log(`✓ ${msg}`);
export const warn = (msg) => console.warn(`! ${msg}`);
export const fail = (msg) => console.error(`✗ ${msg}`);
/**
 * Ask a yes/no question. Defaults to NO — an unanswered or EOF'd prompt never
 * silently proceeds (a review gate that auto-approves is no gate). Works with a
 * TTY or piped input (`echo y | baton pass --review`).
 */
export function confirm(question) {
    process.stdout.write(`${question} [y/N] `);
    const rl = createInterface({ input: process.stdin });
    return new Promise((resolve) => {
        let answered = false;
        rl.once("line", (line) => {
            answered = true;
            rl.close();
            resolve(/^y(es)?$/i.test(line.trim()));
        });
        rl.once("close", () => {
            if (!answered)
                resolve(false); // EOF / no input → No (a gate never auto-approves)
        });
    });
}
/** Uniform error rendering + exit. */
export function die(err) {
    if (isBatonError(err)) {
        fail(err.message);
    }
    else if (err instanceof Error) {
        fail(`unexpected error: ${err.message}`);
    }
    else {
        fail(`unexpected error: ${String(err)}`);
    }
    process.exit(1);
}
//# sourceMappingURL=output.js.map