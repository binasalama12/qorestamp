/**
 * registry.ts — read/write access to the QoreStampRegistry EVM contract.
 *
 * Reads are plain JSON-RPC `eth_call`s against the public testnet EVM
 * endpoint, so verification works from any environment with no wallet and no
 * account. Writes (`stamp`) need a funded EVM account and are only wired up
 * in scripts/deploy-registry.ts and the browser app via a connected wallet —
 * this module deliberately exposes the read path plus calldata builders.
 */
import {
  decodeFunctionResult,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";

import { registryContractAbi } from "../../contracts/QoreStampRegistry.artifact.js";

/** Public EVM JSON-RPC endpoint for qorechain-diana (chain id 9800). */
export const TESTNET_EVM_RPC_URL = "https://evm-testnet.qore.host";
export const TESTNET_REST_URL = "https://api-testnet.qore.host";
export const TESTNET_RPC_URL = "https://rpc-testnet.qore.host";
export const TESTNET_EVM_CHAIN_ID = 9800;

/** The registry ABI, taken from the compiled contract artifact. */
export const registryAbi = registryContractAbi;

export interface OnChainStamp {
  stamper: Address;
  label: string;
  pqcKeyHash: Hex;
  nativeTxHash: string;
  /** Unix seconds; 0 means the digest was never stamped. */
  timestamp: number;
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

async function rpcCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new Error(`EVM RPC ${method} failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as JsonRpcResponse<T>;
  if (body.error) {
    throw new Error(`EVM RPC ${method} failed: ${body.error.message}`);
  }
  return body.result as T;
}

/** Current EVM chain id reported by the endpoint (expect 9800 on diana). */
export async function getEvmChainId(
  rpcUrl: string = TESTNET_EVM_RPC_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const hex = await rpcCall<string>(rpcUrl, "eth_chainId", [], fetchImpl);
  return Number.parseInt(hex, 16);
}

/** Build the calldata for a `stamp(...)` write (signing is the caller's job). */
export function buildStampCalldata(args: {
  digest: Hex;
  label: string;
  pqcKeyHash: Hex;
  nativeTxHash: string;
}): Hex {
  return encodeFunctionData({
    abi: registryAbi,
    functionName: "stamp",
    args: [args.digest, args.label, args.pqcKeyHash, args.nativeTxHash],
  });
}

/**
 * Read a stamp from the registry. Returns null when the digest was never
 * stamped (zero timestamp), so callers can distinguish "absent" from data.
 */
export async function readStamp(
  registryAddress: Address,
  digest: Hex,
  rpcUrl: string = TESTNET_EVM_RPC_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<OnChainStamp | null> {
  const data = encodeFunctionData({
    abi: registryAbi,
    functionName: "getStamp",
    args: [digest],
  });
  const raw = await rpcCall<Hex>(
    rpcUrl,
    "eth_call",
    [{ to: registryAddress, data }, "latest"],
    fetchImpl,
  );
  const [stamper, label, pqcKeyHash, nativeTxHash, timestamp] =
    decodeFunctionResult({
      abi: registryAbi,
      functionName: "getStamp",
      data: raw,
    });
  if (timestamp === 0n) return null;
  return {
    stamper,
    label,
    pqcKeyHash,
    nativeTxHash,
    timestamp: Number(timestamp),
  };
}

/** Digest of the stamp stored at `index` (0-based, in stamping order). */
export async function readDigestAt(
  registryAddress: Address,
  index: number,
  rpcUrl: string = TESTNET_EVM_RPC_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<Hex> {
  const data = encodeFunctionData({
    abi: registryAbi,
    functionName: "digestAt",
    args: [BigInt(index)],
  });
  const raw = await rpcCall<Hex>(
    rpcUrl,
    "eth_call",
    [{ to: registryAddress, data }, "latest"],
    fetchImpl,
  );
  return decodeFunctionResult({
    abi: registryAbi,
    functionName: "digestAt",
    data: raw,
  }) as Hex;
}

/** Total stamps recorded in the registry. */
export async function readStampCount(
  registryAddress: Address,
  rpcUrl: string = TESTNET_EVM_RPC_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const data = encodeFunctionData({
    abi: registryAbi,
    functionName: "stampCount",
    args: [],
  });
  const raw = await rpcCall<Hex>(
    rpcUrl,
    "eth_call",
    [{ to: registryAddress, data }, "latest"],
    fetchImpl,
  );
  const count = decodeFunctionResult({
    abi: registryAbi,
    functionName: "stampCount",
    data: raw,
  });
  return Number(count);
}
