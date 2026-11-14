/**
 * attestation.ts — the QoreStamp attestation record and its canonical digest.
 *
 * An attestation binds four things together:
 *   - an agent label (human-readable, e.g. "gatekeeper-01"),
 *   - a statement (free text: what the agent claims / who it is),
 *   - the agent's ML-DSA-87 (Dilithium-5) public key, by hash,
 *   - the chain it belongs to.
 *
 * The digest is computed over a canonical, domain-separated text encoding so
 * the exact same 32 bytes can be:
 *   1. signed with the agent's ML-DSA-87 secret key (the "stamp signature"),
 *   2. embedded in the hybrid-signed native tx flow, and
 *   3. used as the key in the EVM QoreStampRegistry contract.
 *
 * Anyone can recompute the digest from the public fields and check that the
 * on-chain record, the signature, and the claim all refer to the same thing.
 */
import { sha256, sha256Hex } from "@qorechain/sdk";

/** Domain separator — every QoreStamp digest starts from this string. */
export const ATTESTATION_DOMAIN = "qorestamp:attestation:v1";

/** The chain QoreStamp targets. */
export const TARGET_CHAIN_ID = "qorechain-diana";

export interface AttestationInput {
  /** Human-readable agent label, e.g. "gatekeeper-01". */
  agentLabel: string;
  /** Free-text statement being attested. */
  statement: string;
  /** Raw ML-DSA-87 public key bytes (2592 bytes on QoreChain). */
  pqcPublicKey: Uint8Array;
  /** Cosmos chain id the attestation is anchored to. */
  chainId?: string;
}

export interface Attestation {
  version: 1;
  chainId: string;
  agentLabel: string;
  /** sha256 hex of the UTF-8 statement. */
  statementHash: string;
  /** sha256 hex of the raw ML-DSA-87 public key bytes. */
  pqcPublicKeyHash: string;
  /** The canonical text that was hashed to produce `digest`. */
  canonical: string;
  /** sha256 of `canonical` — 32 bytes, hex (no 0x prefix). */
  digest: string;
}

/** sha256 hex without the SDK's 0x prefix — digests in QoreStamp are bare hex. */
function sha256BareHex(input: Uint8Array): string {
  const hex = sha256Hex(input);
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function assertNonEmpty(name: string, value: string): void {
  if (!value || !value.trim()) {
    throw new Error(`Attestation field "${name}" must not be empty.`);
  }
  if (value.includes("\n")) {
    throw new Error(`Attestation field "${name}" must not contain newlines.`);
  }
}

/**
 * Build an attestation and its digest from public inputs.
 * Deterministic: the same inputs always produce the same digest.
 */
export function buildAttestation(input: AttestationInput): Attestation {
  const chainId = input.chainId ?? TARGET_CHAIN_ID;
  assertNonEmpty("agentLabel", input.agentLabel);
  assertNonEmpty("chainId", chainId);
  if (!(input.pqcPublicKey instanceof Uint8Array) || input.pqcPublicKey.length === 0) {
    throw new Error("pqcPublicKey must be a non-empty Uint8Array.");
  }

  const statementHash = sha256BareHex(new TextEncoder().encode(input.statement));
  const pqcPublicKeyHash = sha256BareHex(input.pqcPublicKey);

  const canonical = [
    ATTESTATION_DOMAIN,
    `chain:${chainId}`,
    `label:${input.agentLabel.trim()}`,
    `statement:${statementHash}`,
    `pqc-key:${pqcPublicKeyHash}`,
  ].join("\n");

  const digest = sha256BareHex(new TextEncoder().encode(canonical));

  return {
    version: 1,
    chainId,
    agentLabel: input.agentLabel.trim(),
    statementHash,
    pqcPublicKeyHash,
    canonical,
    digest,
  };
}

/** The digest as raw bytes — the exact message that gets ML-DSA signed. */
export function attestationDigestBytes(attestation: Attestation): Uint8Array {
  return sha256(new TextEncoder().encode(attestation.canonical));
}

/** The digest as a 0x-prefixed bytes32 hex string, for the EVM registry. */
export function attestationDigestHex(attestation: Attestation): `0x${string}` {
  return `0x${attestation.digest}`;
}

/** The PQC public-key hash as a 0x-prefixed bytes32 hex string. */
export function attestationKeyHashHex(attestation: Attestation): `0x${string}` {
  return `0x${attestation.pqcPublicKeyHash}`;
}
