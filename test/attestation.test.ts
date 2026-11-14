import { describe, expect, it } from "vitest";

import {
  TARGET_CHAIN_ID,
  attestationDigestBytes,
  attestationDigestHex,
  attestationKeyHashHex,
  buildAttestation,
} from "../src/lib/attestation.js";
import { createStampKeypair } from "../src/lib/pqc.js";

const keypair = createStampKeypair(new Uint8Array(32).fill(7));

const baseInput = {
  agentLabel: "gatekeeper-01",
  statement: "I am gatekeeper-01, an autonomous proof-checking agent.",
  pqcPublicKey: keypair.publicKey,
};

describe("buildAttestation", () => {
  it("is deterministic for identical inputs", () => {
    const a = buildAttestation(baseInput);
    const b = buildAttestation(baseInput);
    expect(a.digest).toBe(b.digest);
    expect(a.canonical).toBe(b.canonical);
  });

  it("defaults to qorechain-diana and produces a 32-byte digest", () => {
    const a = buildAttestation(baseInput);
    expect(a.chainId).toBe(TARGET_CHAIN_ID);
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(attestationDigestBytes(a)).toHaveLength(32);
    expect(attestationDigestHex(a)).toBe(`0x${a.digest}`);
  });

  it("changes the digest when any committed field changes", () => {
    const base = buildAttestation(baseInput).digest;
    expect(buildAttestation({ ...baseInput, agentLabel: "gatekeeper-02" }).digest).not.toBe(base);
    expect(buildAttestation({ ...baseInput, statement: "A different claim." }).digest).not.toBe(base);
    expect(buildAttestation({ ...baseInput, chainId: "qorechain-vladi" }).digest).not.toBe(base);
    const otherKey = createStampKeypair(new Uint8Array(32).fill(9));
    expect(buildAttestation({ ...baseInput, pqcPublicKey: otherKey.publicKey }).digest).not.toBe(base);
  });

  it("commits to the statement and key by hash, not by raw content", () => {
    const a = buildAttestation(baseInput);
    expect(a.canonical).not.toContain(baseInput.statement);
    expect(a.canonical).toContain(a.statementHash);
    expect(a.canonical).toContain(a.pqcPublicKeyHash);
    expect(attestationKeyHashHex(a)).toBe(`0x${a.pqcPublicKeyHash}`);
  });

  it("rejects empty labels and newline injection", () => {
    expect(() => buildAttestation({ ...baseInput, agentLabel: "  " })).toThrow();
    expect(() => buildAttestation({ ...baseInput, agentLabel: "a\nchain:evil" })).toThrow();
    expect(() => buildAttestation({ ...baseInput, pqcPublicKey: new Uint8Array(0) })).toThrow();
  });
});
