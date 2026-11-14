/**
 * deploy-registry.ts — deploy QoreStampRegistry to the QoreChain EVM engine
 * (testnet diana, chain id 9800) and smoke-read it.
 *
 * NOT run during scaffolding: it needs a funded EVM account on diana
 * (faucet via dashboard.qorechain.io after fest registration).
 *
 * Requirements:
 *   - QORE_EVM_RPC_URL (defaults to the public testnet EVM endpoint)
 *   - QORE_EVM_PRIVATE_KEY for a funded EVM account (0x-prefixed, 32 bytes)
 *
 * Run: npm run deploy:registry   (reads .env via tsx --env-file)
 */
import {
  createEvmClient,
  deployContract,
  evmAccountFromPrivateKey,
  readContract,
} from "@qorechain/evm";
import type { Hex } from "viem";

import {
  registryBytecode,
  registryContractAbi,
} from "../contracts/QoreStampRegistry.artifact.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const evmRpc = process.env.QORE_EVM_RPC_URL ?? "https://evm-testnet.qore.host";
  const privateKey = requireEnv("QORE_EVM_PRIVATE_KEY") as Hex;

  const client = await createEvmClient({ endpoints: { evmRpc } });
  const account = evmAccountFromPrivateKey(privateKey);
  const wallet = client.getWalletClient(account);

  const chainId = await client.getChainId();
  console.log(`network:  QoreChain EVM (chain id ${chainId})`);
  if (chainId !== 9800) {
    throw new Error(`Expected testnet chain id 9800, got ${chainId}. Refusing to deploy.`);
  }
  console.log(`deployer: ${account.address}`);

  const balance = await client.publicClient.getBalance({ address: account.address });
  console.log(`balance:  ${balance} wei`);
  if (balance === 0n) {
    throw new Error(
      "Deployer account has no funds on diana. Fund it via the dashboard faucet first.",
    );
  }

  console.log("\nDeploying QoreStampRegistry…");
  const deployHash = await deployContract(wallet, {
    abi: registryContractAbi,
    bytecode: registryBytecode,
    args: [],
  });
  const receipt = await client.publicClient.waitForTransactionReceipt({ hash: deployHash });
  const contract = receipt.contractAddress;
  if (!contract) {
    throw new Error("Deployment receipt did not include a contract address.");
  }
  console.log(`deployed: ${contract} (tx ${deployHash})`);

  const count = await readContract(client.publicClient, {
    address: contract,
    abi: registryContractAbi,
    functionName: "stampCount",
    args: [],
  });
  console.log(`stampCount after deploy: ${count}`);
  console.log(`\nSet VITE_QORESTAMP_REGISTRY=${contract} in .env to wire the app.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
