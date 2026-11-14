import { describe, expect, it } from "vitest";

import {
  TESTNET_EVM_RPC_URL,
  TESTNET_REST_URL,
  getEvmChainId,
} from "../src/lib/registry.js";

/**
 * Read-only live checks against the public qorechain-diana endpoints.
 * Opt-in: run with QORE_LIVE=1 npm test — no account, no funds, no writes.
 */
const LIVE = process.env.QORE_LIVE === "1";

describe.skipIf(!LIVE)("live qorechain-diana endpoints (read-only)", () => {
  it("EVM RPC reports chain id 9800", async () => {
    await expect(getEvmChainId(TESTNET_EVM_RPC_URL)).resolves.toBe(9800);
  });

  it("REST node_info reports the qorechain-diana network", async () => {
    const res = await fetch(`${TESTNET_REST_URL}/cosmos/base/tendermint/v1beta1/node_info`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { default_node_info: { network: string } };
    expect(body.default_node_info.network).toBe("qorechain-diana");
  });
});
