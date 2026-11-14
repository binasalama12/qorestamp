/**
 * pqc.ts — ML-DSA-87 (Dilithium-5, FIPS 204) operations for QoreStamp,
 * delegated to the official @qorechain/sdk so the byte formats always match
 * what the chain's own PQC verifier accepts.
 *
 * In production the agent's keys live in QoreX and signing happens there.
 * These helpers exist so the attestation flow (build → sign → verify) can be
 * implemented and tested end-to-end locally, and so any verifier can check a
 * stamp signature with nothing but the public key.
 */
import {
  AlgorithmDilithium5,
  HYBRID_SIG_TYPE_URL,
  ML_DSA_87_PUBLIC_KEY_LENGTH,
  ML_DSA_87_SECRET_KEY_LENGTH,
  ML_DSA_87_SIGNATURE_LENGTH,
  buildHybridSignatureExtension,
  generatePqcKeypair,
  pqcSign,
  pqcVerify,
  type PqcKeypair,
  type PQCHybridSignature,
} from "@qorechain/sdk";

export {
  HYBRID_SIG_TYPE_URL,
  ML_DSA_87_PUBLIC_KEY_LENGTH,
  ML_DSA_87_SECRET_KEY_LENGTH,
  ML_DSA_87_SIGNATURE_LENGTH,
};
export type { PqcKeypair, PQCHybridSignature };

/**
 * Generate a fresh ML-DSA-87 stamp keypair.
 * Pass a 32-byte seed for deterministic keygen (e.g. derived from a wallet);
 * omit it for a random keypair. The secret key must never leave the device.
 */
export function createStampKeypair(seed?: Uint8Array): PqcKeypair {
  return generatePqcKeypair(seed);
}

/**
 * Sign an attestation digest (32 raw bytes) with an ML-DSA-87 secret key.
 * The SDK signs deterministically by default, so the same key + digest always
 * yields the same 4627-byte signature.
 */
export function signAttestation(secretKey: Uint8Array, digest: Uint8Array): Uint8Array {
  if (secretKey.length !== ML_DSA_87_SECRET_KEY_LENGTH) {
    throw new Error(
      `ML-DSA-87 secret key must be ${ML_DSA_87_SECRET_KEY_LENGTH} bytes, got ${secretKey.length}.`,
    );
  }
  if (digest.length !== 32) {
    throw new Error(`Attestation digest must be 32 bytes, got ${digest.length}.`);
  }
  return pqcSign(secretKey, digest);
}

/**
 * Verify a stamp signature against the signer's ML-DSA-87 public key.
 * Returns false (never throws) for malformed keys/signatures, matching the
 * chain verifier's strict-length behaviour.
 */
export function verifyAttestationSignature(
  publicKey: Uint8Array,
  digest: Uint8Array,
  signature: Uint8Array,
): boolean {
  if (digest.length !== 32) return false;
  return pqcVerify(publicKey, digest, signature);
}

/**
 * Build the on-chain PQCHybridSignature TX extension for a stamp signature.
 * This is the object the native (Cosmos-path) tx builder attaches under
 * HYBRID_SIG_TYPE_URL so the tx counts as hybrid-signed. Broadcasting such a
 * tx requires a funded account whose ML-DSA-87 key is registered — in the
 * QoreStamp flow that signing happens inside QoreX (see STATUS.md).
 */
export function buildStampHybridExtension(
  signature: Uint8Array,
  publicKey?: Uint8Array,
): PQCHybridSignature {
  return buildHybridSignatureExtension({
    algorithmId: AlgorithmDilithium5,
    signature,
    publicKey,
  });
}
