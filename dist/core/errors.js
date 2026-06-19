/**
 * Error taxonomy. Small on purpose: every failure a user can hit maps to one
 * of these codes, and the CLI renders them uniformly.
 */
export class BatonError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = "BatonError";
        this.code = code;
    }
}
export function isBatonError(err) {
    return err instanceof BatonError;
}
//# sourceMappingURL=errors.js.map