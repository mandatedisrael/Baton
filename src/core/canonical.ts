/**
 * Canonical JSON serialization (RFC 8785-style).
 *
 * Every handoff is hashed over its canonical form, so two machines that
 * serialize the same logical value MUST produce identical bytes. Rules:
 *   - object keys sorted (UTF-16 code unit order)
 *   - no insignificant whitespace
 *   - numbers serialized per ES `JSON.stringify` (matches RFC 8785)
 *   - `undefined` object properties are dropped (deterministic omission)
 *   - `undefined` anywhere else, NaN, ±Infinity, BigInt, functions → error
 */

export class CanonicalizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizeError";
  }
}

export function canonicalize(value: unknown): string {
  const out: string[] = [];
  write(value, out, "$");
  return out.join("");
}

function write(value: unknown, out: string[], path: string): void {
  if (value === null) {
    out.push("null");
    return;
  }
  switch (typeof value) {
    case "string":
      out.push(JSON.stringify(value));
      return;
    case "boolean":
      out.push(value ? "true" : "false");
      return;
    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalizeError(`non-finite number at ${path}`);
      }
      out.push(JSON.stringify(value));
      return;
    case "object":
      break; // handled below
    default:
      throw new CanonicalizeError(`unsupported type "${typeof value}" at ${path}`);
  }

  if (Array.isArray(value)) {
    out.push("[");
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out.push(",");
      if (value[i] === undefined) {
        throw new CanonicalizeError(`undefined array element at ${path}[${i}]`);
      }
      write(value[i], out, `${path}[${i}]`);
    }
    out.push("]");
    return;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  out.push("{");
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    if (i > 0) out.push(",");
    out.push(JSON.stringify(key), ":");
    write(obj[key], out, `${path}.${key}`);
  }
  out.push("}");
}
