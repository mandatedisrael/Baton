import { lookup } from "node:dns/promises";
/** Resolve and contact an HTTPS service without interpreting its application response. */
export async function probeHttpsEndpoint(url, deps = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:")
        throw new Error("endpoint must use https");
    const resolve = deps.lookup ?? ((hostname) => lookup(hostname));
    const request = deps.fetch ?? ((input, init) => fetch(input, init));
    const { address } = await resolve(parsed.hostname);
    const response = await request(parsed, {
        method: "HEAD",
        signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    });
    return { url: parsed.origin, address, status: response.status };
}
//# sourceMappingURL=network-health.js.map