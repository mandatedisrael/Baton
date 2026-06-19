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

This proves the production write path through official Testnet contracts and services. The separate recovery run below verifies owner decryption; sharing and revocation remain future milestones.

## Remote recovery evidence

The owner read path was verified on 2026-06-19 with a new two-blob baton containing both a canonical handoff and a transcript attachment. It was published after correcting the Seal policy identity so every payload is authorized by its anchored baton while remaining individually bound by authenticated metadata and plaintext hashes.

| Item | Value |
|---|---|
| Baton content hash | `a219c88218a7145ff7bec63cfa6b9376aa065af3d0adf30c9073ea93311a4316` |
| Handoff Walrus blob | `gvcgNxS2Ao8njo91D2ka0868_-FBF6shkYPQorzSjMo` |
| Handoff ciphertext SHA-256 | `6fc681ee7b68566fd7a35e723f56acc81ad4ced7ad52d4163b5bc696e187148a` |
| Attachment content hash | `936615e1ee818883fec28461aef0e956a74c445615dc2c8b61f53ef269b18d24` |
| Attachment Walrus blob | `GIW_48Yts9PmffPgt86x9NcbSI8EZWoDYy4gIKYDV4M` |
| Attachment ciphertext SHA-256 | `71fa648a3cf7716829ab0bcf4d573e95fe60c9545a9c42470e0625c0881be40c` |
| Manifest anchor transaction | `H2uSM8e1BdBrwDRG9xXPsm5T9M3qkug47CgFGBvKGNX2` |

A clean Baton directory was created with only the registered project's public network configuration and head content ID—no handoff, queue, ciphertext cache, remote sidecar, or attachment bytes. `baton fetch` resolved and strictly verified the Sui dynamic-field manifest, retrieved both ciphertexts from the public Testnet Walrus aggregator, decrypted them through the live Seal committee using the protected owner identity and `OwnerCap`, re-hashed both plaintexts, cross-checked all anchored metadata, and persisted the complete local set. The recovered attachment contained the expected source bytes. A separate clean directory confirmed that `baton resume` invokes the same recovery automatically.

This proves the owner-controlled Testnet read/write path. The delegated path is recorded separately below. Mainnet deployment is not claimed.

## Package v2 — delegated access policy

The package was upgraded with local compatibility checks and dependency verification enabled. No verification bypass was used.

| Item | Value |
|---|---|
| Original package identity | `0x74020a1a00779799768a5145bd2734f3e724d2826c5e8d610f345c2c036b090e` |
| Executable package v2 | `0xd92b150b57ef31defb5b9ddd5a155102efe1c34058a19fdb30cbe4f4a46aa3e3` |
| Upgrade transaction | `FzC3a2mWPB3T7F1iE43rDXgoooNK2M719sGkr1DjAeZy` |
| Toolchain | `1.73.2` |

Package v2 adds address-bound, non-publicly-transferable `AccessCap` objects and per-recipient access records. Revocation flips the live record without requiring the capability back; re-granting advances its generation so an older capability cannot become valid again.

## Live delegated sharing and revocation evidence

On 2026-06-19, an existing owner-controlled project published a new child baton under the v2 policy, granted a separately generated Ed25519 identity read access, and handed it a public invitation. The recipient verified ownership and the live access generation, fetched the ciphertext from Walrus, decrypted it through the decentralized Seal committee, verified the handoff hash, and rendered the resume context.

| Item | Value |
|---|---|
| ProjectMemory | `0xa0dd123b2ec564d7502688f751f360e9ef3f7d18f4cd73a6e671afdf3c0acaa4` |
| Baton content hash | `bf90541dc11b6ae4cafcd1d02f81b0c6302ab7c894fee948f92d1ccb9ea5ea6a` |
| Walrus blob | `1z7xhue7qk99wnT-X4KwvcsU6nQFav_QdHUUjxUFTr8` |
| Encrypted blob SHA-256 | `46bc514618efab1acae2905ddd1cb1906bec00040caa92bb1fe43fb902c2f0dd` |
| Manifest anchor transaction | `BGeGKG9nRMpu1Wdfbyh6dWkp6RKMKcUNve8YCkyvC15i` |
| Recipient | `0xc3463de2e9d0e4355a55eae2250f6d2e7a61488ab630662b464a9f626cb7a75a` |
| AccessCap | `0xa8c254e7b42e115b7c28416de992327894f80f3f8a6bab86e2b60038c98d3065` |
| Grant transaction | `HCmWTwW3JRh7YokaJ4MvMgFpbcraLGBJomefB6TRs1yg` |
| Revocation transaction | `4cxmm2f14ves9QKMxfdxXYKgEr6DRei8aw9XEvQBBcPK` |

After revocation, the recipient's local copy was removed and a fresh remote fetch was attempted. Walrus retrieval still succeeded, but Seal denied the key request with `User does not have access to one or more of the requested keys`. A separate clean owner directory then fetched and decrypted the same baton successfully, proving revocation affected the delegate without damaging owner recovery.

Revocation is forward-only: it cannot erase plaintext already fetched by a recipient. zkLogin, sponsored gas, external beta hardening, and Mainnet deployment remain unproven and are not claimed here.
