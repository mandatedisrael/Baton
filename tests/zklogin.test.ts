import { test } from "node:test";
import assert from "node:assert/strict";
import { fromBase64 } from "@mysten/bcs";
import { parseZkLoginSignature } from "@mysten/sui/zklogin";

import {
  createEphemeralSession,
  createZkLoginSignature,
  signTransactionWithZkLogin,
  startZkLoginFlow,
  type ZkLoginSession,
} from "../src/chain/zklogin.ts";

const proofInputs = {
  proofPoints: {
    a: ["1", "2", "3"],
    b: [["1", "2"], ["3", "4"], ["5", "6"]],
    c: ["1", "2", "3"],
  },
  issBase64Details: { value: "", indexMod4: 0 },
  headerBase64: "",
  addressSeed: "1",
};

test("zkLogin OAuth uses the exact callback port that Baton listens on", async () => {
  const client = {
    async getLatestSuiSystemState() { return { epoch: "100" }; },
  };
  const started = await startZkLoginFlow(client as never, {
    clientId: "baton-test.apps.googleusercontent.com",
  });
  const authUrl = new URL(started.url);
  assert.equal(started.port, 51731);
  assert.equal(started.redirectUri, "http://localhost:51731/callback");
  assert.equal(authUrl.searchParams.get("redirect_uri"), started.redirectUri);
});

test("zkLogin wraps an intent-scoped ephemeral transaction signature", async () => {
  const { keypair } = createEphemeralSession();
  const serialized = await createZkLoginSignature({
    ephemeralKeypair: keypair,
    proofInputs,
    maxEpoch: 130,
    txBytes: new Uint8Array([1, 2, 3]),
  });
  const parsed = parseZkLoginSignature(fromBase64(serialized).slice(1));
  // A Sui serialized Ed25519 signature includes its scheme flag and public key,
  // so the embedded signature must be larger than a raw 64-byte Ed25519 value.
  assert.ok(parsed.userSignature.length > 64);
});

test("zkLogin refuses an expired session before requesting a proof", async () => {
  const { keypair, randomness } = createEphemeralSession();
  const session: ZkLoginSession = {
    scheme: "ZKLOGIN",
    provider: "google",
    address: "0x" + "1".repeat(64),
    userSalt: "1",
    ephemeralPrivateKey: keypair.getSecretKey(),
    maxEpoch: 100,
    randomness,
    lastJwt: "header.payload.signature",
  };
  const client = {
    async getLatestSuiSystemState() { return { epoch: "101" }; },
  };
  await assert.rejects(
    signTransactionWithZkLogin({
      session,
      client: client as never,
      transaction: new Uint8Array([1, 2, 3]),
      proverUrl: "https://prover.invalid",
    }),
    /session has expired/,
  );
});
