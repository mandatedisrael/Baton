import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { BatonError } from "../core/errors.ts";
import type { RegistrationResult } from "./registration.ts";
import { verifySponsoredRegistrationEnvelope, type SponsoredRegistrationEnvelope } from "./sponsorship.ts";

export function validateSponsorUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BatonError("INVALID_STATE", "sponsor URL is invalid");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new BatonError("INVALID_STATE", "sponsor URL must use HTTPS (HTTP is allowed only on loopback)");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function post(url: string, value: unknown, timeoutMs: number): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new BatonError("IO_ERROR", `sponsor request failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (err) {
    throw new BatonError("IO_ERROR", "sponsor returned invalid JSON", { cause: err });
  }
  if (!response.ok) {
    const message = parsed && typeof parsed === "object" && "error" in parsed ? String(parsed.error) : `HTTP ${response.status}`;
    throw new BatonError("IO_ERROR", `sponsor refused registration: ${message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new BatonError("IO_ERROR", "sponsor returned an invalid response");
  return parsed as Record<string, unknown>;
}

function strings(value: Record<string, unknown>, keys: string[]): Record<string, string> {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new BatonError("INVALID_STATE", "sponsor response contains unknown fields");
  const output: Record<string, string> = {};
  for (const key of keys) {
    if (typeof value[key] !== "string" || value[key].length === 0) throw new BatonError("INVALID_STATE", `sponsor response.${key} is invalid`);
    output[key] = value[key];
  }
  return output;
}

function preparedEnvelope(value: Record<string, unknown>): SponsoredRegistrationEnvelope {
  const stringKeys = ["requestId", "transactionBytes", "sponsor", "gasPrice", "gasBudget", "expirationEpoch", "expiresAt"];
  const allowed = [...stringKeys, "gasPayment"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new BatonError("INVALID_STATE", "sponsor response contains unknown fields");
  const parsed = strings(Object.fromEntries(stringKeys.map((key) => [key, value[key]])), stringKeys);
  if (!Array.isArray(value.gasPayment) || value.gasPayment.length !== 1) throw new BatonError("INVALID_STATE", "sponsor response.gasPayment is invalid");
  const gasPayment = value.gasPayment.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new BatonError("INVALID_STATE", "sponsor response.gasPayment is invalid");
    const raw = entry as Record<string, unknown>;
    const payment = strings(raw, ["objectId", "version", "digest"]);
    return { objectId: payment.objectId!, version: payment.version!, digest: payment.digest! };
  });
  return { ...(parsed as unknown as Omit<SponsoredRegistrationEnvelope, "gasPayment">), gasPayment };
}

export async function registerProjectWithSponsor(input: {
  sponsorUrl: string;
  inviteToken: string;
  packageId: string;
  projectId: string;
  userKeypair: Ed25519Keypair;
}): Promise<RegistrationResult> {
  const base = validateSponsorUrl(input.sponsorUrl);
  const sender = input.userKeypair.toSuiAddress();
  const envelope = preparedEnvelope(await post(`${base}/v1/register/prepare`, {
    token: input.inviteToken,
    sender,
    projectId: input.projectId,
  }, 15_000));
  const bytes = await verifySponsoredRegistrationEnvelope({
    envelope,
    packageId: input.packageId,
    projectId: input.projectId,
    sender,
  });
  const { signature } = await input.userKeypair.signTransaction(bytes);
  const executed = strings(await post(`${base}/v1/register/execute`, {
    token: input.inviteToken,
    requestId: envelope.requestId,
    userSignature: signature,
  }, 60_000), ["digest", "projectObjectId", "ownerCapId"]);
  return executed as unknown as RegistrationResult;
}
