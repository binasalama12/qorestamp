import { useCallback, useEffect, useRef, useState } from "react";

import type { Address, Hex } from "viem";

import {
  attestationDigestBytes,
  attestationDigestHex,
  buildAttestation,
} from "./lib/attestation.js";
import { hexToBytes } from "./lib/hex.js";
import { verifyAttestationSignature } from "./lib/pqc.js";
import {
  TESTNET_EVM_RPC_URL,
  getEvmChainId,
  readDigestAt,
  readStamp,
  readStampCount,
  type OnChainStamp,
} from "./lib/registry.js";
import evidence from "../stamp-first-evidence.json";

/**
 * QoreStamp — public demo.
 *
 * Everything on this page is either read live from the QoreStampRegistry
 * contract on qorechain-diana (plain `eth_call`s to the public EVM RPC —
 * no wallet, no account) or recomputed locally in the visitor's browser
 * (the ML-DSA-87 signature check is pure cryptography). The one fact that
 * cannot be re-fetched from a browser — the anchor tx's height — is cited
 * from the published evidence file and labelled as such: the chain's REST
 * and native RPC endpoints send no CORS headers.
 */

const REGISTRY_ADDRESS = (import.meta.env.VITE_QORESTAMP_REGISTRY ||
  "0xbbfcc2956dc59fc38ffa9ac154f3ee81b1d64832") as Address;
const REPO_URL = "https://github.com/binasalama12/qorestamp";
const VIDEO_URL = "https://youtu.be/mmNhUfOm7uQ";
const DEPLOY_TX =
  "0x68ca922c2aef08bf39c12a4ed6877ff1e9796bef5d7195f58469bf86576dc932";

const FIRST_STAMP = {
  label: evidence.label,
  statement: evidence.statement,
  pqcPublicKeyHex: evidence.pqcPublicKeyHex,
  signatureHex: evidence.signatureHex,
  evmTxHash: evidence.evmTxHash,
  nativeTxHeight: evidence.nativeTxHeight,
  stamperQor: evidence.stamperQor,
};

type StepState = "pending" | "running" | "ok" | "fail" | "info";

interface CheckStep {
  title: string;
  detail: string;
  state: StepState;
}

interface LiveData {
  chainId: number;
  stampCount: number;
  firstDigest: Hex;
  firstStamp: OnChainStamp;
  steps: CheckStep[];
  ok: boolean;
  checkedAt: Date;
}

