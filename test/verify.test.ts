import { encodeFunctionResult, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { buildAttestation, attestationDigestBytes } from "../src/lib/attestation.js";
import { createStampKeypair, signAttestation } from "../src/lib/pqc.js";
import { registryAbi } from "../src/lib/registry.js";
import { verifyStamp } from "../src/lib/verify.js";

const REGISTRY = "0x1111111111111111111111111111111111111111" as Address;
const NATIVE_TX_HASH = "F".repeat(64);

const keypair = createStampKeypair(new Uint8Array(32).fill(3));
const claim = {
  agentLabel: "gatekeeper-01",
  statement: "I am gatekeeper-01.",
  pqcPublicKey: keypair.publicKey,
};
const attestation = buildAttestation(claim);
const signature = signAttestation(keypair.secretKey, attestationDigestBytes(attestation));

/**
 * Fake fetch routing both transports used by verifyStamp:
 *  - POST JSON-RPC (registry eth_call getStamp)
 *  - GET  REST /cosmos/tx/v1beta1/txs/{hash}
 */
function fakeFetch(opts: { stamped: boolean; nativeTxFound: boolean }) {
  return async (url: unknown, init?: { method?: string; body?: string }) => {
    const u = String(url);
    if (u.includes("/cosmos/tx/v1beta1/txs/")) {
      if (!opts.nativeTxFound) {
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tx_response: { txhash: NATIVE_TX_HASH, height: "10123456", code: 0 },
        }),
      } as Response;
    }
    // JSON-RPC eth_call → getStamp
    const result = encodeFunctionResult({
      abi: registryAbi,
      functionName: "getStamp",
      result: (opts.stamped
        ? [
            "0x2222222222222222222222222222222222222222",
            claim.agentLabel,
            `0x${attestation.pqcPublicKeyHash}`,
            NATIVE_TX_HASH,
            1_763_000_000n,
          ]
        : [
            "0x0000000000000000000000000000000000000000",
            "",
            `0x${"00".repeat(32)}`,
            "",
            0n,
          ]) as never,
    });
    void init;
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: "2.0", id: 1, result }),
    } as Response;
  };
}

describe("verifyStamp", () => {
  it("passes fully offline when no registry is configured", async () => {
    const report = await verifyStamp({ ...claim, signature });
    expect(report.signatureValid).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.onChainStamp).toBeNull();
  });

  it("fails for a signature made by a different key", async () => {
    const other = createStampKeypair(new Uint8Array(32).fill(8));
    const badSig = signAttestation(other.secretKey, attestationDigestBytes(attestation));
    const report = await verifyStamp({ ...claim, signature: badSig });
    expect(report.signatureValid).toBe(false);
    expect(report.ok).toBe(false);
  });

  it("passes end-to-end with a matching registry record and native tx", async () => {
    const report = await verifyStamp(
      { ...claim, signature },
      {
        registryAddress: REGISTRY,
        fetchImpl: fakeFetch({ stamped: true, nativeTxFound: true }) as typeof fetch,
      },
    );
    expect(report.signatureValid).toBe(true);
    expect(report.registryMatches).toBe(true);
    expect(report.nativeTx?.height).toBe(10123456);
    expect(report.ok).toBe(true);
  });

  it("fails when the digest was never stamped", async () => {
    const report = await verifyStamp(
      { ...claim, signature },
      {
        registryAddress: REGISTRY,
        fetchImpl: fakeFetch({ stamped: false, nativeTxFound: false }) as typeof fetch,
      },
    );
    expect(report.registryMatches).toBe(false);
    expect(report.ok).toBe(false);
  });
});
