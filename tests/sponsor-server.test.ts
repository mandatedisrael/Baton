import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { normalizeSuiObjectId } from "@mysten/sui/utils";
import { registerProjectWithSponsor, validateSponsorUrl } from "../src/chain/sponsor-client.ts";
import { sponsoredTransactionDigest } from "../src/chain/sponsorship.ts";
import { createSponsorServer } from "../src/sponsor/server.ts";
import { issueSponsorInvite, issueSponsorInviteDetails, listSponsorInvites } from "../src/sponsor/state.ts";

const PACKAGE = normalizeSuiObjectId("0x1234");
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "baton-sponsor-server-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("sponsor URL requires TLS except on loopback", () => {
  assert.equal(validateSponsorUrl("http://127.0.0.1:8787/"), "http://127.0.0.1:8787");
  assert.equal(validateSponsorUrl("https://sponsor.example/"), "https://sponsor.example");
  assert.throws(() => validateSponsorUrl("http://sponsor.example"), /must use HTTPS/);
});

test("one-use invitation sponsors only the exact user registration", async () => {
  const sponsor = new Ed25519Keypair();
  const user = new Ed25519Keypair();
  const statePath = join(root, "sponsor.json");
  const token = issueSponsorInvite(statePath, new Date(), 1);
  let executions = 0;
  const client = {
    async getLatestSuiSystemState() { return { epoch: "1200" }; },
    async getReferenceGasPrice() { return 1000n; },
    async getCoins() {
      return {
        data: [{ coinObjectId: "0x99", version: "1", digest: "2E3Wu14rQZ4rqfSi8Ve1arY4HWd1wv2cZmJbdatMgv2p", balance: "100000000" }],
        hasNextPage: false,
        nextCursor: null,
      };
    },
    async executeTransactionBlock(input: { signature: string[] }) {
      executions += 1;
      assert.equal(input.signature.length, 2);
      return {
        digest: "sponsored-digest",
        effects: { status: { status: "success" } },
        objectChanges: [
          {
            type: "created",
            sender: user.toSuiAddress(),
            owner: { Shared: { initial_shared_version: 1 } },
            objectType: `${PACKAGE}::memory::ProjectMemory`,
            objectId: "0xproject",
            version: "1",
            digest: "project-digest",
          },
          {
            type: "created",
            sender: user.toSuiAddress(),
            owner: { AddressOwner: user.toSuiAddress() },
            objectType: `${PACKAGE}::memory::OwnerCap`,
            objectId: "0xcap",
            version: "1",
            digest: "cap-digest",
          },
        ],
      };
    },
    async waitForTransaction() {},
  };
  const server = createSponsorServer({
    client: client as never,
    sponsorKeypair: sponsor,
    statePath,
    policyPackageId: PACKAGE,
    typePackageId: PACKAGE,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const sponsorUrl = `http://127.0.0.1:${address.port}`;
    const result = await registerProjectWithSponsor({
      sponsorUrl,
      inviteToken: token,
      packageId: PACKAGE,
      projectId: "project-1",
      userKeypair: user,
    });
    assert.deepEqual(result, {
      digest: "sponsored-digest",
      projectObjectId: "0xproject",
      ownerCapId: "0xcap",
    });
    const retry = await registerProjectWithSponsor({
      sponsorUrl,
      inviteToken: token,
      packageId: PACKAGE,
      projectId: "project-1",
      userKeypair: user,
    });
    assert.deepEqual(retry, result);
    assert.equal(executions, 1);

    const ready = await fetch(`${sponsorUrl}/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json() as { ok: boolean }).ok, true);
    const operationalMetrics = await (await fetch(`${sponsorUrl}/metrics`)).text();
    assert.match(operationalMetrics, /baton_sponsor_prepared_total 2/);
    assert.match(operationalMetrics, /baton_sponsor_completed_total 2/);

    const other = new Ed25519Keypair();
    await assert.rejects(
      registerProjectWithSponsor({
        sponsorUrl,
        inviteToken: token,
        packageId: PACKAGE,
        projectId: "project-2",
        userKeypair: other,
      }),
      /reserved for another registration/,
    );

    const secondToken = issueSponsorInvite(statePath, new Date(), 1);
    const limitedServer = createSponsorServer({
      client: client as never,
      sponsorKeypair: sponsor,
      statePath,
      policyPackageId: PACKAGE,
      typePackageId: PACKAGE,
      maxDailyRegistrations: 1,
    });
    await new Promise<void>((resolve, reject) => {
      limitedServer.once("error", reject);
      limitedServer.listen(0, "127.0.0.1", resolve);
    });
    try {
      const limitedAddress = limitedServer.address();
      assert(limitedAddress && typeof limitedAddress === "object");
      await assert.rejects(
        registerProjectWithSponsor({
          sponsorUrl: `http://127.0.0.1:${limitedAddress.port}`,
          inviteToken: secondToken,
          packageId: PACKAGE,
          projectId: "project-2",
          userKeypair: other,
        }),
        /daily registration limit reached/,
      );
    } finally {
      await new Promise<void>((resolve) => limitedServer.close(() => resolve()));
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("trusted-proxy client addresses receive independent registration limits", async () => {
  const sponsor = new Ed25519Keypair();
  const statePath = join(root, "sponsor.json");
  const server = createSponsorServer({
    client: {} as never,
    sponsorKeypair: sponsor,
    statePath,
    policyPackageId: PACKAGE,
    typePackageId: PACKAGE,
    trustProxy: true,
    rateLimitPerMinute: 1,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/v1/register/prepare`;
    const request = (ip: string) => fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ token: "x".repeat(43), sender: "0x2", projectId: "project-1" }),
    });
    assert.equal((await request("203.0.113.10")).status, 404);
    assert.equal((await request("203.0.113.10")).status, 429);
    assert.equal((await request("203.0.113.11")).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/health`)).status, 200);
    const operationalMetrics = await (await fetch(`http://127.0.0.1:${address.port}/metrics`)).text();
    assert.match(operationalMetrics, /baton_sponsor_rate_limited_total 1/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("readiness fails closed when no unreserved gas coin is available", async () => {
  const sponsor = new Ed25519Keypair();
  const server = createSponsorServer({
    client: {
      async getLatestSuiSystemState() { return { epoch: "1200" }; },
      async getCoins() { return { data: [], hasNextPage: false, nextCursor: null }; },
    } as never,
    sponsorKeypair: sponsor,
    statePath: join(root, "sponsor.json"),
    policyPackageId: PACKAGE,
    typePackageId: PACKAGE,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const ready = await fetch(`${base}/ready`);
    assert.equal(ready.status, 503);
    assert.match(await ready.text(), /no unreserved sponsor gas coin is ready/);
    assert.match(await (await fetch(`${base}/metrics`)).text(), /baton_sponsor_readiness_failures_total 1/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("readiness scans paginated sponsor coins and metrics expose bounded gauges", async () => {
  const sponsor = new Ed25519Keypair();
  let pages = 0;
  const server = createSponsorServer({
    client: {
      async getLatestSuiSystemState() { return { epoch: "1200" }; },
      async getCoins(input: { cursor?: string | null }) {
        pages += 1;
        if (!input.cursor) return { data: [], hasNextPage: true, nextCursor: "page-2" };
        return {
          data: [{ coinObjectId: "0x99", version: "1", digest: "2E3Wu14rQZ4rqfSi8Ve1arY4HWd1wv2cZmJbdatMgv2p", balance: "100000000" }],
          hasNextPage: false,
          nextCursor: null,
        };
      },
    } as never,
    sponsorKeypair: sponsor,
    statePath: join(root, "sponsor.json"),
    policyPackageId: PACKAGE,
    typePackageId: PACKAGE,
    maxDailyRegistrations: 7,
    maxActiveReservations: 3,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${base}/ready`)).status, 200);
    assert.equal(pages, 2);
    const operationalMetrics = await (await fetch(`${base}/metrics`)).text();
    assert.match(operationalMetrics, /baton_sponsor_completed_today 0/);
    assert.match(operationalMetrics, /baton_sponsor_active_reservations 0/);
    assert.match(operationalMetrics, /baton_sponsor_daily_limit 7/);
    assert.match(operationalMetrics, /baton_sponsor_active_limit 3/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("recipient-bound invitations are refused before gas metadata is fetched", async () => {
  const sponsor = new Ed25519Keypair();
  const intended = new Ed25519Keypair();
  const attacker = new Ed25519Keypair();
  const statePath = join(root, "sponsor.json");
  const { token } = issueSponsorInviteDetails(statePath, new Date(), 1, {
    recipient: intended.toSuiAddress(),
    projectId: "project-1",
  });
  let rpcCalls = 0;
  const client = {
    async getLatestSuiSystemState() { rpcCalls += 1; return { epoch: "1200" }; },
  };
  const server = createSponsorServer({
    client: client as never,
    sponsorKeypair: sponsor,
    statePath,
    policyPackageId: PACKAGE,
    typePackageId: PACKAGE,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    await assert.rejects(
      registerProjectWithSponsor({
        sponsorUrl: `http://127.0.0.1:${address.port}`,
        inviteToken: token,
        packageId: PACKAGE,
        projectId: "project-1",
        userKeypair: attacker,
      }),
      /bound to another recipient/,
    );
    assert.equal(rpcCalls, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a restart reconciles chain success after local completion was interrupted", async () => {
  const sponsor = new Ed25519Keypair();
  const user = new Ed25519Keypair();
  const statePath = join(root, "sponsor.json");
  const token = issueSponsorInvite(statePath, new Date(), 1);
  let executions = 0;
  let lookups = 0;
  let chainResponse: Record<string, unknown> | undefined;
  const client = {
    async getLatestSuiSystemState() { return { epoch: "1200" }; },
    async getReferenceGasPrice() { return 1000n; },
    async getCoins() {
      return {
        data: [{ coinObjectId: "0x99", version: "1", digest: "2E3Wu14rQZ4rqfSi8Ve1arY4HWd1wv2cZmJbdatMgv2p", balance: "100000000" }],
        hasNextPage: false,
        nextCursor: null,
      };
    },
    async executeTransactionBlock(input: { transactionBlock: Uint8Array }) {
      executions += 1;
      const digest = await sponsoredTransactionDigest(input.transactionBlock);
      chainResponse = {
        digest,
        effects: { status: { status: "success" } },
        objectChanges: [
          { type: "created", objectType: `${PACKAGE}::memory::ProjectMemory`, objectId: "0xproject" },
          { type: "created", objectType: `${PACKAGE}::memory::OwnerCap`, objectId: "0xcap" },
        ],
      };
      return chainResponse;
    },
    async waitForTransaction() { throw new Error("simulated indexing interruption"); },
    async getTransactionBlock() {
      lookups += 1;
      if (!chainResponse) throw new Error("not found");
      return chainResponse;
    },
  };
  const start = () => {
    const server = createSponsorServer({
      client: client as never,
      sponsorKeypair: sponsor,
      statePath,
      policyPackageId: PACKAGE,
      typePackageId: PACKAGE,
    });
    return new Promise<{ server: typeof server; url: string }>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        assert(address && typeof address === "object");
        resolve({ server, url: `http://127.0.0.1:${address.port}` });
      });
    });
  };

  const first = await start();
  await assert.rejects(
    registerProjectWithSponsor({ sponsorUrl: first.url, inviteToken: token, packageId: PACKAGE, projectId: "project-1", userKeypair: user }),
    /simulated indexing interruption/,
  );
  await new Promise<void>((resolve) => first.server.close(() => resolve()));
  assert.equal(executions, 1);
  assert.equal(listSponsorInvites(statePath)[0]?.status, "submitted");

  const restarted = await start();
  try {
    const result = await registerProjectWithSponsor({
      sponsorUrl: restarted.url,
      inviteToken: token,
      packageId: PACKAGE,
      projectId: "project-1",
      userKeypair: user,
    });
    assert.equal(result.projectObjectId, "0xproject");
    assert.equal(executions, 1);
    assert.equal(lookups, 1);
    assert.equal(listSponsorInvites(statePath)[0]?.status, "used");
    assert.match(await (await fetch(`${restarted.url}/metrics`)).text(), /baton_sponsor_reconciled_total 1/);
  } finally {
    await new Promise<void>((resolve) => restarted.server.close(() => resolve()));
  }
});
