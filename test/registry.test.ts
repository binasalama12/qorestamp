import { encodeFunctionResult, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import {
  buildStampCalldata,
  readStamp,
  readStampCount,
  registryAbi,
} from "../src/lib/registry.js";

const REGISTRY = "0x1111111111111111111111111111111111111111" as Address;
const DIGEST = `0x${"ab".repeat(32)}` as Hex;
const KEY_HASH = `0x${"cd".repeat(32)}` as Hex;
const STAMPER = "0x2222222222222222222222222222222222222222" as Address;

/** A fake fetch that answers eth_call with a pre-encoded getStamp result. */
function fakeEthCallFetch(getStampResult: readonly unknown[]) {
  return async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { method: string };
    if (body.method !== "eth_call") throw new Error(`unexpected method ${body.method}`);
    const result = encodeFunctionResult({
      abi: registryAbi,
      functionName: "getStamp",
      result: getStampResult as never,
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: "2.0", id: 1, result }),
    } as Response;
  };
}

describe("registry calldata", () => {
  it("builds stamp() calldata carrying the digest and fields", () => {
    const data = buildStampCalldata({
      digest: DIGEST,
      label: "gatekeeper-01",
      pqcKeyHash: KEY_HASH,
      nativeTxHash: "ABC123",
    });
    // Function selector for stamp(bytes32,string,bytes32,string) + digest inline.
    expect(data.startsWith("0x")).toBe(true);
    expect(data).toContain("ab".repeat(32));
    expect(data).toContain("cd".repeat(32));
    expect(data.length).toBeGreaterThan(10 + 64 * 2);
  });
});

describe("readStamp", () => {
  it("decodes a stamped record", async () => {
    const fetchImpl = fakeEthCallFetch([
      STAMPER,
      "gatekeeper-01",
      KEY_HASH,
      "DEADBEEF",
      1_763_000_000n,
    ]);
    const stamp = await readStamp(REGISTRY, DIGEST, "http://rpc.invalid", fetchImpl as typeof fetch);
    expect(stamp).not.toBeNull();
    expect(stamp?.stamper).toBe(STAMPER);
    expect(stamp?.label).toBe("gatekeeper-01");
    expect(stamp?.pqcKeyHash.toLowerCase()).toBe(KEY_HASH);
    expect(stamp?.nativeTxHash).toBe("DEADBEEF");
    expect(stamp?.timestamp).toBe(1_763_000_000);
  });

  it("returns null for a never-stamped digest (zero timestamp)", async () => {
    const fetchImpl = fakeEthCallFetch([
      "0x0000000000000000000000000000000000000000",
      "",
      `0x${"00".repeat(32)}`,
      "",
      0n,
    ]);
    const stamp = await readStamp(REGISTRY, DIGEST, "http://rpc.invalid", fetchImpl as typeof fetch);
    expect(stamp).toBeNull();
  });

  it("reads the stamp count", async () => {
    const fetchImpl = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: encodeFunctionResult({
            abi: registryAbi,
            functionName: "stampCount",
            result: 3n as never,
          }),
        }),
      }) as Response;
    await expect(
      readStampCount(REGISTRY, "http://rpc.invalid", fetchImpl as typeof fetch),
    ).resolves.toBe(3);
  });
});
