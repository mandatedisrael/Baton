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

Revocation is forward-only: it cannot erase plaintext already fetched by a recipient. The separate sponsored-registration proof follows; zkLogin, external beta hardening, and Mainnet deployment remain unproven and are not claimed here.

## Live sponsored registration evidence

On 2026-06-19, a newly generated Baton identity with no Testnet coins registered a clean project through the constrained sponsor service. The user and sponsor signed the same transaction bytes; the chain recorded the user as sender and project owner while charging only the sponsor-owned gas coin.

| Item | Value |
|---|---|
| Zero-balance user | `0x1e3c764b8d893cba1d4b0fa6751acd108e4bc80658d2685ee3b3934d57b7a826` |
| Sponsor | `0x6885ce4d049be8fe3dddc8f3bc8abf0b6d627657cc397005f3f5aa7ada289fab` |
| Registration transaction | `12ttjkj8zUDX4ASKxdyZ8KdWuhrQbnnZFDsRs2mcHnSC` |
| `ProjectMemory` | `0xfdd46a9a26d121b1905a5653f0ed7ea39457bbd9418edd68e12e83565d8f72f5` |
| User-owned `OwnerCap` | `0x875260d188d9111ec842894c34feac91a97eb86f7a2aa6929ae2d28b2ac9f8d8` |
| Sponsor gas cost | `4,536,280 MIST` |

The final transaction contains two signatures, calls only the v2 `memory::create_project` entry point, and creates both original-package-typed objects for the user. A direct balance query still returned no coins for the user after execution. The invitation state contained only the token's SHA-256 hash, recorded the durable result, and rejected a second identity attempting a different registration with the same token.

This proves the invitation-scoped Testnet sponsorship path, not a public hosted gas station. The shipped service binds to loopback for placement behind operator-managed TLS, rate-limits requests, bounds request bodies and gas, reserves one concrete sponsor coin per pending registration, verifies the user's transaction signature before spending, and never signs caller-supplied transaction bytes. Public service operations, abuse economics, zkLogin, external beta hardening, and Mainnet deployment remain unproven and are not claimed here.

## Bound invitation and live operator-control evidence

On 2026-06-19, a fresh invitation was pre-bound to a specific zero-balance Baton identity and local project ID, then used through the running sponsor daemon. Inspection ran concurrently through the operator CLI and returned the durable used result. A second bound invitation was issued and revoked while the daemon remained online; its registration prepare request was refused, and pruning removed the revoked record without deleting the completed audit result.

| Item | Value |
|---|---|
| Zero-balance user | `0x4313c02b397ffd8f51e259e931fb36af1cddcb919c896c92739a1fe87cae7c28` |
| Bound project ID | `b850855c-0066-496c-830d-bea54eb833c0` |
| Sponsor | `0x6885ce4d049be8fe3dddc8f3bc8abf0b6d627657cc397005f3f5aa7ada289fab` |
| Registration transaction | `HcmxyxYj9xEPxim7UWDesTWG1kB7hAP6eTxVMq2v39Z8` |
| `ProjectMemory` | `0x202687045dca3605b857545c8624a53a56bce42d99a2bd1c640042f1924910d1` |
| User-owned `OwnerCap` | `0xa73469286317b1ca0dfcc52b67f56616f90011d922f41637f902cd0ce529df23` |
| Sponsor gas cost | `4,536,280 MIST` |

The successful transaction has two signatures, records the bound user as sender, charges the sponsor as gas owner, and leaves the user with no SUI coins. The sponsor state contains the invitation ID, recipient, project ID, request ID, and result digest—but only a SHA-256 hash of the bearer token. Transaction-scoped file locking serializes live HTTP and operator CLI mutations, preventing concurrent processes from losing invitation updates or double-reserving the same gas coin.

This proves the local operator-control implementation against live Testnet infrastructure. It does not claim an Internet-facing deployment, managed TLS, monitoring, denial-of-service resilience, or production abuse economics.

## Live sponsor readiness and liability-control evidence

On 2026-06-19, the hardened daemon started against the funded Testnet sponsor and the durable bound-invitation state above with a daily limit of 5, active-reservation limit of 2, and per-client request limit of 4. `/ready` reached Sui and returned `200` only after finding an unreserved coin that could cover the fixed registration budget. `/metrics` reported one completed registration that UTC day, zero active reservations, and the configured limits without exposing addresses, tokens, invitation IDs, projects, or transaction digests.

Five invalid registration requests were sent through the trusted-proxy path for one documentation-only client IP: four reached validation and the fifth received `429`. A different client IP remained independent and reached validation. The resulting counters recorded five rejected validation requests and one rate-limited request. Health and metrics probes did not consume the registration request allowance.

This proves the chain-aware readiness, proxy-client isolation, metrics, and configured liability controls on the real Testnet sponsor process. TLS termination, public DNS, Internet traffic, external monitoring, host hardening, and abuse response remain deployment work and are not claimed here.

## Live interrupted-registration reconciliation evidence

On 2026-06-19, the durable record for successful sponsored transaction `HcmxyxYj9xEPxim7UWDesTWG1kB7hAP6eTxVMq2v39Z8` was copied into the exact state produced when Sui execution succeeds but the local process stops before recording its result: the reservation remained submitted with its original transaction bytes, while `usedAt` and `result` were absent. No bearer token or user signature was supplied during recovery.

`baton-sponsor reconcile` derived the deterministic digest from the persisted transaction bytes, retrieved the existing transaction and object changes from Sui Testnet, verified the expected `ProjectMemory` and `OwnerCap` types, and restored the durable used result. The same submitted state was then recreated and the daemon was restarted. Startup reconciliation completed it before the HTTP listener became ready; `/ready` subsequently returned `200` and operator inspection showed the original digest.

This proves both manual and automatic restart recovery from the post-execution/pre-commit crash window without resubmitting or spending gas twice. Submitted records are retained after local expiry and cannot be revoked or pruned until their Sui outcome is reconciled. Arbitrary process termination at every instruction boundary and long-duration Testnet outages remain broader chaos-testing work.
