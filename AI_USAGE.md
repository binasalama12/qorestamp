# AI Usage — How QoreStamp Was Built

This file documents, honestly and specifically, how an AI agent was used to
build QoreStamp, and which parts were done by the human. It exists for
transparency: QoreStamp is an AI-native build, and we would rather show the
process than hide it.

**Short version:** QoreStamp was designed, implemented, tested, deployed to
QoreChain testnet, and documented primarily by an AI agent (**Muse**, a
personal-agent system running on the builder's own infrastructure) working
under the direction of one human builder. The human made the product and
process decisions, owns all wallets and keys, performed the event
registration and account connections, and owns the final submission. The AI
wrote essentially all of the code, ran the tests, executed the on-chain
deployment flow through local scripts, and produced the demo video.

Nothing in this file is aspirational: every claim below maps to a commit in
this repository, a file in the project tree, or a transaction hash on
QoreChain testnet that anyone can check.

## Division of labor

### The human did

- Chose the event (Build Before Q-Day), the category (**Quantum Pass**),
  and the product direction: post-quantum identity attestation for AI
  agents, verifiable by anyone from public data.
- Performed the event registration personally (GitHub sign-in, X account
  connection, QoreX wallet connection) — these steps involve the human's
  own accounts and were never delegated.
- Owns and controls all wallets and secret material. Keys live only in
  local secret files (mode 0600, outside this repository, gitignored); the
  AI never published, transmitted, or committed any key, seed, or secret.
- Decided the repository host account, reviewed progress at each stage,
  approved the on-chain steps before they ran, and is responsible for the
  final hackathon submission.

### The AI agent did

- Researched the QoreChain SDK and testnet endpoints, then scaffolded the
  project from the official `create-qorechain-dapp@0.14.0` template
  (commit `0baeda1`).
- Designed the attestation format and wrote all application code
  (details per stage below).
- Wrote and ran the full test suite, fixed failures, and re-ran until
  green.
- Wrote and executed the deployment scripts: ML-DSA-87 key registration,
  EVM authorisation window, registry contract deployment, and the first
  attestation stamp — all against public testnet endpoints, from a
  dedicated testnet deployer wallet created for this project.
- Built the web UI, wrote the README and submission materials, and
  produced the demo video programmatically.
- Kept a written status log of every stage, including failures and
  corrections (one is summarised under "Corrections" below).

## Stage by stage

### 1. Design — attestation core

The AI designed the attestation as a **canonical, domain-separated
record**: agent label + hash of the statement + hash of the agent's
ML-DSA-87 public key + chain id, reduced to a single SHA-256 digest. The
digest is the one value everything else refers to — it is what gets
signed, anchored, and stored in the registry — so verification never
depends on parsing free-form data. Implemented in
`src/lib/attestation.ts` (commit `25c4589`).

### 2. Post-quantum signing helpers

`src/lib/pqc.ts` wraps `@qorechain/sdk` 0.14.0 for ML-DSA-87
(Dilithium-5, FIPS 204): keypair generation, sign/verify, and building the
chain's hybrid signature extension
(`/qorechain.pqc.v1.PQCHybridSignature`), with strict FIPS 204 size
checks so malformed keys or signatures fail early instead of on chain
(commit `25c4589`).

### 3. Registry contract

`contracts/QoreStampRegistry.sol` is a deliberately small EVM registry —
`stamp / getStamp / isStamped / stampCount / digestAt`, one stamp per
digest — compiled with solc 0.8.38 to a checked-in artifact. The read path
(`src/lib/registry.ts`) and the public verifier (`src/lib/verify.ts`)
recompute the digest, verify the ML-DSA-87 signature fully offline, read
the registry record via `eth_call`, and look up the anchoring native
transaction over the REST API (commit `e5383b4`).

### 4. Tests — written and run by the AI

The AI wrote the test suite alongside the code and ran it at every stage:

- `npm test` — 20 unit / mocked-transport tests (attestation 5, pqc 5,
  registry 4, verify 4, hex 2), plus 2 live tests skipped by default.
- `QORE_LIVE=1 npm test` — **22/22 passed** against the real testnet:
  EVM RPC reports chain id **9800**, REST reports network
  `qorechain-diana`.
- `npm run typecheck` clean; `npm run build` succeeds.

### 5. Deployment and the first stamp — executed by the AI, on testnet

The original plan assumed deployment had to go through the human's QoreX
wallet. The AI researched the SDK's local signing flow instead and found
the deployer could register its own post-quantum key directly
(`scripts/register-pqc.ts`), which removed the blocker without any key
ever leaving the local machine:

- **PQ key registration** — `MsgRegisterPQCKeyV2`, possession proven:
  tx `60F7B543A1C26416E276E36B05ACAEC00D8D5847BED507B093E64E6C9C152FF3`
- **EVM authorisation window** — opened with a hybrid-signed tx:
  `AF5956F6BCEC09D59B88E7DFA2BE43BDB3D64CDDCDBD194369D47589C0D9671F`
- **Registry deployed** — `QoreStampRegistry` at
  `0xbbfcc2956dc59fc38ffa9ac154f3ee81b1d64832`,
  tx `0x68ca922c2aef08bf39c12a4ed6877ff1e9796bef5d7195f58469bf86576dc932`
- **First stamp** (`scripts/stamp-first.ts`, label `qorestamp-deployer`):
  digest `b9c239d34210f3674b30024da64f5c59d4b97b9ce3f63352c07a727b30097787`,
  anchored by a hybrid-signed native tx
  `D95DF0F1D6A5871FD517A22AED18454202EACE442A0E28999DCEC34278D6E54F`
  and recorded in the registry by EVM tx
  `0xa4fa339564a41731085029289669d8c5e6e8ba4905dc0725c84e714375341d08`.
  Public verification of the stamp returns **ok: true**; `stampCount` = 1.
  The full public evidence is checked in as `stamp-first-evidence.json`.

### 6. Web UI

`src/App.tsx` (commit `cec485c`) provides two panels on `@qorechain/react`:
**Stamp** (in-page demo ML-DSA-87 keypair → build, sign, inspect digest,
signature, hybrid extension, and registry calldata) and **Verify** (the
full public verification flow). The featured image is
`docs/featured.svg`.

### 7. Demo video

The demo video (2:23, 1920×1080) was produced programmatically by the AI:
frames rendered in code, English text-to-speech narration, assembled with
ffmpeg. Every address, digest, and hash shown on screen is real — taken
from `stamp-first-evidence.json` and re-verified read-only against the
live chain during production (`stampCount()` = 1, `isStamped()` = true).
No transaction was sent for the video, and no secret appears in any frame.

### 8. Documentation and submission package

The AI wrote the README (flow, run instructions, tests, deployment
addresses), hardened `.gitignore` against secret files before the first
push, and assembled the submission field drafts. The human reviews and
submits the final entry.

## Corrections the process caught

Two examples of the human–AI loop working as intended:

- **Address transcription.** The registered account's bech32 address was
  initially transcribed with a digit `1` where the canonical encoding has
  the letter `l`. The AI caught it three independent ways — bech32's
  charset excludes `1` in the data part, re-encoding the EVM address bytes
  reproduced the `l` form, and only the `l` form resolves on the REST
  API — and corrected every document before submission.
- **Deployment assumption.** "Deployment requires the human's QoreX
  wallet" was written down as a hard blocker, then disproven by the AI's
  SDK research (stage 5). The blocker note and its resolution are both in
  the project status log; we kept the wrong note rather than deleting it.

## What the AI did not do

- No event registration, account creation, or social-account action.
- No custody decisions: wallet creation for the deployer was for public
  testnet funds only, and all secret material stayed in local files
  outside this repository.
- No mainnet activity of any kind. Everything on chain is QoreChain
  testnet (`qorechain-diana`, chain id 9800).
- No fabricated results: test counts, transaction hashes, and the stamp
  evidence in this repository are real and independently checkable.

## Evidence trail

- **Commits** (14 Nov 2026, this repository): `0baeda1` scaffold →
  `25c4589` attestation core + PQC helpers → `e5383b4` registry contract +
  verification → `cec485c` web UI → `84aec6c` README → `4b6e81e`
  submission hardening → `c7b5414` PQ registration + first-stamp scripts →
  `719b373` deployment addresses + stamp evidence.
- **On chain**: registry address, deploy tx, PQ registration tx, window
  tx, anchor tx, and stamp tx are listed in stage 5 and in the README's
  "Deployment & addresses" table.
- **Tests**: 22/22 with live checks enabled, as described in stage 4.
