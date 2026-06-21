import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { exec } from "node:child_process";
import { URL } from "node:url";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { PublicKey } from "@mysten/sui/cryptography";
import {
  generateNonce,
  generateRandomness,
  getExtendedEphemeralPublicKey,
  jwtToAddress,
} from "@mysten/sui/zklogin";
import { getZkLoginSignature } from "@mysten/sui/zklogin";
import type { ZkLoginSignatureInputs } from "@mysten/sui/zklogin";

import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";

import { BatonError } from "../core/errors.ts";

export type ZkProvider = "google";

export interface ZkLoginSession {
  scheme: "ZKLOGIN";
  provider: ZkProvider;
  address: string;
  userSalt: string;
  // Ephemeral session (valid until maxEpoch)
  ephemeralPrivateKey: string; // base64 secret key for Ed25519Keypair
  maxEpoch: number;
  randomness: string;
  lastJwt?: string; // for re-derivation / debugging
}

export interface ZkLoginConfig {
  provider?: ZkProvider;
  clientId?: string;
  redirectPort?: number;
  proverUrl?: string;
  saltUrl?: string;
  loginTimeoutMs?: number;
  maxEpochBuffer?: number;
}

const DEFAULT_PROVER_URL = "https://prover-dev.mystenlabs.com/v1";
const DEFAULT_SALT_URL = "https://salt.api.mystenlabs.com/get_salt";
const DEFAULT_LOGIN_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_EPOCH_BUFFER = 30; // ~30 epochs buffer (generous for Testnet/Mainnet)
const DEFAULT_REDIRECT_PORT = 51731;

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

function getEnvClientId(provider: ZkProvider): string | undefined {
  if (provider === "google") {
    return process.env.BATON_GOOGLE_CLIENT_ID;
  }
  return undefined;
}

function launchBrowser(url: string): void {
  const platform = process.platform;
  let command: string;
  if (platform === "darwin") {
    command = `open "${url}"`;
  } else if (platform === "win32") {
    command = `start "" "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }
  exec(command, (err) => {
    if (err) {
      // Non-fatal: user can copy the URL manually
      console.error(`Failed to auto-open browser. Please open this URL manually:\n${url}`);
    }
  });
}

/**
 * Starts a temporary localhost server that captures the id_token from the OAuth redirect.
 * Serves a small page that extracts the fragment and POSTs it back.
 * Returns the JWT and shuts the server down.
 */
async function captureIdToken(
  port: number,
  expectedState: string,
  timeoutMs: number
): Promise<{ jwt: string; fullRedirectUrl: string }> {
  return new Promise((resolve, reject) => {
    let server: Server | null = null;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new BatonError("IO_ERROR", `OAuth login timed out after ${Math.round(timeoutMs / 1000)}s. Run the command again.`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      if (server) {
        server.close(() => {});
        server = null;
      }
    }

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (!req.url) {
        res.writeHead(400);
        res.end("Bad request");
        return;
      }

      const reqUrl = new URL(req.url, `http://localhost:${port}`);

      // Initial redirect from provider usually hits with # in fragment (not sent to server).
      // We serve an auto-extractor page.
      if (reqUrl.pathname === "/callback" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!doctype html>
          <html>
            <head><title>Baton zkLogin</title></head>
            <body style="font-family: system-ui; padding: 2rem;">
              <h1>Completing login…</h1>
              <p>If this page does not close automatically, you may close it.</p>
              <script>
                (function() {
                  const hash = window.location.hash.substring(1);
                  if (!hash) {
                    document.body.innerHTML = '<p>No token received. Close this tab and try again.</p>';
                    return;
                  }
                  const params = new URLSearchParams(hash);
                  const idToken = params.get('id_token');
                  const state = params.get('state');
                  fetch('/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id_token: idToken, state })
                  }).catch(() => {});
                  // Best effort close
                  setTimeout(() => window.close(), 800);
                })();
              </script>
            </body>
          </html>
        `);
        return;
      }

      // The JS on the page POSTs here with the token
      if (reqUrl.pathname === "/token" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const data = JSON.parse(body || "{}");
            const idToken = data.id_token;
            const receivedState = data.state;

            if (!idToken || typeof idToken !== "string") {
              res.writeHead(400);
              res.end("Missing id_token");
              return;
            }
            if (receivedState !== expectedState) {
              res.writeHead(400);
              res.end("State mismatch");
              cleanup();
              reject(new BatonError("INVALID_STATE", "OAuth state mismatch — possible CSRF or corrupted redirect."));
              return;
            }

            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("OK");

            cleanup();
            resolve({ jwt: idToken, fullRedirectUrl: `http://localhost:${port}/callback#${hashFromData(data)}` });
          } catch (e) {
            res.writeHead(400);
            res.end("Bad payload");
            cleanup();
            reject(new BatonError("INVALID_STATE", "Failed to parse OAuth token payload"));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    server.on("error", (err) => {
      cleanup();
      reject(new BatonError("IO_ERROR", "Failed to start local OAuth callback server", { cause: err }));
    });

    // Listen on specific port (or let OS pick if 0)
    server.listen(port, "127.0.0.1", () => {
      // ready
    });
  });
}

