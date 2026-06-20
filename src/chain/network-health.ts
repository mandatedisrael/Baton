import { lookup } from "node:dns/promises";

export interface EndpointProbe {
  url: string;
  address: string;
  status: number;
}

export interface ProbeDependencies {
  lookup?: (hostname: string) => Promise<{ address: string }>;
  fetch?: (input: URL, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

/** Resolve and contact an HTTPS service without interpreting its application response. */
export async function probeHttpsEndpoint(url: string, deps: ProbeDependencies = {}): Promise<EndpointProbe> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("endpoint must use https");

  const resolve = deps.lookup ?? ((hostname: string) => lookup(hostname));
  const request = deps.fetch ?? ((input: URL, init: RequestInit) => fetch(input, init));
  const { address } = await resolve(parsed.hostname);
  const response = await request(parsed, {
    method: "HEAD",
    signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
  });
  return { url: parsed.origin, address, status: response.status };
}
