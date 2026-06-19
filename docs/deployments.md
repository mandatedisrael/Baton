# Baton deployments

This file records deployments that were executed and verified. It is not a roadmap.

## Sui Testnet

| Item | Value |
|---|---|
| Network | Sui Testnet |
| `baton_core` package | `0x74020a1a00779799768a5145bd2734f3e724d2826c5e8d610f345c2c036b090e` |
| Publish transaction | `7LcCCbj38X9zDiv5GaAkprQbFa2vNGEC2gnRZzKG8tzh` |
| Upgrade capability | `0x2d63f70d2c4fca779708e26550d70b32b968001aab98489e3f2ef67277953c42` |
| Sui toolchain | `1.73.0` |
| Move edition | `2024` |
| Published | 2026-06-19 |

The package was built with `sui move build`, passed the full Move test suite, and was published without dependency-verification bypasses.

## End-to-end registration evidence

A clean temporary Baton project was initialized and registered using the public CLI flow and a newly generated Baton Ed25519 identity.

| Item | Value |
|---|---|
| `ProjectMemory` | `0x8cd2c392978b8e7ee1e7a602d3a24ae0cab0d455d5feb93b3b9784f8ea2bfc01` |
| Registration transaction | `2WqF48g6GPvAaWnGqEumJFMLMbmJDK3hB5577wbRz2QX` |
| Owner identity | `0x6885ce4d049be8fe3dddc8f3bc8abf0b6d627657cc397005f3f5aa7ada289fab` |

The shared object was read back from Testnet and verified as `baton_core::memory::ProjectMemory` with contract version `1` and the expected owner.

## Seal encryption evidence

The registered project passed a local baton and ran `baton queue encrypt` against Mysten's verified decentralized Testnet Seal committee. Seal returned a real encrypted object; Baton persisted it, re-hashed it, and reported the queue as `1 encrypted · 0/1 uploaded`.

This first run verified project registration and client-side Seal encryption. The separate publication run below verifies Walrus upload and Sui manifest anchoring; remote decryption is not yet claimed.

## End-to-end publication evidence

On 2026-06-19, a second clean temporary project ran the public CLI path `init → register → pass → publish` with a newly sealed baton and the protected Baton identity.

| Item | Value |
|---|---|
| Storage funding transaction | `AEZJA7tV9PoJanKksmmvPrLY4ga6vQ342c3Na2uogN8X` |
| `ProjectMemory` | `0xa0dd123b2ec564d7502688f751f360e9ef3f7d18f4cd73a6e671afdf3c0acaa4` |
| Registration transaction | `Axxt1gc3SiTev9Xo7owJgknmbGSs32tyytEKpf8cKmx4` |
| Baton content hash | `63d1d21152a2280cff510906dd9ffeadc6dae64ad99eef4f40979ed8ec8d4e76` |
| Walrus blob ID | `IxAzdh40gIAqQB8g9_DG7eT6dQcLjHIUXykzIvUoYFM` |
| Encrypted blob SHA-256 | `b0f74583784fc0ff3357d4f906e659bec0e0da9b2dbe228ac33d3895e9f5d303` |
| Walrus registration transaction | `HV5w4pnNN46r9yC1etgoK7w1e3n7PQtFcraVp5UVVPGQ` |
| Manifest anchor transaction | `Do3uUJfLgEjNpB9mTvjsjikQxCGQfnVhWts4TzRZ55fv` |

The ciphertext was subsequently fetched from the public Testnet Walrus aggregator and independently hashed to the recorded encrypted SHA-256 value. The `HandoffManifest` dynamic field was then fetched from Sui and verified to contain the same baton hash and Walrus blob ID; its `previousTransaction` matched the recorded anchor transaction.

This proves the production write path through official Testnet contracts and services. Remote Seal decryption and sharing/revocation UX remain future milestones and are not claimed here.