function hashFromData(data: any): string {
  // For logging / debugging only
  return new URLSearchParams({ id_token: data.id_token || "", state: data.state || "" }).toString();
}

export async function getCurrentEpoch(client: SuiJsonRpcClient): Promise<number> {
  try {
    const sys = await client.getLatestSuiSystemState();
    return Number(sys.epoch);
  } catch (err) {
    // Fallback — caller can supply maxEpoch
    throw new BatonError("IO_ERROR", "Could not fetch current Sui epoch for zkLogin nonce", { cause: err });
  }
}

export async function computeMaxEpoch(client: SuiJsonRpcClient, buffer = DEFAULT_MAX_EPOCH_BUFFER): Promise<number> {
  const current = await getCurrentEpoch(client);
  return current + buffer;
}

/** Generate a fresh ephemeral keypair + randomness for a zkLogin session. */
export function createEphemeralSession(): { keypair: Ed25519Keypair; randomness: string } {
  const keypair = new Ed25519Keypair();
  const randomness = generateRandomness();
  return { keypair, randomness };
}

/** Build the Google OAuth URL (response_type=id_token implicit flow). */
export function buildGoogleOAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  nonce: string;
  state: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("response_type", "id_token");
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("scope", "openid");
  url.searchParams.set("nonce", opts.nonce);
  url.searchParams.set("state", opts.state);
  return url.toString();
}

export interface StartZkLoginResult {
  url: string;
  state: string;
  nonce: string;
  randomness: string;
  maxEpoch: number;
  ephemeralKeypair: Ed25519Keypair;
  redirectUri: string;
  port: number;
}

/**
 * Prepares everything needed for a zkLogin and returns the URL the user must visit.
 * Does NOT block on the browser — call captureAfterRedirect next.
 */
export async function startZkLoginFlow(
  client: SuiJsonRpcClient,
  config: ZkLoginConfig = {}
): Promise<StartZkLoginResult> {
  const provider: ZkProvider = config.provider ?? "google";
  const clientId = config.clientId ?? getEnvClientId(provider);

  if (!clientId || clientId.includes("YOUR_") || clientId.length < 10) {
    throw new BatonError(
      "INVALID_STATE",
      "A Google OAuth client ID is required for zkLogin.\n" +
        "1. Go to https://console.cloud.google.com/apis/credentials\n" +
        "2. Create OAuth 2.0 Client ID (Web application)\n" +
        `3. Add http://localhost:${DEFAULT_REDIRECT_PORT}/callback to Authorized redirect URIs\n` +
        "4. Set BATON_GOOGLE_CLIENT_ID=your-client-id or pass --client-id\n"
    );
  }

  // OAuth providers require the redirect URI to match exactly. Use a stable
  // default rather than advertising port 0 and listening somewhere else.
  const port = config.redirectPort && config.redirectPort > 0
    ? config.redirectPort
    : DEFAULT_REDIRECT_PORT;
  const maxEpoch = config.maxEpochBuffer ? (await getCurrentEpoch(client)) + config.maxEpochBuffer : await computeMaxEpoch(client);

  const { keypair: ephemeralKeypair, randomness } = createEphemeralSession();
  const nonce = generateNonce(ephemeralKeypair.getPublicKey(), maxEpoch, randomness);
  const state = randomUUID();

  // Use a fixed path that our server understands
  const redirectUri = `http://localhost:${port}/callback`;

  const url = buildGoogleOAuthUrl({
    clientId,
    redirectUri,
    nonce,
    state,
  });

  return {
    url,
    state,
    nonce,
    randomness,
    maxEpoch,
    ephemeralKeypair,
    redirectUri,
    port,
  };
}

