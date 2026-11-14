/**
 * verify.ts — public verification of a QoreStamp attestation.
 *
 * Anyone can verify a stamp with nothing but public data:
 *   1. Recompute the attestation digest from the claimed public fields
 *      (label, statement, ML-DSA-87 public key) and check it matches.
 *   2. Verify the ML-DSA-87 stamp signature over that digest locally
 *      (pure cryptography — works fully offline).
 *   3. Read the on-chain registry record for the digest and check the
 *      recorded label / PQC key hash agree with the claim.
 *   4. Look up the anchoring native tx on the Cosmos REST API and check it
 *      exists on qorechain-diana.
 *
 * Steps 1–2 need no network. Steps 3–4 are read-only chain queries — no
 * account, no wallet, no funds.
 */
import type { Address, Hex } from "viem";

import {
  buildAttestation,
  attestationDigestBytes,
  attestationDigestHex,
  type Attestation,
} from "./attestation.js";
import { verifyAttestationSignature } from "./pqc.js";
import {
  TESTNET_EVM_RPC_URL,
  TESTNET_REST_URL,
  readStamp,
  type OnChainStamp,
} from "./registry.js";

export interface StampClaim {
  agentLabel: string;
  statement: string;
  /** Raw ML-DSA-87 public key bytes of the attesting agent. */
  pqcPublicKey: Uint8Array;
  /** ML-DSA-87 signature over the attestation digest. */
  signature: Uint8Array;
  chainId?: string;
}

export interface NativeTxInfo {
  hash: string;
  height: number;
  /** Cosmos tx result code; 0 means the tx succeeded on chain. */
  code: number;
}

export interface VerificationReport {
  attestation: Attestation;
  /** Step 1+2: digest recomputed and ML-DSA-87 signature valid. */
  signatureValid: boolean;
  /** Step 3: registry record found for this digest (null when not checked). */
  onChainStamp: OnChainStamp | null;
  /** Registry record fields agree with the claimed attestation. */
  registryMatches: boolean | null;
  /** Step 4: anchoring native tx found on chain (null when not checked). */
  nativeTx: NativeTxInfo | null;
  /** Every check that was performed passed. */
  ok: boolean;
  checks: string[];
}

/** Look up a native (Cosmos-path) tx by hash via the public REST API. */
export async function fetchNativeTx(
  txHash: string,
  restUrl: string = TESTNET_REST_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<NativeTxInfo | null> {
  const res = await fetchImpl(
    `${restUrl.replace(/\/$/, "")}/cosmos/tx/v1beta1/txs/${txHash}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Native tx lookup failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    tx_response?: { txhash: string; height: string; code: number };
  };
  if (!body.tx_response) return null;
  return {
    hash: body.tx_response.txhash,
    height: Number(body.tx_response.height),
    code: body.tx_response.code,
  };
}

export interface VerifyOptions {
  /** Registry contract address; omit to skip the on-chain record check. */
  registryAddress?: Address;
  evmRpcUrl?: string;
  restUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Verify a stamp claim end-to-end. Chain checks run only when a registry
 * address is supplied; the cryptographic checks always run.
 */
export async function verifyStamp(
  claim: StampClaim,
  options: VerifyOptions = {},
): Promise<VerificationReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const checks: string[] = [];

  // Steps 1–2: recompute + signature (offline).
  const attestation = buildAttestation({
    agentLabel: claim.agentLabel,
    statement: claim.statement,
    pqcPublicKey: claim.pqcPublicKey,
    chainId: claim.chainId,
  });
  const digestBytes = attestationDigestBytes(attestation);
  const signatureValid = verifyAttestationSignature(
    claim.pqcPublicKey,
    digestBytes,
    claim.signature,
  );
  checks.push(
    signatureValid
      ? "ML-DSA-87 signature over the attestation digest is valid."
      : "ML-DSA-87 signature over the attestation digest is INVALID.",
  );

  // Step 3: registry record.
  let onChainStamp: OnChainStamp | null = null;
  let registryMatches: boolean | null = null;
  if (options.registryAddress) {
    onChainStamp = await readStamp(
      options.registryAddress,
      attestationDigestHex(attestation) as Hex,
      options.evmRpcUrl ?? TESTNET_EVM_RPC_URL,
      fetchImpl,
    );
    if (onChainStamp === null) {
      registryMatches = false;
      checks.push("No registry record exists for this digest.");
    } else {
      registryMatches =
        onChainStamp.label === attestation.agentLabel &&
        onChainStamp.pqcKeyHash.toLowerCase() ===
          `0x${attestation.pqcPublicKeyHash}`.toLowerCase();
      checks.push(
        registryMatches
          ? "Registry record matches the claimed label and PQC key hash."
          : "Registry record does NOT match the claimed attestation.",
      );
    }
  }

  // Step 4: anchoring native tx (only meaningful with a registry record).
  let nativeTx: NativeTxInfo | null = null;
  if (onChainStamp?.nativeTxHash) {
    nativeTx = await fetchNativeTx(
      onChainStamp.nativeTxHash,
      options.restUrl ?? TESTNET_REST_URL,
      fetchImpl,
    );
    checks.push(
      nativeTx
        ? `Anchoring native tx found at height ${nativeTx.height} (code ${nativeTx.code}).`
        : "Anchoring native tx was NOT found on chain.",
    );
  }

  const ok =
    signatureValid &&
    registryMatches !== false &&
    (onChainStamp === null || nativeTx !== null) &&
    (nativeTx === null || nativeTx.code === 0);

  return { attestation, signatureValid, onChainStamp, registryMatches, nativeTx, ok, checks };
}
