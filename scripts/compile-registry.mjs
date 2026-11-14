/**
 * compile-registry.mjs — compile contracts/QoreStampRegistry.sol with solc
 * and write contracts/QoreStampRegistry.artifact.ts (ABI + bytecode), the
 * same artifact pattern the official evm-solidity template uses.
 *
 * Run: node scripts/compile-registry.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import solc from "solc";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "contracts", "QoreStampRegistry.sol");
const source = readFileSync(sourcePath, "utf8");

const input = {
  language: "Solidity",
  sources: { "QoreStampRegistry.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors ?? []).filter((e) => e.severity === "error");
if (errors.length > 0) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}

const compiled = output.contracts["QoreStampRegistry.sol"].QoreStampRegistry;
const artifact = `/**
 * Compiled artifact for \`contracts/QoreStampRegistry.sol\`.
 *
 * Generated with solc ${solc.version()} (--optimize, 200 runs) by
 * scripts/compile-registry.mjs. Regenerate after editing the contract.
 * The ABI is exported as a \`const\` tuple so viem can infer typed calls.
 */
import type { Hex } from "viem";

export const registryContractAbi = ${JSON.stringify(compiled.abi, null, 2)} as const;

export const registryBytecode: Hex = "0x${compiled.evm.bytecode.object}";
`;

writeFileSync(join(root, "contracts", "QoreStampRegistry.artifact.ts"), artifact);
console.log(`Wrote contracts/QoreStampRegistry.artifact.ts (solc ${solc.version()})`);
