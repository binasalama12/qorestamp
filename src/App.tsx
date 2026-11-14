import { useMemo, useState } from "react";

import { ConnectButton, PqcStatusBadge } from "@qorechain/react";
import type { Address } from "viem";

import {
  attestationDigestBytes,
  attestationDigestHex,
  attestationKeyHashHex,
  buildAttestation,
  type Attestation,
} from "./lib/attestation.js";
import { bytesToHex, hexToBytes } from "./lib/hex.js";
import {
  HYBRID_SIG_TYPE_URL,
  buildStampHybridExtension,
  createStampKeypair,
  signAttestation,
  type PqcKeypair,
} from "./lib/pqc.js";
import { buildStampCalldata } from "./lib/registry.js";
import { verifyStamp, type VerificationReport } from "./lib/verify.js";

const REGISTRY_ADDRESS = (import.meta.env.VITE_QORESTAMP_REGISTRY || undefined) as
  | Address
  | undefined;

const styles = {
  page: {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 860,
    margin: "2rem auto",
    padding: "0 1rem",
    lineHeight: 1.55,
  } as React.CSSProperties,
  card: {
    border: "1px solid #ddd",
    borderRadius: 10,
    padding: "1rem 1.25rem",
    marginTop: "1.25rem",
  } as React.CSSProperties,
  input: {
    width: "100%",
    padding: "0.5rem",
    margin: "0.25rem 0 0.75rem",
    boxSizing: "border-box",
  } as React.CSSProperties,
  mono: {
    fontFamily: "ui-monospace, monospace",
    fontSize: "0.8rem",
    wordBreak: "break-all",
  } as React.CSSProperties,
};

interface StampResult {
  attestation: Attestation;
  signature: Uint8Array;
  calldata: string;
}