/**
 * Opens the browser (or prints URL) and captures the id_token.
 * Returns the raw JWT + derived info.
 */
export async function performZkLogin(
  client: SuiJsonRpcClient,
  config: ZkLoginConfig = {}
): Promise<{ session: ZkLoginSession; jwt: string }> {
  const provider: ZkProvider = config.provider ?? "google";
  const loginTimeout = config.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT;

  const prep = await startZkLoginFlow(client, config);

  const state = prep.state;
  const randomness = prep.randomness;
  const ephemeralKeypair = prep.ephemeralKeypair;
  const maxEpoch = prep.maxEpoch;
  const finalUrl = prep.url;

  // Begin listening before the browser can redirect back to localhost.
  const capture = captureIdToken(prep.port, state, loginTimeout);

  console.log("\nOpening browser for Google login...");
  console.log("If it does not open, visit this URL:\n" + finalUrl + "\n");

  launchBrowser(finalUrl);

  // Capture
  const { jwt } = await capture;

  // Now derive address + salt
  const salt = await fetchSalt(jwt, config.saltUrl);

  const address = jwtToAddress(jwt, salt, false);

  // Build the durable session record
  const session: ZkLoginSession = {
    scheme: "ZKLOGIN",
    provider,
    address,
    userSalt: salt,
    ephemeralPrivateKey: ephemeralKeypair.getSecretKey(), // keep as string (the SDK accepts it for fromSecretKey)
    maxEpoch,
    randomness,
    lastJwt: jwt,
  };

  return { session, jwt };
}

/** Fetch salt. Tries Mysten service first, falls back to error with guidance. */
export async function fetchSalt(jwt: string, saltUrl?: string): Promise<string> {
  const url = saltUrl ?? DEFAULT_SALT_URL;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: jwt }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Salt service returned ${res.status}: ${text}`);
    }

    const json = (await res.json()) as { salt?: string; user_salt?: string };
    const salt = json.salt ?? json.user_salt;

    if (!salt || typeof salt !== "string") {
      throw new Error("Salt service did not return a salt field");
    }
    return salt;
  } catch (err) {
    throw new BatonError(
      "IO_ERROR",
      `Failed to obtain user salt from ${url}. You can generate your own salt and pass it explicitly in a future version, or try again. Cause: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
}

/** Call the proving service and return ready-to-use inputs. */
export async function fetchZkProof(params: {
  jwt: string;
  extendedEphemeralPublicKey: string;
  maxEpoch: number | string;
  jwtRandomness: string;
  userSalt: string;
  keyClaimName?: string;
  proverUrl?: string;
}): Promise<ZkLoginSignatureInputs> {
  const proverUrl = params.proverUrl ?? DEFAULT_PROVER_URL;

  const body = {
    jwt: params.jwt,
    extendedEphemeralPublicKey: params.extendedEphemeralPublicKey,
    maxEpoch: String(params.maxEpoch),
    jwtRandomness: params.jwtRandomness,
    salt: params.userSalt,
    keyClaimName: params.keyClaimName ?? "sub",
  };

  const res = await fetch(proverUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new BatonError("IO_ERROR", `Prover at ${proverUrl} failed (${res.status}): ${text}`);
  }

  const proof = (await res.json()) as ZkLoginSignatureInputs;

  // Basic shape validation
  if (!proof || !proof.proofPoints || !proof.issBase64Details || !proof.addressSeed) {
    throw new BatonError("INVALID_STATE", "Prover response did not contain expected ZkLoginSignatureInputs");
  }
  return proof;
}

/**
 * Produces the final zkLogin signature string that can be passed to Sui.
 * The ephemeral keypair must be the same one used to create the nonce for this JWT.
 */
