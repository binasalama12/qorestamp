# QoreStamp

**Post-quantum agent identity attestations on QoreChain.**

QoreStamp lets an AI agent stamp an identity attestation on QoreChain
testnet (`qorechain-diana`, EVM chain id 9800) and lets *anyone* verify it
later from public data alone — no account, no wallet, no trust in the agent.

Built for **Build Before Q-Day — Quantum Pass**. Scaffolded from the official
`create-qorechain-dapp@0.14.0` fullstack-web template.

## How it works

1. **Attest.** The agent builds an attestation: a canonical record binding
   its label, a statement hash, the hash of its **ML-DSA-87** (Dilithium-5,
   FIPS 204) public key, and the chain id. The record's SHA-256 digest is the
   single value everything else refers to. (`src/lib/attestation.ts`)
2. **Sign.** The agent signs the digest with its ML-DSA-87 secret key via
   `@qorechain/sdk` — the exact byte formats the chain's own PQC verifier
   accepts, including the `PQCHybridSignature` TX extension
   (`/qorechain.pqc.v1.PQCHybridSignature`). (`src/lib/pqc.ts`)
3. **Anchor.** The attestation is anchored by a **hybrid-signed native tx**
   sent through QoreX (the native path — a plain EVM tx does not count as
   hybrid-signed), and the digest + label + PQC key hash + native tx hash are
   recorded in a tiny EVM registry contract. (`contracts/QoreStampRegistry.sol`)
4. **Verify.** Anyone recomputes the digest, checks the ML-DSA-87 signature
   locally (offline, pure cryptography), reads the registry record back with
   `eth_call`, and looks up the anchoring native tx on the REST API.
   (`src/lib/verify.ts`, `src/lib/registry.ts`)

## Run it

```bash
npm install
cp .env.example .env   # defaults already point at the public diana endpoints
npm run dev            # http://localhost:5173
```

- **Stamp panel** — generate a demo in-page ML-DSA-87 keypair (memory only),
  build + sign an attestation, and inspect the digest, signature, hybrid
  extension, and registry calldata. In production the key lives in QoreX.
- **Verify panel** — paste a label / statement / public key / signature and
  verify. Set `VITE_QORESTAMP_REGISTRY` in `.env` once the registry is
  deployed to add the on-chain record + native-tx checks.

## Tests

```bash
npm test               # unit + mocked-transport tests (20)
QORE_LIVE=1 npm test   # + read-only live checks against the public endpoints (2)
npm run typecheck
```

## Deploy the registry (needs a funded diana account)

```bash
node scripts/compile-registry.mjs   # regenerate the artifact after edits
# fund an EVM account via the dashboard faucet, set QORE_EVM_PRIVATE_KEY in .env
npm run deploy:registry             # refuses to run on any chain id != 9800
```

## Deployment & addresses

| Item | Value |
| --- | --- |
| Network | QoreChain testnet `qorechain-diana` (EVM chain id 9800) |
| EVM JSON-RPC | https://evm-testnet.qore.host |
| REST (LCD) | https://api-testnet.qore.host |
| Registered account (native) | `qor1aphlf7rdlyqa2qlgq0e7hwyk90vh3s7fvlruxn` |
| Registered account (EVM) | `0xe86ff4f86df901d503e803f3ebb8962bd978c3c9` |
| QoreStampRegistry | _TBD — pending deploy (see below)_ |
| Hybrid anchor tx | _TBD — first stamp, via QoreX_ |

The native and EVM addresses above are the same account (same 20 bytes,
registered for **Build Before Q-Day** with QoreX connected). Note the native
address contains an `l` before `ruxn` that is easy to misread as `1` —
bech32's data charset never contains `1`; the spelling above is the
canonical one (it resolves on the REST API and matches the EVM bytes).

Deploy is one command once a funded deployer key is in `.env`
(`QORE_EVM_PRIVATE_KEY`, gitignored — the key for the registered account
lives in QoreX and never leaves the user's device, so the deploy is either
run locally by the account owner or from a separate funded deployer
account):

```bash
npm run deploy:registry   # prints the address → set VITE_QORESTAMP_REGISTRY
```

## Layout

| Path | What |
| --- | --- |
| `src/lib/attestation.ts` | Canonical attestation record + digest |
| `src/lib/pqc.ts` | ML-DSA-87 sign/verify + hybrid extension (SDK wrappers) |
| `src/lib/registry.ts` | EVM registry reads (`eth_call`) + stamp calldata |
| `src/lib/verify.ts` | End-to-end public verification flow |
| `contracts/QoreStampRegistry.sol` | Tiny stamp registry (one stamp per digest) |
| `scripts/deploy-registry.ts` | Registry deploy via `@qorechain/evm` |
| `docs/featured.svg` | Submission featured image |

## Notes

- Keys never leave the device in production: QoreX holds the ML-DSA-87 key
  and signs the hybrid anchor tx. The in-page keypair is a demo only.
- The production bundle is large (~3 MB) because it includes the SDK's PQC
  cryptography; code-splitting is a known post-fest improvement.

## License

MIT — see `LICENSE`. Template portions © QoreChain, Apache-2.0
(`create-qorechain-dapp`).
