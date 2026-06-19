import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { loadIdentity } from "../../chain/identity.js";
import { BATON_CORE_TESTNET_PACKAGE, BATON_CORE_TESTNET_ORIGINAL_PACKAGE, TESTNET_RPC_URL, TESTNET_SEAL, TESTNET_WALRUS, } from "../../chain/networks.js";
import { registerProjectOnSui } from "../../chain/registration.js";
import { registerProjectWithSponsor } from "../../chain/sponsor-client.js";
import { BatonError } from "../../core/errors.js";
import { ProjectStore } from "../../store/project.js";
import { ok } from "../output.js";
export async function runRegister(cwd, options = {}) {
    const store = ProjectStore.open(cwd);
    const config = store.config();
    if (config.remote) {
        throw new BatonError("ALREADY_INITIALIZED", `project is already registered (${config.remote.projectObjectId})`);
    }
    const { record, keypair } = loadIdentity(options.identityPath);
    const rpcUrl = options.rpcUrl ?? TESTNET_RPC_URL;
    const packageId = options.packageId ?? BATON_CORE_TESTNET_PACKAGE;
    const client = new SuiJsonRpcClient({ network: "testnet", url: rpcUrl });
    if ((options.sponsorUrl === undefined) !== (options.inviteToken === undefined)) {
        throw new BatonError("INVALID_STATE", "sponsored registration requires both sponsor URL and invitation token");
    }
    if (!options.sponsorUrl) {
        let balance;
        try {
            balance = await client.getBalance({ owner: record.address });
        }
        catch (err) {
            throw new BatonError("IO_ERROR", `could not reach Sui Testnet at ${rpcUrl}`, { cause: err });
        }
        if (BigInt(balance.totalBalance) === 0n) {
            throw new BatonError("INVALID_STATE", `Baton identity ${record.address} needs Testnet SUI — run \`baton faucet\` or use a sponsor invitation`);
        }
    }
    const registeredAt = new Date().toISOString();
    const result = options.sponsorUrl
        ? await registerProjectWithSponsor({
            sponsorUrl: options.sponsorUrl,
            inviteToken: options.inviteToken,
            packageId,
            projectId: config.projectId,
            userKeypair: keypair,
        })
        : await registerProjectOnSui({
            client,
            keypair,
            packageId,
            typePackageId: packageId === BATON_CORE_TESTNET_PACKAGE ? BATON_CORE_TESTNET_ORIGINAL_PACKAGE : packageId,
            projectId: config.projectId,
        });
    store.setRemoteConfig({
        network: "testnet",
        rpcUrl,
        packageId: packageId === BATON_CORE_TESTNET_PACKAGE ? BATON_CORE_TESTNET_ORIGINAL_PACKAGE : packageId,
        policyPackageId: packageId,
        projectObjectId: result.projectObjectId,
        authority: { kind: "owner", capId: result.ownerCapId },
        registrationTx: result.digest,
        registeredAt,
        seal: TESTNET_SEAL,
        walrus: TESTNET_WALRUS,
    });
    ok(`project registered and verified${options.sponsorUrl ? " with sponsored gas" : ""}: ${result.projectObjectId}`);
}
//# sourceMappingURL=register.js.map