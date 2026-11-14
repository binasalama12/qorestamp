import { describe, expect, it } from "vitest";

import { bytesToHex, hexToBytes } from "../src/lib/hex.js";

describe("hex helpers", () => {
  it("roundtrips bytes", () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 255]);
    expect(bytesToHex(bytes)).toBe("00010f10ff");
    expect(hexToBytes("00010f10ff")).toEqual(bytes);
    expect(hexToBytes("0x00010f10ff")).toEqual(bytes);
  });

  it("rejects malformed hex", () => {
    expect(() => hexToBytes("abc")).toThrow();
    expect(() => hexToBytes("zz")).toThrow();
  });
});
