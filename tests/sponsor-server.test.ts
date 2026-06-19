import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { normalizeSuiObjectId } from "@mysten/sui/utils";
import { registerProjectWithSponsor, validateSponsorUrl } from "../src/chain/sponsor-client.ts";
import { createSponsorServer } from "../src/sponsor/server.ts";
import { issueSponsorInvite } from "../src/sponsor/state.ts";

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
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
