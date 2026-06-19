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

This verifies the path through project registration and client-side Seal encryption. Walrus upload, Sui manifest anchoring, and remote decryption are separate milestones and are not claimed here.