export function App(): JSX.Element {
  // --- Stamp panel state -------------------------------------------------
  const [label, setLabel] = useState("gatekeeper-01");
  const [statement, setStatement] = useState(
    "I am gatekeeper-01, an autonomous proof-checking agent in the zkVerify Agent Games.",
  );
  const [stampKeypair, setStampKeypair] = useState<PqcKeypair | null>(null);
  const [stampResult, setStampResult] = useState<StampResult | null>(null);
  const [stampError, setStampError] = useState<string | null>(null);

  // --- Verify panel state ------------------------------------------------
  const [vLabel, setVLabel] = useState("");
  const [vStatement, setVStatement] = useState("");
  const [vPubKeyHex, setVPubKeyHex] = useState("");
  const [vSignatureHex, setVSignatureHex] = useState("");
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const stampPubKeyHex = useMemo(
    () => (stampKeypair ? bytesToHex(stampKeypair.publicKey) : ""),
    [stampKeypair],
  );

  function handleGenerateKeypair(): void {
    setStampError(null);
    setStampResult(null);
    // Demo keypair: generated in-page and kept only in memory. In production
    // the agent's ML-DSA-87 key lives in QoreX and never touches the page.
    setStampKeypair(createStampKeypair());
  }

  function handleStamp(): void {
    setStampError(null);
    if (!stampKeypair) {
      setStampError("Generate a demo ML-DSA-87 keypair first.");
      return;
    }
    try {
      const attestation = buildAttestation({
        agentLabel: label,
        statement,
        pqcPublicKey: stampKeypair.publicKey,
      });
      const signature = signAttestation(
        stampKeypair.secretKey,
        attestationDigestBytes(attestation),
      );
      // The hybrid extension is what the native tx carries; building it here
      // proves the exact object QoreX will attach when it signs the anchor tx.
      buildStampHybridExtension(signature, stampKeypair.publicKey);
      const calldata = buildStampCalldata({
        digest: attestationDigestHex(attestation),
        label: attestation.agentLabel,
        pqcKeyHash: attestationKeyHashHex(attestation),
        nativeTxHash: "<native-tx-hash-from-qorex>",
      });
      setStampResult({ attestation, signature, calldata });
      // Pre-fill the verifier with this stamp so anyone can re-check it.
      setVLabel(attestation.agentLabel);
      setVStatement(statement);
      setVPubKeyHex(bytesToHex(stampKeypair.publicKey));
      setVSignatureHex(bytesToHex(signature));
      setReport(null);
    } catch (err) {
      setStampError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleVerify(): Promise<void> {
    setVerifyError(null);
    setReport(null);
    setVerifying(true);
    try {
      const result = await verifyStamp(
        {
          agentLabel: vLabel,
          statement: vStatement,
          pqcPublicKey: hexToBytes(vPubKeyHex),
          signature: hexToBytes(vSignatureHex),
        },
        REGISTRY_ADDRESS ? { registryAddress: REGISTRY_ADDRESS } : {},
      );
      setReport(result);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <main style={styles.page}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ marginBottom: 0 }}>QoreStamp</h1>
          <p style={{ color: "#555", marginTop: "0.25rem" }}>
            Post-quantum agent identity attestations on QoreChain testnet
            (<code>qorechain-diana</code>, EVM chain 9800).
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <PqcStatusBadge />
          <ConnectButton wallets={["keplr", "evm"]} />
        </div>
      </header>

      <section style={styles.card}>
        <h2>1 · Stamp an attestation</h2>
        <p style={{ color: "#555" }}>
          The attestation digest binds your agent label, statement, and
          ML-DSA-87 public key. It is signed with the PQC key, anchored by a
          hybrid-signed native tx via QoreX, and recorded in the EVM registry —
          so anyone can verify it later from public data alone.
        </p>
        <label>
          Agent label
          <input style={styles.input} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label>
          Statement
          <textarea
            style={styles.input}
            rows={3}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
          />
        </label>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button onClick={handleGenerateKeypair}>
            {stampKeypair ? "Regenerate demo keypair" : "Generate demo ML-DSA-87 keypair"}
          </button>
          <button onClick={handleStamp} disabled={!stampKeypair}>
            Build + sign attestation
          </button>
        </div>
        {stampKeypair && (
          <p style={styles.mono}>
            demo public key (2592 bytes, hex): {stampPubKeyHex.slice(0, 64)}…
          </p>
        )}
        {stampError && <p style={{ color: "#b00" }}>{stampError}</p>}
        {stampResult && (
          <div style={styles.mono}>
            <p>digest: 0x{stampResult.attestation.digest}</p>
            <p>statement hash: {stampResult.attestation.statementHash}</p>
            <p>pqc key hash: {stampResult.attestation.pqcPublicKeyHash}</p>
            <p>
              signature: {stampResult.signature.length} bytes · hybrid extension:{" "}
              {HYBRID_SIG_TYPE_URL}
            </p>
            <p>registry stamp() calldata: {stampResult.calldata.slice(0, 80)}…</p>
            <p style={{ fontFamily: "inherit", color: "#555" }}>
              Next steps (need the registered QoreX account): send the
              hybrid-signed native anchor tx in QoreX, then submit this
              calldata to the registry with the resulting tx hash.
            </p>
          </div>
        )}
      </section>

      <section style={styles.card}>
        <h2>2 · Verify a stamp</h2>
        <p style={{ color: "#555" }}>
          Pure public-data verification: the digest is recomputed and the
          ML-DSA-87 signature checked locally
          {REGISTRY_ADDRESS
            ? ", and the registry record + anchoring native tx are read back from chain."
            : ". Set VITE_QORESTAMP_REGISTRY to also check the on-chain registry record."}
        </p>
        <label>
          Agent label
          <input style={styles.input} value={vLabel} onChange={(e) => setVLabel(e.target.value)} />
        </label>
        <label>
          Statement
          <textarea
            style={styles.input}
            rows={3}
            value={vStatement}
            onChange={(e) => setVStatement(e.target.value)}
          />
        </label>
        <label>
          ML-DSA-87 public key (hex)
          <textarea
            style={{ ...styles.input, ...styles.mono }}
            rows={3}
            value={vPubKeyHex}
            onChange={(e) => setVPubKeyHex(e.target.value)}
          />
        </label>
        <label>
          Signature (hex)
          <textarea
            style={{ ...styles.input, ...styles.mono }}
            rows={3}
            value={vSignatureHex}
            onChange={(e) => setVSignatureHex(e.target.value)}
          />
        </label>
        <button onClick={handleVerify} disabled={verifying}>
          {verifying ? "Verifying…" : "Verify"}
        </button>
        {verifyError && <p style={{ color: "#b00" }}>{verifyError}</p>}
        {report && (
          <div>
            <p>
              <strong>{report.ok ? "✅ Stamp is valid" : "❌ Stamp failed verification"}</strong>
            </p>
            <ul>
              {report.checks.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p style={styles.mono}>digest: 0x{report.attestation.digest}</p>
          </div>
        )}
      </section>

      <footer style={{ color: "#777", marginTop: "2rem", fontSize: "0.9rem" }}>
        QoreStamp · Build Before Q-Day — Quantum Pass · MIT licensed · Keys stay
        in QoreX in production; the in-page keypair is a demo only.
      </footer>
    </main>
  );
}
