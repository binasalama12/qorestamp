import { describe, expect, it } from "vitest";

import { buildAttestation, attestationDigestBytes } from "../src/lib/attestation.js";
import {
  HYBRID_SIG_TYPE_URL,
  ML_DSA_87_PUBLIC_KEY_LENGTH,
  ML_DSA_87_SECRET_KEY_LENGTH,
  ML_DSA_87_SIGNATURE_LENGTH,
  buildStampHybridExtension,
  createStampKeypair,
  signAttestation,
  verifyAttestationSignature,
} from "../src/lib/pqc.js";

const seed = new Uint8Array(32).fill(42);

describe("ML-DSA-87 stamp keypair", () => {
  it("produces FIPS 204 sized keys and is deterministic per seed", () => {
    const a = createStampKeypair(seed);
    const b = createStampKeypair(seed);
    expect(a.publicKey).toHaveLength(ML_DSA_87_PUBLIC_KEY_LENGTH);
    expect(a.secretKey).toHaveLength(ML_DSA_87_SECRET_KEY_LENGTH);
    expect(a.publicKey).toEqual(b.publicKey);
    expect(a.secretKey).toEqual(b.secretKey);
  });

  it("rejects a wrong-length secret key when signing", () => {
    const digest = new Uint8Array(32);
    expect(() => signAttestation(new Uint8Array(10), digest)).toThrow();
  });
});

describe("attestation sign / verify roundtrip", () => {
  const keypair = createStampKeypair(seed);
  const attestation = buildAttestation({
    agentLabel: "gatekeeper-01",
    statement: "Attesting my agent identity for the QoreChain builder fest.",
    pqcPublicKey: keypair.publicKey,
  });
  const digest = attestationDigestBytes(attestation);

  it("signs deterministically and verifies", () => {
    const sig1 = signAttestation(keypair.secretKey, digest);
    const sig2 = signAttestation(keypair.secretKey, digest);
    expect(sig1).toHaveLength(ML_DSA_87_SIGNATURE_LENGTH);
    expect(sig1).toEqual(sig2);
    expect(verifyAttestationSignature(keypair.publicKey, digest, sig1)).toBe(true);
  });

  it("fails verification for a tampered digest, wrong key, or bad signature", () => {
    const sig = signAttestation(keypair.secretKey, digest);

    const tampered = new Uint8Array(digest);
    tampered[0] ^= 0xff;
    expect(verifyAttestationSignature(keypair.publicKey, tampered, sig)).toBe(false);

    const other = createStampKeypair(new Uint8Array(32).fill(1));
    expect(verifyAttestationSignature(other.publicKey, digest, sig)).toBe(false);

    const badSig = new Uint8Array(sig);
    badSig[100] ^= 0xff;
    expect(verifyAttestationSignature(keypair.publicKey, digest, badSig)).toBe(false);

    // Strict sizes: a truncated signature must be rejected, not crash.
    expect(verifyAttestationSignature(keypair.publicKey, digest, sig.slice(0, 100))).toBe(false);
  });

  it("builds the on-chain hybrid signature extension", () => {
    const sig = signAttestation(keypair.secretKey, digest);
    const ext = buildStampHybridExtension(sig, keypair.publicKey);
    expect(HYBRID_SIG_TYPE_URL).toBe("/qorechain.pqc.v1.PQCHybridSignature");
    expect(ext.algorithm_id).toBe(1); // AlgorithmDilithium5 = ML-DSA-87
    expect(ext.pqc_signature).toEqual(sig);
    expect(ext.pqc_public_key).toEqual(keypair.publicKey);

    const bare = buildStampHybridExtension(sig);
    expect(bare.pqc_public_key).toBeUndefined();
  });
});
