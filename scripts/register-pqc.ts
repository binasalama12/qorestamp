/**
 * register-pqc.ts — one-time PQC bootstrap for OUR OWN QoreChain testnet
 * deployer wallet (eth-native account, key held locally in
 * ~/workspace/qorechain/hidden_files/deployer.env, mode 0600).
 *
 * Phases (run in order; each is idempotent and safe to re-run):
 *   secret    Generate a fresh 32-byte PQC secret + QRC1 recovery code and
 *             store them in hidden_files/deployer-pqc.txt (mode 0600) BEFORE
 *             any broadcast. If the file already exists it is loaded, never
 *             regenerated. Verifies the derived unified account matches the
 *             expected deployer addresses.
 *   register  Broadcast /qorechain.pqc.v1.MsgRegisterPQCKeyV2 signed
 *             classical-only (bootstrap-exempt) via EthNativeSigner +
 *             StargateClient, then verify via REST that the key is found.
 *   window    Broadcast /qorechain.pqc.v1.MsgOpenEVMWindow signed HYBRID
 *             (blocks 17280, maxTxs 10, maxValue 5000000 uqor), then verify
 *             via REST that the window is live.
 *   status    Read-only status dump (no secrets printed).
 *
 * Secrets are never printed: only addresses, tx hashes and statuses.
 *
 * Run: npx tsx scripts/register-pqc.ts <secret|register|window|status>
 */
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { StargateClient } from "@cosmjs/stargate";
import {
  CHAIN_UPGRADE_V3_2_3,
  EthNativeSigner,
  buildRegisterPqcKeyMsg,
  calculateFee,
  fetchEvmWindow,
  fetchPqcStatus,
  fetchUpgradeAppliedHeight,
  openEvmWindowMsg,
  pqcKeyFromRecoveryCode,
  pqcRecoveryCodeFromSecret,
  signProofOfPossession,
  unifiedAccountFromSeed,
  verifyProofOfPossession,
  type UnifiedAccount,
} from "@qorechain/sdk";

const REST = "https://api-testnet.qore.host";
const RPC = "https://rpc-testnet.qore.host";
const CHAIN_ID = "qorechain-diana";
const EXPECTED_EVM = "0x60f085008c8e8b31b6aCE997B3043B3087AC4fe7".toLowerCase();
const EXPECTED_QOR = "qor1vrcg2qyv369nrd4vaxtmxppmxzr6cnl8m4s6jw";
const GAS_LIMIT = 1_500_000;
const GAS_PRICE = "0.15uqor"; // fee per tx = 225_000 uqor = 0.225 QOR (cap)

