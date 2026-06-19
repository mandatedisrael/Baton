import { BatonError } from "../core/errors.js";
import { verifySponsoredRegistrationEnvelope } from "./sponsorship.js";
export function validateSponsorUrl(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
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
async function post(url, value, timeoutMs) {
    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(value),
            signal: AbortSignal.timeout(timeoutMs),
        });
    }
    catch (err) {
        throw new BatonError("IO_ERROR", `sponsor request failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    let parsed;
    try {
        parsed = await response.json();
    }
    catch (err) {
        throw new BatonError("IO_ERROR", "sponsor returned invalid JSON", { cause: err });
    }
    if (!response.ok) {
        const message = parsed && typeof parsed === "object" && "error" in parsed ? String(parsed.error) : `HTTP ${response.status}`;
        throw new BatonError("IO_ERROR", `sponsor refused registration: ${message}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new BatonError("IO_ERROR", "sponsor returned an invalid response");
    return parsed;
}
function strings(value, keys) {
    if (Object.keys(value).some((key) => !keys.includes(key)))
        throw new BatonError("INVALID_STATE", "sponsor response contains unknown fields");
    const output = {};
    for (const key of keys) {
        if (typeof value[key] !== "string" || value[key].length === 0)
            throw new BatonError("INVALID_STATE", `sponsor response.${key} is invalid`);
        output[key] = value[key];
    }
    return output;
}
export async function registerProjectWithSponsor(input) {
    const base = validateSponsorUrl(input.sponsorUrl);
    const sender = input.userKeypair.toSuiAddress();
    const prepared = strings(await post(`${base}/v1/register/prepare`, {
        token: input.inviteToken,
        sender,
        projectId: input.projectId,
    }, 15_000), ["requestId", "transactionBytes", "sponsor", "gasPrice", "gasBudget", "expirationEpoch", "expiresAt"]);
    const envelope = prepared;
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
    return executed;
}
//# sourceMappingURL=sponsor-client.js.map