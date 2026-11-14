/**
 * stamp-first.ts — record the FIRST QoreStamp attestation from OUR OWN
 * QoreChain testnet deployer wallet, end to end, locally (no QoreX):
 *
 *   1. Build the attestation over the deployer's REGISTERED ML-DSA-87 key
 *      (src/lib/attestation.ts) and sign its digest with that key.
 *   2. Anchor it with a HYBRID-signed native tx: a 1-uqor self-send whose
 *      memo carries the attestation digest (the native tx hash is what the
 *      registry stores as the anchor reference).
 *   3. Record it in QoreStampRegistry via an EVM `stamp(...)` tx from the
 *      same account (needs the still-live EVM authorisation window).
 *   4. Verify on-chain: stampCount, the stored record, balances.
 *
 * Secrets are loaded from ~/workspace/qorechain/hidden_files/ (mode 0600)
 * exactly like scripts/register-pqc.ts and are NEVER printed. Only
 * addresses, hashes and statuses go to stdout. A public evidence file
 * (label, statement, digest, signature, tx hashes) is written to
 * ~/workspace/qorechain/stamp-first-evidence.json for the submission.
 *
 * Run: npx tsx scripts/stamp-first.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { StargateClient } from "@cosmjs/stargate";
import {
  EthNativeSigner,
  calculateFee,
  fetchEvmWindow,
  fetchPqcStatus,
  pqcKeyFromRecoveryCode,
  pqcVerify,
  unifiedAccountFromSeed,
  type UnifiedAccount,
} from "@qorechain/sdk";
import {
  createEvmClient,
  evmAccountFromPrivateKey,
  writeContract,
  type Hex,
} from "@qorechain/evm";

import {
  attestationDigestBytes,
  attestationDigestHex,
  attestationKeyHashHex,
  buildAttestation,
} from "../src/lib/attestation.js";
import { signAttestation } from "../src/lib/pqc.js";
import { readStamp, readStampCount } from "../src/lib/registry.js";
import { registryContractAbi } from "../contracts/QoreStampRegistry.artifact.js";

const REST = "https://api-testnet.qore.host";
const RPC = "https://rpc-testnet.qore.host";
const EVM_RPC = "https://evm-testnet.qore.host";
const CHAIN_ID = "qorechain-diana";
const EXPECTED_EVM = "0x60f085008c8e8b31b6aCE997B3043B3087AC4fe7".toLowerCase();
const EXPECTED_QOR = "qor1vrcg2qyv369nrd4vaxtmxppmxzr6cnl8m4s6jw";
const REGISTRY = "0xbbfcc2956dc59fc38ffa9ac154f3ee81b1d64832" as const;
const GAS_LIMIT = 400_000;
const GAS_PRICE = "0.15uqor"; // fee per native tx = 60_000 uqor = 0.06 QOR

const LABEL = "qorestamp-deployer";
const STATEMENT =
  "QoreStamp operator attestation. The holder of this ML-DSA-87 key deployed " +
  "and operates the QoreStampRegistry at 0xbbfcc2956dc59fc38ffa9ac154f3ee81b1d64832 " +
  "on qorechain-diana (EVM chain id 9800). QoreStamp anchors post-quantum agent " +
  "identity attestations on-chain for public verification. Project source commit 4b6e81e.";

const DEPLOYER_ENV = fileURLToPath(
  new URL("../../hidden_files/deployer.env", import.meta.url),
);
const PQC_FILE = fileURLToPath(
  new URL("../../hidden_files/deployer-pqc.txt", import.meta.url),
);
const EVIDENCE_FILE = fileURLToPath(
  new URL("../stamp-first-evidence.json", import.meta.url),
);

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error("Value is not valid hex.");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(2 * i, 2 * i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function buildAccount(): UnifiedAccount {
  const env = parseEnvFile(DEPLOYER_ENV);
  const keyHex = env.QORE_DEPLOYER_KEY;
  if (!keyHex) throw new Error("QORE_DEPLOYER_KEY missing from deployer.env");
  const keyBytes = hexToBytes(keyHex);
  if (keyBytes.length !== 32) throw new Error("Deployer key must be 32 bytes.");

  if (!existsSync(PQC_FILE)) throw new Error("deployer-pqc.txt missing. STOP.");
  const fields = parseEnvFile(PQC_FILE);
  const secret = hexToBytes(fields.PQC_SECRET_HEX ?? "");
  const recoveryCode = fields.PQC_RECOVERY_CODE;
  if (secret.length !== 32 || !recoveryCode) {
    throw new Error("deployer-pqc.txt incomplete. STOP.");
  }

  const account = unifiedAccountFromSeed(keyBytes, { pqcSecret: secret });
  if (account.evm.toLowerCase() !== EXPECTED_EVM) {
    throw new Error(`Derived EVM address mismatch: ${account.evm}. STOP.`);
  }
  if (account.cosmos !== EXPECTED_QOR) {
    throw new Error(`Derived qor address mismatch: ${account.cosmos}. STOP.`);
  }
  const fromCode = pqcKeyFromRecoveryCode(recoveryCode, account.cosmos);
  if (!bytesEqual(fromCode.publicKey, account.pqc.publicKey)) {
    throw new Error("Recovery code does not reproduce the account PQC key. STOP.");
  }
  return account;
}

async function fetchAuthAccount(): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const res = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${EXPECTED_QOR}`);
  if (!res.ok) throw new Error(`Auth account query failed: HTTP ${res.status}`);
  const json = (await res.json()) as {
    account: { account_number: string; sequence: string };
  };
  return {
    accountNumber: BigInt(json.account.account_number),
    sequence: BigInt(json.account.sequence),
  };
}

async function fetchUqorBalance(): Promise<bigint> {
  const res = await fetch(`${REST}/cosmos/bank/v1beta1/balances/${EXPECTED_QOR}`);
  if (!res.ok) throw new Error(`Balance query failed: HTTP ${res.status}`);
  const json = (await res.json()) as {
    balances: { denom: string; amount: string }[];
  };
  return BigInt(json.balances.find((b) => b.denom === "uqor")?.amount ?? "0");
}

async function main(): Promise<void> {
  const account = buildAccount();
  console.log(`deployer evm: ${account.evm} (match verified)`);
  console.log(`deployer qor: ${account.cosmos} (match verified)`);

  // Preconditions: PQC registered + EVM window live.
  const pqc = await fetchPqcStatus({ rest: REST, address: EXPECTED_QOR });
  if (!pqc.registered) throw new Error("PQC key not registered. STOP.");
  const win = await fetchEvmWindow({ rest: REST, address: EXPECTED_QOR });
  if (!win.found || !win.live) {
    throw new Error("EVM window not live. Run register-pqc.ts window first. STOP.");
  }
  console.log(
    `window: live (expiry ${win.expiryHeight}, remaining txs ${win.remainingTxs}, remaining value ${win.remainingValue} uqor)`,
  );

  // 1. Attestation over the registered ML-DSA-87 key + signature.
  const attestation = buildAttestation({
    agentLabel: LABEL,
    statement: STATEMENT,
    pqcPublicKey: account.pqc.publicKey,
  });
  const digestBytes = attestationDigestBytes(attestation);
  const signature = signAttestation(account.pqc.secretKey, digestBytes);
  const sigOk = pqcVerify(account.pqc.publicKey, digestBytes, signature);
  console.log(`attestation label: ${attestation.agentLabel}`);
  console.log(`attestation digest: ${attestation.digest}`);
  console.log(`pqc public key hash: ${attestation.pqcPublicKeyHash}`);
  console.log(`signature local verify: ${sigOk}`);
  if (!sigOk) throw new Error("Attestation signature failed local verify. STOP.");

  const digestHex = attestationDigestHex(attestation) as Hex;
  const keyHashHex = attestationKeyHashHex(attestation) as Hex;

  // Idempotency: if this digest is already stamped, only re-verify.
  const existing = await readStamp(REGISTRY, digestHex, EVM_RPC);
  let nativeTxHash: string;
  let nativeTxHeight: number | null = null;
  let evmTxHash: string | null = null;

  if (existing) {
    console.log("stamp: already recorded for this digest - skipping broadcasts.");
    nativeTxHash = existing.nativeTxHash;
  } else {
    // 2. Hybrid-signed native anchor tx (1 uqor self-send, digest in memo).
    const memo =
      `qorestamp:attestation:v1 label=${LABEL} digest=${attestation.digest}`;
    const { accountNumber, sequence } = await fetchAuthAccount();
    console.log(`auth account: number=${accountNumber} sequence=${sequence}`);
    const signer = new EthNativeSigner(account, { signMode: "hybrid", rest: REST });
    const fee = calculateFee(GAS_LIMIT, GAS_PRICE);
    const transport = await StargateClient.connect(RPC);
    try {
      const res = await signer.bankSend(
        transport,
        EXPECTED_QOR,
        [{ denom: "uqor", amount: "1" }],
        { chainId: CHAIN_ID, accountNumber, sequence, fee, memo },
      );
      console.log(`anchor tx hash: ${res.transactionHash}`);
      console.log(`anchor tx code: ${res.code}`);
      if (res.code !== 0) throw new Error(`Anchor tx failed with code ${res.code}. STOP.`);
      nativeTxHash = res.transactionHash;
    } finally {
      transport.disconnect();
    }
    const txRes = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${nativeTxHash}`);
    if (txRes.ok) {
      const txJson = (await txRes.json()) as {
        tx_response?: { height: string; code: number };
      };
      nativeTxHeight = Number(txJson.tx_response?.height ?? 0) || null;
      console.log(`anchor tx verified via REST: height ${nativeTxHeight}`);
    }

    // 3. EVM stamp(...) from the same account, inside the live window.
    const env = parseEnvFile(DEPLOYER_ENV);
    const rawKey = env.QORE_DEPLOYER_KEY;
    const evmKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex;
    const client = await createEvmClient({ endpoints: { evmRpc: EVM_RPC } });
    const evmAccount = evmAccountFromPrivateKey(evmKey);
    if (evmAccount.address.toLowerCase() !== EXPECTED_EVM) {
      throw new Error("EVM account mismatch. STOP.");
    }
    const chainId = await client.getChainId();
    if (chainId !== 9800) throw new Error(`Expected chain id 9800, got ${chainId}. STOP.`);
    const wallet = client.getWalletClient(evmAccount);
    evmTxHash = await writeContract(wallet, {
      address: REGISTRY,
      abi: registryContractAbi,
      functionName: "stamp",
      args: [digestHex, attestation.agentLabel, keyHashHex, nativeTxHash],
    });
    console.log(`stamp evm tx hash: ${evmTxHash}`);
    const receipt = await client.publicClient.waitForTransactionReceipt({
      hash: evmTxHash as Hex,
    });
    console.log(`stamp evm tx status: ${receipt.status}, block ${receipt.blockNumber}`);
    if (receipt.status !== "success") throw new Error("Stamp EVM tx reverted. STOP.");
  }

  // 4. Verify on-chain.
  const count = await readStampCount(REGISTRY, EVM_RPC);
  const stamp = await readStamp(REGISTRY, digestHex, EVM_RPC);
  console.log(`stampCount: ${count}`);
  if (!stamp) throw new Error("Stamp not readable after broadcast. STOP.");
  console.log(`stamp stamper: ${stamp.stamper}`);
  console.log(`stamp label: ${stamp.label}`);
  console.log(`stamp pqcKeyHash: ${stamp.pqcKeyHash}`);
  console.log(`stamp nativeTxHash: ${stamp.nativeTxHash}`);
  console.log(`stamp timestamp: ${stamp.timestamp}`);
  const matches =
    stamp.stamper.toLowerCase() === EXPECTED_EVM &&
    stamp.label === attestation.agentLabel &&
    stamp.pqcKeyHash.toLowerCase() === keyHashHex.toLowerCase() &&
    stamp.nativeTxHash === nativeTxHash;
  console.log(`stamp record matches attestation: ${matches}`);
  if (!matches) throw new Error("On-chain stamp does not match the attestation. STOP.");

  const uqor = await fetchUqorBalance();
  console.log(`deployer balance after: ${uqor} uqor (${Number(uqor) / 1e6} QOR)`);
  const winAfter = await fetchEvmWindow({ rest: REST, address: EXPECTED_QOR });
  console.log(
    `window after: live=${winAfter.live} remainingTxs=${winAfter.remainingTxs} remainingValue=${winAfter.remainingValue} uqor`,
  );

  // Public evidence for the submission (no secrets: key is the PUBLIC key).
  const evidence = {
    project: "QoreStamp",
    chainId: CHAIN_ID,
    registry: REGISTRY,
    label: attestation.agentLabel,
    statement: STATEMENT,
    statementHash: attestation.statementHash,
    digest: attestation.digest,
    canonical: attestation.canonical,
    pqcPublicKeyHash: attestation.pqcPublicKeyHash,
    pqcPublicKeyHex: bytesToHex(account.pqc.publicKey),
    signatureHex: bytesToHex(signature),
    stamperEvm: account.evm,
    stamperQor: account.cosmos,
    nativeTxHash,
    nativeTxHeight,
    evmTxHash,
    stampTimestamp: stamp.timestamp,
    stampCount: count,
    recordedAt: new Date().toISOString(),
  };
  writeFileSync(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`evidence written: ${EVIDENCE_FILE}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