const DEPLOYER_ENV = fileURLToPath(
  new URL("../../hidden_files/deployer.env", import.meta.url),
);
const PQC_FILE = fileURLToPath(
  new URL("../../hidden_files/deployer-pqc.txt", import.meta.url),
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

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function loadDeployerKeyBytes(): Uint8Array {
  const env = parseEnvFile(DEPLOYER_ENV);
  const key = env.QORE_DEPLOYER_KEY;
  if (!key) throw new Error("QORE_DEPLOYER_KEY missing from deployer.env");
  const bytes = hexToBytes(key);
  if (bytes.length !== 32) {
    throw new Error(`Deployer key must be 32 bytes, got ${bytes.length}.`);
  }
  return bytes;
}

interface PqcSecretMaterial {
  secret: Uint8Array;
  recoveryCode: string;
  created: boolean;
}

function loadOrCreatePqcSecret(): PqcSecretMaterial {
  if (existsSync(PQC_FILE)) {
    const fields = parseEnvFile(PQC_FILE);
    const secretHex = fields.PQC_SECRET_HEX;
    const recoveryCode = fields.PQC_RECOVERY_CODE;
    if (!secretHex || !recoveryCode) {
      throw new Error("deployer-pqc.txt exists but is incomplete. Refusing to regenerate.");
    }
    const secret = hexToBytes(secretHex);
    if (secret.length !== 32) throw new Error("Stored PQC secret is not 32 bytes.");
    // The stored recovery code must encode the same secret.
    if (pqcRecoveryCodeFromSecret(secret) !== recoveryCode) {
      throw new Error("Stored recovery code does not match stored secret. STOP.");
    }
    return { secret, recoveryCode, created: false };
  }
  const secret = new Uint8Array(randomBytes(32));
  const recoveryCode = pqcRecoveryCodeFromSecret(secret);
  const secretHex = Buffer.from(secret).toString("hex");
  const body = [
    "# QoreChain deployer PQC secret material - DO NOT SHARE, DO NOT COMMIT.",
    `# Created ${new Date().toISOString()} by scripts/register-pqc.ts`,
    `DEPLOYER_EVM=${EXPECTED_EVM}`,
    `DEPLOYER_QOR=${EXPECTED_QOR}`,
    `PQC_SECRET_HEX=${secretHex}`,
    `PQC_RECOVERY_CODE=${recoveryCode}`,
    "",
  ].join("\n");
  writeFileSync(PQC_FILE, body, { mode: 0o600 });
  chmodSync(PQC_FILE, 0o600);
  return { secret, recoveryCode, created: true };
}

function buildAccount(): { account: UnifiedAccount; material: PqcSecretMaterial } {
  const keyBytes = loadDeployerKeyBytes();
  const material = loadOrCreatePqcSecret();
  const account = unifiedAccountFromSeed(keyBytes, { pqcSecret: material.secret });
  if (account.evm.toLowerCase() !== EXPECTED_EVM) {
    throw new Error(
      `Derived EVM address mismatch: got ${account.evm}, expected ${EXPECTED_EVM}. STOP.`,
    );
  }
  if (account.cosmos !== EXPECTED_QOR) {
    throw new Error(
      `Derived qor address mismatch: got ${account.cosmos}, expected ${EXPECTED_QOR}. STOP.`,
    );
  }
  // The recovery code alone must reproduce the exact same PQC keypair.
  const fromCode = pqcKeyFromRecoveryCode(material.recoveryCode, account.cosmos);
  if (!bytesEqual(fromCode.publicKey, account.pqc.publicKey)) {
    throw new Error("Recovery code does not reproduce the account PQC key. STOP.");
  }
  return { account, material };
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

async function phaseSecret(): Promise<void> {
  const { material } = buildAccount();
  const mode = statSync(PQC_FILE).mode & 0o777;
  console.log(`pqc secret file: ${material.created ? "CREATED" : "already existed, loaded"}`);
  console.log(`pqc secret file mode: 0o${mode.toString(8)} (required 0o600)`);
  if (mode !== 0o600) throw new Error("PQC secret file mode is not 0600. STOP.");
  console.log(`deployer evm: ${EXPECTED_EVM} (match verified)`);
  console.log(`deployer qor: ${EXPECTED_QOR} (match verified)`);
  console.log("recovery code reproduces the account PQC key: yes");
}

async function phaseRegister(): Promise<void> {
  const { account } = buildAccount();

  const status = await fetchPqcStatus({ rest: REST, address: EXPECTED_QOR });
  if (status.registered) {
    console.log("pqc status: already registered - no broadcast needed.");
    return;
  }
  console.log("pqc status: not registered - proceeding.");

  // Proof of possession only once the network has applied v3.2.3.
  const v323Height = await fetchUpgradeAppliedHeight({
    rest: REST,
    upgrade: CHAIN_UPGRADE_V3_2_3,
  });
  console.log(`upgrade v3.2.3 applied height: ${v323Height}`);
  let proofOfPossession: Uint8Array | undefined;
  if (v323Height > 0n) {
    proofOfPossession = signProofOfPossession({
      chainId: CHAIN_ID,
      account: account.cosmos,
      keypair: account.pqc,
    });
    const ok = verifyProofOfPossession({
      chainId: CHAIN_ID,
      account: account.cosmos,
      publicKey: account.pqc.publicKey,
      algorithmId: 1,
      proof: proofOfPossession,
    });
    console.log(`proof of possession: generated, local verify = ${ok}`);
    if (!ok) throw new Error("Local PoP verification failed. STOP before broadcast.");
  }

  const ecdsaPubkey = hexToBytes(account.publicKey);
  if (ecdsaPubkey.length !== 33) throw new Error("Compressed pubkey is not 33 bytes.");

  const msg = buildRegisterPqcKeyMsg(account.cosmos, {
    pqcKeypair: account.pqc,
    ecdsaPubkey,
    keyType: "hybrid",
    proofOfPossession,
  });

  const { accountNumber, sequence } = await fetchAuthAccount();
  console.log(`auth account: number=${accountNumber} sequence=${sequence}`);

  const signer = new EthNativeSigner(account, { signMode: "classical", rest: REST });
  const fee = calculateFee(GAS_LIMIT, GAS_PRICE);
  console.log(`fee: ${fee.amount[0].amount} ${fee.amount[0].denom}, gas ${fee.gas}`);

  const transport = await StargateClient.connect(RPC);
  try {
    const res = await signer.signAndBroadcast(transport, {
      chainId: CHAIN_ID,
      accountNumber,
      sequence,
      messages: [msg],
      fee,
    });
    console.log(`register tx hash: ${res.transactionHash}`);
    console.log(`register tx code: ${res.code}, height: ${res.height}`);
    if (res.code !== 0) {
      console.error(`register rawLog: ${res.rawLog ?? ""}`);
      throw new Error(`Register tx failed on-chain with code ${res.code}. STOP.`);
    }
  } finally {
    transport.disconnect();
  }

  // Verify via REST.
  for (let i = 0; i < 15; i++) {
    const after = await fetchPqcStatus({ rest: REST, address: EXPECTED_QOR });
    if (after.registered) {
      console.log(
        `verified: pqc registered (algorithmId=${after.algorithmId}, possessionProven=${after.possessionProven})`,
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Broadcast succeeded but REST still shows not registered. STOP.");
}

async function phaseWindow(): Promise<void> {
  const { account } = buildAccount();

  const status = await fetchPqcStatus({ rest: REST, address: EXPECTED_QOR });
  if (!status.registered) throw new Error("PQC key not registered yet. Run register first.");

  const existing = await fetchEvmWindow({ rest: REST, address: EXPECTED_QOR });
  if (existing.found && existing.live) {
    console.log(
      `evm window: already live (expiry height ${existing.expiryHeight}, remaining txs ${existing.remainingTxs}, remaining value ${existing.remainingValue} uqor) - no broadcast needed.`,
    );
    return;
  }
  console.log("evm window: not live - proceeding to open.");

  const msg = openEvmWindowMsg({
    sender: account.cosmos,
    blocks: 17280,
    maxTxs: 10,
    maxValue: "5000000",
  });

  const { accountNumber, sequence } = await fetchAuthAccount();
  console.log(`auth account: number=${accountNumber} sequence=${sequence}`);

  const signer = new EthNativeSigner(account, { signMode: "hybrid", rest: REST });
  const fee = calculateFee(GAS_LIMIT, GAS_PRICE);
  console.log(`fee: ${fee.amount[0].amount} ${fee.amount[0].denom}, gas ${fee.gas}`);

  const transport = await StargateClient.connect(RPC);
  try {
    const res = await signer.signAndBroadcast(transport, {
      chainId: CHAIN_ID,
      accountNumber,
      sequence,
      messages: [msg],
      fee,
    });
    console.log(`window tx hash: ${res.transactionHash}`);
    console.log(`window tx code: ${res.code}, height: ${res.height}`);
    if (res.code !== 0) {
      console.error(`window rawLog: ${res.rawLog ?? ""}`);
      throw new Error(`Open-window tx failed on-chain with code ${res.code}. STOP.`);
    }
  } finally {
    transport.disconnect();
  }

  for (let i = 0; i < 15; i++) {
    const after = await fetchEvmWindow({ rest: REST, address: EXPECTED_QOR });
    if (after.found && after.live) {
      console.log(
        `verified: window live (opened ${after.openedHeight}, expiry ${after.expiryHeight}, remaining txs ${after.remainingTxs}, remaining value ${after.remainingValue} uqor)`,
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Broadcast succeeded but REST still shows window not live. STOP.");
}

async function phaseStatus(): Promise<void> {
  const pqc = await fetchPqcStatus({ rest: REST, address: EXPECTED_QOR });
  const win = await fetchEvmWindow({ rest: REST, address: EXPECTED_QOR });
  const { accountNumber, sequence } = await fetchAuthAccount();
  const balRes = await fetch(`${REST}/cosmos/bank/v1beta1/balances/${EXPECTED_QOR}`);
  const balJson = (await balRes.json()) as { balances: { denom: string; amount: string }[] };
  const uqor = balJson.balances.find((b) => b.denom === "uqor")?.amount ?? "0";
  console.log(`pqc registered: ${pqc.registered} (algorithmId=${pqc.algorithmId})`);
  console.log(
    `evm window: found=${win.found} live=${win.live} expiry=${win.expiryHeight} remainingTxs=${win.remainingTxs} remainingValue=${win.remainingValue} uqor`,
  );
  console.log(`auth: number=${accountNumber} sequence=${sequence}`);
  console.log(`balance: ${uqor} uqor (${Number(uqor) / 1e6} QOR)`);
}

async function main(): Promise<void> {
  const phase = process.argv[2];
  if (phase === "secret") await phaseSecret();
  else if (phase === "register") await phaseRegister();
  else if (phase === "window") await phaseWindow();
  else if (phase === "status") await phaseStatus();
  else throw new Error("Usage: register-pqc.ts <secret|register|window|status>");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
