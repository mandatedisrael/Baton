import type { RemoteProjectConfig } from "../schema/project.ts";

export const TESTNET_RPC_URL = "https://fullnode.testnet.sui.io:443";

/** Mysten's verified decentralized Testnet Seal committee. */
export const TESTNET_SEAL: RemoteProjectConfig["seal"] = {
  threshold: 1,
  serverConfigs: [
    {
      objectId: "0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98",
      aggregatorUrl: "https://seal-aggregator-testnet.mystenlabs.com",
      weight: 1,
    },
  ],
};