export async function createZkLoginSignature(params: {
  ephemeralKeypair: Ed25519Keypair;
  proofInputs: ZkLoginSignatureInputs;
  maxEpoch: number;
  txBytes?: Uint8Array; // if you already have bytes
  intentScope?: "TransactionData" | "PersonalMessage"; // default TransactionData
}): Promise<string> {
  const { ephemeralKeypair, proofInputs, maxEpoch } = params;

  // We need the user signature = ephemeral signature over the tx (or personal message)
  // For full signing flow we usually build the signature over the *intent* bytes, but the SDK getZkLoginSignature expects the raw userSignature bytes that the ephemeral produced for the transaction intent.

  // Common pattern: sign the raw transaction bytes (the caller usually does tx.build() first).
  // The userSignature passed here is the signature produced by the ephemeral over the data.

  // If txBytes provided, sign them.
  let userSignature: string | Uint8Array;

  if (params.txBytes) {
    // zkLogin embeds the complete intent-scoped Sui signature, not a raw
    // 64-byte Ed25519 signature.
    userSignature = (await ephemeralKeypair.signTransaction(params.txBytes)).signature;
  } else {
    // Caller will combine later. We still need a signature.
    // For flexibility, if no bytes we throw — production code should always pass bytes.
    throw new BatonError("INVALID_STATE", "createZkLoginSignature requires txBytes for the ephemeral signature");
  }

  return getZkLoginSignature({
    inputs: proofInputs,
    maxEpoch,
    userSignature,
  });
}

/**
 * High-level helper: given a ZkLoginSession and a built Transaction (or bytes),
 * return a ready-to-use base64 zkLogin signature.
 *
 * This is the main entry point used by the rest of Baton when the identity is zkLogin.
 */
export async function signTransactionWithZkLogin(params: {
  session: ZkLoginSession;
  client: SuiJsonRpcClient;
  transaction: Transaction | Uint8Array;
  proverUrl?: string;
}): Promise<string> {
  const { session, client, transaction, proverUrl } = params;

  if (session.scheme !== "ZKLOGIN") {
    throw new BatonError("INVALID_STATE", "signTransactionWithZkLogin called with non-zk session");
  }

  const ephKeypair = Ed25519Keypair.fromSecretKey(session.ephemeralPrivateKey);

  // Determine maxEpoch — we can re-use the one in the session if still valid
  const maxEpoch = session.maxEpoch;
  let currentEpoch: number | null = null;
  try {
    currentEpoch = await getCurrentEpoch(client);
  } catch {
    // A temporary RPC failure should not prevent an otherwise valid stored
    // session from attempting a transaction; Sui still verifies maxEpoch.
  }
  if (currentEpoch !== null && currentEpoch > maxEpoch) {
    throw new BatonError("INVALID_STATE", "zkLogin ephemeral session has expired. Please run `baton login` again.");
  }

  // Build bytes if Transaction was passed
  let txBytes: Uint8Array;
  if (transaction instanceof Uint8Array) {
    txBytes = transaction;
  } else {
    txBytes = await transaction.build({ client });
  }

  // Make sure we have a fresh proof for this exact session
  const extendedPub = getExtendedEphemeralPublicKey(ephKeypair.getPublicKey());

  if (!session.lastJwt) {
    throw new BatonError("INVALID_STATE", "zkLogin session has no JWT. Please run `baton login --zk` again.");
  }
  const proofInputs = await fetchZkProof({
    jwt: session.lastJwt,
    extendedEphemeralPublicKey: extendedPub,
    maxEpoch,
    jwtRandomness: session.randomness,
    userSalt: session.userSalt,
    proverUrl,
  });

  // Ephemeral signs the transaction bytes
  const ephemeralSignature = (await ephKeypair.signTransaction(txBytes)).signature;

  const zkSig = getZkLoginSignature({
    inputs: proofInputs,
    maxEpoch,
    userSignature: ephemeralSignature,
  });

  return zkSig;
}

/** Convenience: load a session back into a usable ephemeral keypair */
export function loadEphemeralFromSession(session: ZkLoginSession): Ed25519Keypair {
  return Ed25519Keypair.fromSecretKey(session.ephemeralPrivateKey);
}