const css = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #070b16; color: #e6ecf5;
    font-family: ui-sans-system, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  a { color: #7dd3fc; }
  .wrap { max-width: 1020px; margin: 0 auto; padding: 0 1.25rem 4rem; }
  .topbar { display: flex; justify-content: space-between; align-items: center;
    padding: 1.1rem 0; flex-wrap: wrap; gap: 0.75rem; }
  .brand { font-weight: 800; font-size: 1.25rem; letter-spacing: -0.02em; }
  .brand span { background: linear-gradient(90deg, #a78bfa, #22d3ee);
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  .toplinks { display: flex; gap: 1rem; font-size: 0.92rem; }
  .toplinks a { color: #c4cfdf; text-decoration: none; }
  .toplinks a:hover { color: #fff; }
  .hero { text-align: center; padding: 3.2rem 0 2.2rem; }
  .hero h1 { font-size: clamp(2.1rem, 5.5vw, 3.4rem); line-height: 1.08;
    letter-spacing: -0.03em; margin: 0 0 1rem; }
  .hero h1 em { font-style: normal; background: linear-gradient(90deg, #a78bfa, #22d3ee);
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  .hero p { color: #a9b8cf; font-size: 1.12rem; max-width: 680px; margin: 0 auto; line-height: 1.6; }
  .chips { display: flex; gap: 0.6rem; justify-content: center; flex-wrap: wrap; margin: 1.6rem 0; }
  .chip { border: 1px solid #22314f; background: #0d1526; border-radius: 999px;
    padding: 0.38rem 0.85rem; font-size: 0.86rem; color: #c4cfdf;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .chip b { color: #fff; font-weight: 600; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: #34d399; margin-right: 0.45rem; animation: pulse 2s infinite; }
  @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.35; } 100% { opacity: 1; } }
  .cta { display: flex; gap: 0.7rem; justify-content: center; flex-wrap: wrap; }
  .btn { display: inline-block; padding: 0.7rem 1.3rem; border-radius: 10px;
    font-weight: 600; text-decoration: none; font-size: 0.98rem; border: 1px solid transparent; }
  .btn-primary { background: linear-gradient(90deg, #7c5cff, #0ea5c8); color: #fff; }
  .btn-ghost { border-color: #2a3a5c; color: #dbe4f2; background: #0d1526; }
  .card { background: #0c1322; border: 1px solid #1d2a45; border-radius: 16px;
    padding: 1.6rem; margin-top: 1.6rem; }
  .card h2 { margin: 0 0 0.4rem; font-size: 1.35rem; letter-spacing: -0.01em; }
  .card .sub { color: #93a4bd; margin: 0 0 1.2rem; line-height: 1.55; }
  .verdict { border-radius: 12px; padding: 1rem 1.2rem; font-weight: 700; font-size: 1.08rem;
    display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; align-items: center; }
  .verdict.ok { background: rgba(52, 211, 153, 0.12); border: 1px solid rgba(52, 211, 153, 0.45); color: #6ee7b7; }
  .verdict.bad { background: rgba(248, 113, 113, 0.10); border: 1px solid rgba(248, 113, 113, 0.45); color: #fca5a5; }
  .verdict.wait { background: #101a2e; border: 1px solid #22314f; color: #a9b8cf; }
  .verdict small { font-weight: 400; font-size: 0.82rem; opacity: 0.85; }
  .steps { list-style: none; margin: 1.2rem 0 0; padding: 0; }
  .steps li { display: flex; gap: 0.8rem; padding: 0.55rem 0; border-top: 1px solid #16223c; }
  .steps li:first-child { border-top: none; }
  .ic { flex: 0 0 1.4rem; text-align: center; }
  .steps .t { font-weight: 600; }
  .steps .d { color: #93a4bd; font-size: 0.9rem; line-height: 1.5; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 0.9rem 1.6rem; margin-top: 1.2rem; }
  .field .k { color: #7e90ad; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem;
    word-break: break-all; color: #d7e1ef; }
  .row { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;
    padding: 0.65rem 0; border-top: 1px solid #16223c; }
  .row:first-of-type { border-top: none; }
  .row .k { color: #93a4bd; flex: 0 0 190px; font-size: 0.92rem; }
  .row .v { flex: 1; text-align: right; }
  .copy { background: #16223c; color: #c4cfdf; border: 1px solid #2a3a5c; border-radius: 6px;
    font-size: 0.72rem; padding: 0.18rem 0.55rem; cursor: pointer; margin-left: 0.5rem; white-space: nowrap; }
  .copy:hover { color: #fff; border-color: #3b5484; }
  .how { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1rem; }
  .step-card { background: #0d1526; border: 1px solid #1d2a45; border-radius: 12px; padding: 1.1rem; }
  .step-card .n { font-size: 0.8rem; color: #7dd3fc; font-weight: 700; letter-spacing: 0.08em; }
  .step-card h3 { margin: 0.35rem 0 0.45rem; font-size: 1.05rem; }
  .step-card p { margin: 0; color: #93a4bd; font-size: 0.9rem; line-height: 1.55; }
  label.f { display: block; color: #a9b8cf; font-size: 0.9rem; margin-top: 0.9rem; }
  input.f, textarea.f { width: 100%; margin-top: 0.3rem; background: #0a111f; color: #e6ecf5;
    border: 1px solid #22314f; border-radius: 8px; padding: 0.55rem 0.7rem; font: inherit; }
  textarea.f { font-family: ui-monospace, Menlo, monospace; font-size: 0.75rem; }
  button.run { margin-top: 1.1rem; background: linear-gradient(90deg, #7c5cff, #0ea5c8);
    color: #fff; border: none; border-radius: 10px; padding: 0.7rem 1.4rem;
    font-weight: 600; font-size: 0.98rem; cursor: pointer; }
  button.run:disabled { opacity: 0.55; cursor: wait; }
  .note { color: #7e90ad; font-size: 0.84rem; line-height: 1.55; }
  .err { color: #fca5a5; }
  footer { margin-top: 3rem; border-top: 1px solid #16223c; padding-top: 1.4rem;
    color: #7e90ad; font-size: 0.9rem; display: flex; justify-content: space-between;
    gap: 1rem; flex-wrap: wrap; }
  footer a { color: #a9b8cf; }
`;

function CopyButton({ value }: { value: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
    >
      {copied ? "copied ✓" : "copy"}
    </button>
  );
}

function MonoRow({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div className="row">
      <div className="k">{k}</div>
      <div className="v mono">
        {v}
        <CopyButton value={v} />
      </div>
    </div>
  );
}

interface Claim {
  label: string;
  statement: string;
  pqcPublicKeyHex: string;
  signatureHex: string;
}

/**
 * The public verification pipeline, mirroring src/lib/verify.ts steps 1–3
 * plus the anchor reference carried inside the registry record itself.
 * (verify.ts step 4 re-reads the anchor tx over the chain REST API, which
 * sends no CORS headers and so cannot run from a browser page.)
 */
async function runPublicVerification(
  claim: Claim,
  onStep: (steps: CheckStep[]) => void,
): Promise<{ steps: CheckStep[]; stamp: OnChainStamp | null; digest: Hex }> {
  const steps: CheckStep[] = [
    { title: "Digest recomputed", detail: "Rebuilding the canonical attestation record from the public fields…", state: "running" },
    { title: "ML-DSA-87 signature", detail: "Checking the post-quantum signature locally…", state: "pending" },
    { title: "Registry record", detail: "Reading the on-chain record via eth_call…", state: "pending" },
    { title: "Anchor reference", detail: "Reading the anchoring native tx hash from the registry record…", state: "pending" },
  ];
  const emit = () => onStep([...steps]);

  const attestation = buildAttestation({
    agentLabel: claim.label,
    statement: claim.statement,
    pqcPublicKey: hexToBytes(claim.pqcPublicKeyHex),
  });
  const digest = attestationDigestHex(attestation) as Hex;
  steps[0] = {
    title: "Digest recomputed",
    detail: `SHA-256 over the canonical record (label + statement hash + ML-DSA-87 key hash + chain) = 0x${attestation.digest}`,
    state: "ok",
  };
  emit();

  steps[1] = { ...steps[1], state: "running" };
  emit();
  // Let the UI paint before the (fast but real) ML-DSA verification runs.
  await new Promise((r) => setTimeout(r, 30));
  const signatureValid = verifyAttestationSignature(
    hexToBytes(claim.pqcPublicKeyHex),
    attestationDigestBytes(attestation),
    hexToBytes(claim.signatureHex),
  );
  steps[1] = {
    title: "ML-DSA-87 signature",
    detail: signatureValid
      ? "Signature over the digest is valid — verified with pure cryptography in this browser, no network involved."
      : "Signature over the digest is INVALID.",
    state: signatureValid ? "ok" : "fail",
  };
  emit();

  steps[2] = { ...steps[2], state: "running" };
  emit();
  const stamp = await readStamp(REGISTRY_ADDRESS, digest);
  if (stamp === null) {
    steps[2] = {
      title: "Registry record",
      detail: "No registry record exists for this digest — the attestation was never stamped on chain.",
      state: "fail",
    };
    steps[3] = { title: "Anchor reference", detail: "Skipped — no registry record.", state: "info" };
    emit();
    return { steps, stamp, digest };
  }
  const matches =
    stamp.label === attestation.agentLabel &&
    stamp.pqcKeyHash.toLowerCase() === `0x${attestation.pqcPublicKeyHash}`.toLowerCase();
  steps[2] = {
    title: "Registry record",
    detail: matches
      ? `Record found: label “${stamp.label}”, stamper ${stamp.stamper}, recorded ${new Date(stamp.timestamp * 1000).toISOString()}. Label and PQC key hash match the claim.`
      : "A record exists for this digest but its label / PQC key hash do NOT match the claim.",
    state: matches ? "ok" : "fail",
  };
  steps[3] = {
    title: "Anchor reference",
    detail: `The registry record itself carries the anchoring native tx hash ${stamp.nativeTxHash} — the hybrid-signed tx that anchored this stamp on the native chain.`,
    state: "ok",
  };
  emit();
  return { steps, stamp, digest };
}

async function fetchBlockNumber(): Promise<number> {
  const res = await fetch(TESTNET_EVM_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  const body = (await res.json()) as { result: string };
  return Number.parseInt(body.result, 16);
}

export function App(): JSX.Element {
  const [live, setLive] = useState<LiveData | null>(null);
  const [liveSteps, setLiveSteps] = useState<CheckStep[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [block, setBlock] = useState<number | null>(null);
  const startedRef = useRef(false);

  // --- manual verify form -------------------------------------------------
  const [fLabel, setFLabel] = useState(FIRST_STAMP.label);
  const [fStatement, setFStatement] = useState(FIRST_STAMP.statement);
  const [fPub, setFPub] = useState(FIRST_STAMP.pqcPublicKeyHex);
  const [fSig, setFSig] = useState(FIRST_STAMP.signatureHex);
  const [mSteps, setMSteps] = useState<CheckStep[]>([]);
  const [mRunning, setMRunning] = useState(false);
  const [mError, setMError] = useState<string | null>(null);
  const [mOk, setMOk] = useState<boolean | null>(null);

  const loadLive = useCallback(async () => {
    setLiveError(null);
    try {
      const [chainId, stampCount] = await Promise.all([
        getEvmChainId(),
        readStampCount(REGISTRY_ADDRESS),
      ]);
      if (stampCount < 1) {
        setLiveError("The registry is reachable but currently holds no stamps.");
        return;
      }
      const firstDigest = await readDigestAt(REGISTRY_ADDRESS, 0);
      const firstStamp = await readStamp(REGISTRY_ADDRESS, firstDigest);
      if (!firstStamp) {
        setLiveError("digestAt(0) returned a digest with no record — inconsistent chain state.");
        return;
      }
      const { steps } = await runPublicVerification(FIRST_STAMP, setLiveSteps);
      const ok = steps.every((s) => s.state === "ok" || s.state === "info");
      setLive({ chainId, stampCount, firstDigest, firstStamp, steps, ok, checkedAt: new Date() });
    } catch (err) {
      setLiveError(
        `Could not reach the QoreChain testnet EVM RPC (${TESTNET_EVM_RPC_URL}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void loadLive();
  }, [loadLive]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const n = await fetchBlockNumber();
        if (!stop) setBlock(n);
      } catch {
        /* the chip simply stays at its last value */
      }
    };
    void tick();
    const id = setInterval(tick, 15000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  async function handleManualVerify(): Promise<void> {
    setMRunning(true);
    setMError(null);
    setMOk(null);
    try {
      const { steps } = await runPublicVerification(
        { label: fLabel, statement: fStatement, pqcPublicKeyHex: fPub, signatureHex: fSig },
        setMSteps,
      );
      setMOk(steps.every((s) => s.state === "ok" || s.state === "info"));
    } catch (err) {
      setMError(err instanceof Error ? err.message : String(err));
    } finally {
      setMRunning(false);
    }
  }

  const stepIcon = (s: StepState): string =>
    s === "ok" ? "✅" : s === "fail" ? "❌" : s === "running" ? "⏳" : s === "info" ? "ℹ️" : "·";

  return (
    <div className="wrap">
      <style>{css}</style>

      <div className="topbar">
        <div className="brand">
          ⬢ Qore<span>Stamp</span>
        </div>
        <nav className="toplinks">
          <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub repo</a>
          <a href={VIDEO_URL} target="_blank" rel="noreferrer">Demo video</a>
          <a href="#verify">Verify live</a>
          <a href="#how">How it works</a>
        </nav>
      </div>

      <header className="hero">
        <h1>
          Identity stamps for AI agents,
          <br />
          signed <em>post-quantum</em>.
        </h1>
        <p>
          An agent signs an identity attestation with an ML-DSA-87 (Dilithium-5)
          key, anchors it on QoreChain with a hybrid-signed transaction, and
          records it in a public registry — so <strong>anyone</strong> can verify
          it later from public data alone. No account, no wallet, no trust.
        </p>
        <div className="chips">
          <span className="chip">
            <span className="dot" />
            qorechain-diana · chain <b>{live ? live.chainId : 9800}</b>
          </span>
          <span className="chip">
            EVM block <b>{block !== null ? block.toLocaleString("en-US") : "…"}</b> (live)
          </span>
          <span className="chip">
            stamps in registry <b>{live ? live.stampCount : "…"}</b> (live)
          </span>
          <span className="chip">ML-DSA-87 · FIPS 204</span>
        </div>
        <div className="cta">
          <a className="btn btn-primary" href="#verify">Verify stamp #1 — live</a>
          <a className="btn btn-ghost" href={VIDEO_URL} target="_blank" rel="noreferrer">
            ▶ Watch the 2-minute demo
          </a>
          <a className="btn btn-ghost" href={REPO_URL} target="_blank" rel="noreferrer">
            View the source
          </a>
        </div>
      </header>

      <section className="card" id="verify">
        <h2>Stamp #1, re-verified live in your browser</h2>
        <p className="sub">
          The first stamp ever recorded — label <b>“{FIRST_STAMP.label}”</b> — is
          re-checked below from scratch: the digest is recomputed from the
          published evidence, the ML-DSA-87 signature is verified locally, and
          the registry record is read back from the chain with plain{" "}
          <code>eth_call</code>s. Nothing here is a screenshot or a cached
          result.
        </p>

        {liveError && (
          <div className="verdict bad">
            <span>⚠️ Live check could not complete</span>
          </div>
        )}
        {liveError && <p className="err">{liveError}</p>}
        {!live && !liveError && (
          <div className="verdict wait">
            <span>⏳ Reading the registry from qorechain-diana…</span>
          </div>
        )}
        {live && (
          <div className={`verdict ${live.ok ? "ok" : "bad"}`}>
            <span>{live.ok ? "✅ VERIFIED — stamp #1 is genuine" : "❌ Verification failed"}</span>
            <small>checked {live.checkedAt.toISOString()} · chain {live.chainId}</small>
          </div>
        )}

        <ul className="steps">
          {(live ? live.steps : liveSteps).map((s) => (
            <li key={s.title}>
              <div className="ic">{stepIcon(s.state)}</div>
              <div>
                <div className="t">{s.title}</div>
                <div className="d">{s.detail}</div>
              </div>
            </li>
          ))}
        </ul>

        {live && (
          <div className="grid">
            <div className="field">
              <div className="k">Attestation digest (registry key)</div>
              <div className="mono">{live.firstDigest}</div>
            </div>
            <div className="field">
              <div className="k">Stamper (EVM)</div>
              <div className="mono">{live.firstStamp.stamper}</div>
            </div>
            <div className="field">
              <div className="k">Stamper (native)</div>
              <div className="mono">{FIRST_STAMP.stamperQor}</div>
            </div>
            <div className="field">
              <div className="k">PQC key hash (ML-DSA-87)</div>
              <div className="mono">{live.firstStamp.pqcKeyHash}</div>
            </div>
            <div className="field">
              <div className="k">Recorded on chain (UTC)</div>
              <div className="mono">
                {new Date(live.firstStamp.timestamp * 1000).toISOString()}
              </div>
            </div>
            <div className="field">
              <div className="k">Anchoring native tx</div>
              <div className="mono">{live.firstStamp.nativeTxHash}</div>
            </div>
          </div>
        )}

        <p className="note" style={{ marginTop: "1.2rem" }}>
          One honest footnote: the anchoring native tx was confirmed at height{" "}
          {FIRST_STAMP.nativeTxHeight.toLocaleString("en-US")} with code 0 when
          the stamp was published (see <code>stamp-first-evidence.json</code> in
          the repo). The chain&apos;s REST and native RPC endpoints send no CORS
          headers, so a browser page cannot re-fetch that one fact live — the
          hash itself above <em>is</em> read live from the registry record.
        </p>

        <div className="field" style={{ marginTop: "1rem" }}>
          <div className="k">The statement being attested</div>
          <p style={{ color: "#c4cfdf", lineHeight: 1.6, margin: "0.3rem 0 0" }}>
            “{FIRST_STAMP.statement}”
          </p>
        </div>
      </section>

      <section className="card">
        <h2>On-chain proof</h2>
        <p className="sub">
          Every value below is a public testnet fact. (No public block explorer
          for qorechain-diana is verified yet, so the values are copyable text
          rather than explorer links.)
        </p>
        <MonoRow k="Registry contract" v={REGISTRY_ADDRESS} />
        <MonoRow k="Registry deploy tx" v={DEPLOY_TX} />
        <MonoRow k="Stamp #1 — EVM tx" v={FIRST_STAMP.evmTxHash} />
        <MonoRow k="Stamp #1 — native anchor tx" v={evidence.nativeTxHash} />
        <MonoRow k="Attestation digest" v={`0x${evidence.digest}`} />
        <MonoRow k="EVM RPC endpoint" v={TESTNET_EVM_RPC_URL} />
      </section>

      <section className="card" id="how">
        <h2>How it works</h2>
        <p className="sub">Four steps, one digest that everything refers to.</p>
        <div className="how">
          <div className="step-card">
            <div className="n">STEP 1</div>
            <h3>Attest</h3>
            <p>
              The agent builds a canonical, domain-separated record binding its
              label, a statement hash, the hash of its ML-DSA-87 public key, and
              the chain id. The record&apos;s SHA-256 digest is the single value
              everything else refers to.
            </p>
          </div>
          <div className="step-card">
            <div className="n">STEP 2</div>
            <h3>Sign</h3>
            <p>
              The digest is signed with ML-DSA-87 (Dilithium-5, FIPS 204) via{" "}
              <code>@qorechain/sdk</code>, in the chain&apos;s own{" "}
              <code>PQCHybridSignature</code> extension format — a signature
              scheme today&apos;s quantum-threat models don&apos;t break.
            </p>
          </div>
          <div className="step-card">
            <div className="n">STEP 3</div>
            <h3>Anchor</h3>
            <p>
              The attestation is anchored by a hybrid-signed native transaction
              and recorded — digest, label, PQC key hash, native tx hash — in a
              tiny EVM registry contract, QoreStampRegistry.
            </p>
          </div>
          <div className="step-card">
            <div className="n">STEP 4</div>
            <h3>Verify</h3>
            <p>
              Anyone recomputes the digest, checks the ML-DSA-87 signature
              offline, reads the registry record via <code>eth_call</code>, and
              looks up the anchoring native tx. That is exactly what this page
              just did.
            </p>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Verify any stamp yourself</h2>
        <p className="sub">
          The form is pre-filled with stamp #1&apos;s published evidence — press
          Verify to re-run the same pipeline, or paste any other stamp&apos;s
          public fields. Verification needs nothing but public data.
        </p>
        <label className="f">
          Agent label
          <input className="f" value={fLabel} onChange={(e) => setFLabel(e.target.value)} />
        </label>
        <label className="f">
          Statement
          <textarea className="f" rows={3} value={fStatement} onChange={(e) => setFStatement(e.target.value)} />
        </label>
        <label className="f">
          ML-DSA-87 public key (hex)
          <textarea className="f" rows={3} value={fPub} onChange={(e) => setFPub(e.target.value)} />
        </label>
        <label className="f">
          Signature (hex)
          <textarea className="f" rows={3} value={fSig} onChange={(e) => setFSig(e.target.value)} />
        </label>
        <button className="run" onClick={() => void handleManualVerify()} disabled={mRunning}>
          {mRunning ? "Verifying…" : "Verify"}
        </button>
        {mError && <p className="err">{mError}</p>}
        {mOk !== null && (
          <div className={`verdict ${mOk ? "ok" : "bad"}`} style={{ marginTop: "1rem" }}>
            <span>{mOk ? "✅ This stamp verifies" : "❌ This stamp does not verify"}</span>
          </div>
        )}
        {mSteps.length > 0 && (
          <ul className="steps">
            {mSteps.map((s) => (
              <li key={s.title}>
                <div className="ic">{stepIcon(s.state)}</div>
                <div>
                  <div className="t">{s.title}</div>
                  <div className="d">{s.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Stamping your own attestation</h2>
        <p className="sub" style={{ marginBottom: 0 }}>
          Recording a <em>new</em> stamp deliberately requires more than a web
          page: a QoreChain account whose ML-DSA-87 key is registered on chain
          (<code>MsgRegisterPQCKeyV2</code>, possession proven) and an open EVM
          authorisation window — the same flow this project&apos;s deployer
          followed for stamp #1. The full flow ships in the repo (UI, scripts,
          and tests); verification, by design, needs none of it.
        </p>
      </section>

      <footer>
        <div>
          QoreStamp · Build Before Q-Day — Quantum Pass · MIT licensed
        </div>
        <div>
          <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
          {" · "}
          <a href={VIDEO_URL} target="_blank" rel="noreferrer">Demo video</a>
          {" · "}
          <span>registry reads: {TESTNET_EVM_RPC_URL}</span>
        </div>
      </footer>
    </div>
  );
}
