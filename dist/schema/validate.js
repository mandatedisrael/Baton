/**
 * Minimal strict validation toolkit (zero dependencies).
 *
 * Stricter than typical schema libraries in one important way: unknown
 * object keys are REJECTED, not stripped. Handoffs are content-addressed;
 * a document must contain exactly what gets hashed — silently dropping
 * keys would let file bytes diverge from what verification attests.
 */
export class ValidationError extends Error {
    constructor(path, message) {
        super(`${path}: ${message}`);
        this.name = "ValidationError";
    }
}
export function obj(v, path, allowedKeys) {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
        throw new ValidationError(path, "expected object");
    }
    const record = v;
    for (const key of Object.keys(record)) {
        if (!allowedKeys.includes(key)) {
            throw new ValidationError(path, `unknown key "${key}"`);
        }
    }
    return record;
}
export function str(v, path, opts = {}) {
    if (typeof v !== "string")
        throw new ValidationError(path, "expected string");
    if (opts.min !== undefined && v.length < opts.min) {
        throw new ValidationError(path, `expected at least ${opts.min} character(s)`);
    }
    return v;
}
export function optStr(v, path, opts = {}) {
    return v === undefined ? undefined : str(v, path, opts);
}
export function num(v, path, opts = {}) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new ValidationError(path, "expected finite number");
    }
    if (opts.int && !Number.isInteger(v))
        throw new ValidationError(path, "expected integer");
    if (opts.min !== undefined && v < opts.min)
        throw new ValidationError(path, `expected >= ${opts.min}`);
    if (opts.max !== undefined && v > opts.max)
        throw new ValidationError(path, `expected <= ${opts.max}`);
    return v;
}
export function literal(v, path, expected) {
    if (v !== expected)
        throw new ValidationError(path, `expected ${JSON.stringify(expected)}`);
    return expected;
}
export function oneOf(v, path, values) {
    if (typeof v !== "string" || !values.includes(v)) {
        throw new ValidationError(path, `expected one of: ${values.join(", ")}`);
    }
    return v;
}
export function arr(v, path, item) {
    if (!Array.isArray(v))
        throw new ValidationError(path, "expected array");
    return v.map((el, i) => item(el, `${path}[${i}]`));
}
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export function isoDatetime(v, path) {
    const s = str(v, path);
    if (!ISO_DATETIME.test(s) || Number.isNaN(Date.parse(s))) {
        throw new ValidationError(path, "expected ISO 8601 datetime");
    }
    return s;
}
export function nullable(v, path, inner) {
    return v === null ? null : inner(v, path);
}
//# sourceMappingURL=validate.js.map