import type { RemoteProjectConfig } from "../schema/project.ts";

export const TESTNET_RPC_URL = "https://fullnode.testnet.sui.io:443";
export const BATON_CORE_TESTNET_PACKAGE =
  "0xd92b150b57ef31defb5b9ddd5a155102efe1c34058a19fdb30cbe4f4a46aa3e3";
export const BATON_CORE_TESTNET_ORIGINAL_PACKAGE =
  "0x74020a1a00779799768a5145bd2734f3e724d2826c5e8d610f345c2c036b090e";
export const BATON_CORE_TESTNET_PUBLISH_TX = "FzC3a2mWPB3T7F1iE43rDXgoooNK2M719sGkr1DjAeZy";

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

/** Official Testnet upload relay with bounded SUI tip exposure. */
export const TESTNET_WALRUS: RemoteProjectConfig["walrus"] = {
  epochs: 3,
  deletable: false,
  uploadRelayUrl: "https://upload-relay.testnet.walrus.space",
  aggregatorUrl: "https://aggregator.walrus-testnet.walrus.space",
  maxTipMist: 1_000,
};
