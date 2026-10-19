import { useEffect, useState } from "react";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import type { CalldataEncodable, Hash } from "genlayer-js/types";
import {
  gen,
  execution,
  nextAction,
  normalizeTx,
  outcomeTone,
  parseSafeGEN,
  phases,
  validAddress,
  validTarget,
  type Agreement,
} from "./protocol";

declare global {
  interface Window {
    ethereum?: {
      request: (x: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

const reader = createClient({ chain: studionet });
const explorer = "https://explorer-studio.genlayer.com";
const deployedAddress = import.meta.env.VITE_CONTRACT_ADDRESS || "";
const CHAIN_ID_HEX = "0x" + studionet.id.toString(16);
const short = (x: string) => (x ? `${x.slice(0, 6)}…${x.slice(-4)}` : "Not connected");

async function ensureNetwork() {
  if (!window.ethereum) return;
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 4902 || code === -32603) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CHAIN_ID_HEX,
          chainName: "GenLayer Studio Network",
          nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
          rpcUrls: ["https://studio.genlayer.com/api"],
          blockExplorerUrls: [explorer],
        }],
      });
    } else throw err;
  }
}

export default function App() {
  const [address, setAddress] = useState(localStorage.getItem("shipgate-address") || deployedAddress);
  const [wallet, setWallet] = useState("");
  const [id, setId] = useState(0);
  const [a, setA] = useState<Agreement>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Connect a StudioNet wallet, or inspect any deployed agreement below.");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"manifest" | "create" | "rules">("manifest");

  const [title, setTitle] = useState("Ship a working status API");
  const [vendor, setVendor] = useState("");
  const [target, setTarget] = useState("https://api.example.com");
  const [paths, setPaths] = useState("/health\n/v1/status");
  const [checks, setChecks] = useState(
    "The /health endpoint returns HTTP 200 with a JSON body containing a status field set to ok.\nThe /v1/status endpoint returns JSON listing at least one service with an uptime value.",
  );
  const [budget, setBudget] = useState("0.001");

  const connect = async () => {
    if (!window.ethereum) throw Error("Install a compatible wallet extension (e.g. MetaMask).");
    await ensureNetwork();
    const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
    setWallet(accounts[0]?.toLowerCase() || "");
    setNotice("Wallet connected on StudioNet. Sync authoritative agreement state.");
  };

  const sync = async (selectedId = id) => {
    if (!validAddress(address)) throw Error("Enter a deployed StudioNet contract address.");
    const cfg = await reader.readContract({ address: address as `0x${string}`, functionName: "get_config", args: [] });
    if ((cfg as { schema?: string }).schema !== "shipgate-v1") throw Error("Address is not a ShipGate contract.");
    const v = await reader.readContract({ address: address as `0x${string}`, functionName: "get_agreement", args: [selectedId] });
    setA(v as Agreement);
    localStorage.setItem("shipgate-address", address);
    setNotice("Authoritative agreement state loaded.");
  };

  const write = async (method: string, args: CalldataEncodable[], value?: bigint) => {
    if (!window.ethereum || !wallet || !validAddress(address)) throw Error("Connect a wallet and sync a deployed contract first.");
    setBusy(true);
    setError("");
    try {
      await ensureNetwork();
      const client = createClient({ chain: studionet, account: wallet as `0x${string}`, provider: window.ethereum });
      const raw = await client.writeContract({ address: address as `0x${string}`, functionName: method, args, value: value ?? 0n });
      const hash = normalizeTx(raw) as Hash;
      const slow = method === "review" || method === "resolve";
      setNotice(`Submitted ${method}. ${slow ? "Validators are fetching the live endpoint and voting — this takes longer than a normal transaction." : "Waiting for acceptance…"} ${hash}`);
      await reader.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, retries: 100, interval: 3000 });
      setNotice(`Accepted ${method}. Waiting for finalization… ${hash}`);
      await reader.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, retries: 100, interval: 3000 });
      const tx = await reader.getTransaction({ hash });
      const result = execution(tx);
      const selectedId = method === "create_agreement" ? Number(result) : id;
      if (method === "create_agreement") setId(selectedId);
      await sync(selectedId);
      setNotice(`${method} finalized; authoritative state re-read. ${hash}`);
      return { hash, result };
    } finally {
      setBusy(false);
    }
  };

  const safe = (fn: () => Promise<unknown>) =>
    fn().catch((e) => setError(e instanceof Error ? e.message : String(e)));

  const create = async () => {
    const now = Math.floor(Date.now() / 1000);
    const wei = parseSafeGEN(budget);
    const terms = {
      title,
      vendor: vendor.toLowerCase(),
      target_url: target,
      probe_paths: paths.split("\n").map((x) => x.trim()).filter(Boolean),
      checks: checks.split("\n").map((x) => x.trim()).filter(Boolean),
      budget: wei,
      partial_bps: 5000,
      submit_deadline: now + 1800,
      review_end: now + 3600,
      expires: now + 5400,
    };
    await write("create_agreement", [JSON.stringify(terms)]);
    setTab("manifest");
  };

  useEffect(() => {
    if (validAddress(address)) safe(() => sync());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phase = a?.phase || "NO AGREEMENT";
  const now = Math.floor(Date.now() / 1000);
  const outcome = a?.verdict?.result.outcome;
  const credit = a?.credits?.[wallet];

  return (
    <>
      <header>
        <div className="brand">
          <span className="mark" aria-hidden />
          <div>
            <b>SHIPGATE</b>
            <span>LIVE-DELIVERABLE ESCROW</span>
          </div>
        </div>
        <nav>
          <button onClick={() => setTab("manifest")} className={tab === "manifest" ? "active" : ""}>Manifest</button>
          <button onClick={() => setTab("create")} className={tab === "create" ? "active" : ""}>New agreement</button>
          <button onClick={() => setTab("rules")} className={tab === "rules" ? "active" : ""}>How it judges</button>
        </nav>
        <button className="connect" onClick={() => safe(connect)}>{wallet ? short(wallet) : "Connect wallet"}</button>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">THE ESCROW CHECKS THE SERVICE ITSELF</p>
            <h1>Ship it live.<br /><em>Validators confirm it works.</em> Get paid.</h1>
            <p>
              GenLayer validators fetch your deployed endpoint on-chain and judge whether the live responses
              satisfy sealed acceptance checks — not a screenshot, not a README, not a promise.
            </p>
          </div>
        </section>

        <section className="contract">
          <label>ACTIVE CONTRACT
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x… deployed StudioNet address" />
          </label>
          <label>AGREEMENT ID
            <input type="number" min="0" value={id} onChange={(e) => setId(Number(e.target.value))} />
          </label>
          <button onClick={() => safe(() => sync())}>Sync state</button>
          {validAddress(address) && <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">Explorer ↗</a>}
        </section>

        {error && <div className="alert error">{error}</div>}
        <div className="alert">{notice}</div>

        {tab === "manifest" && (
          <section className="workspace">
            <aside className="rail">
              <p>STATE MACHINE</p>
              {phases.map((p, i) => (
                <div className={`${phase === p ? "current" : ""} ${a && phases.indexOf(phase) > i ? "done" : ""}`} key={p}>
                  <i>{i + 1}</i><span>{p.replaceAll("_", " ")}</span>
                </div>
              ))}
            </aside>

            <article className="dossier">
              <div className="dossier-head">
                <div>
                  <p className="eyebrow">SHIPMENT MANIFEST #{id}</p>
                  <h2>{a?.terms.title || "No agreement loaded"}</h2>
                </div>
                <span className={`status ${phase.toLowerCase()}`}>{phase}</span>
              </div>

              {a ? (
                <>
                  <div className="facts">
                    <div><small>Target origin</small><b>{a.terms.target_url}</b></div>
                    <div><small>Vendor</small><b>{short(a.terms.vendor)}</b></div>
                    <div><small>Escrow</small><b>{gen(a.terms.budget)}</b></div>
                    <div><small>Next action</small><b>{nextAction(phase, wallet, a)}</b></div>
                  </div>

                  <div className="proof">
                    <h3>Live review result</h3>
                    {outcome ? (
                      <div className={`verdict ${outcomeTone(outcome)}`}>
                        <b>{outcome}</b>
                        <span>{a.verdict?.result.matched.length} of {a.terms.checks.length} checks satisfied by the live responses</span>
                      </div>
                    ) : <div className="sha">Waiting for validators to fetch the live endpoint</div>}
                    <div className="file-columns">
                      <div>
                        <b>Probed paths</b>
                        {a.terms.probe_paths.map((p) => <code key={p}>{p}</code>)}
                      </div>
                      <div>
                        <b>Observed status</b>
                        {a.verdict?.snapshot?.observations?.map((o) => (
                          <code key={o.path}>{o.path} → {o.status} ({o.length}b)</code>
                        )) || <span>Not reviewed yet</span>}
                      </div>
                    </div>
                    <ol className="checks">
                      {a.terms.checks.map((c, i) => (
                        <li key={i} className={a.verdict?.result.matched.includes(i) ? "pass" : outcome ? "fail" : ""}>{c}</li>
                      ))}
                    </ol>
                  </div>

                  <div className="actions">
                    <button disabled={busy || phase !== "DRAFT" || wallet !== a.client}
                      onClick={() => safe(() => write("fund", [id], BigInt(a.terms.budget)))}>Fund exact escrow</button>
                    <button disabled={busy || phase !== "FUNDED" || wallet !== a.terms.vendor.toLowerCase()}
                      onClick={() => safe(() => write("submit", [id]))}>Submit deliverable</button>
                    <button disabled={busy || phase !== "SUBMITTED"}
                      onClick={() => safe(() => write("review", [id]))}>Run live review</button>
                    <button disabled={busy || phase !== "REVIEWED" || now >= a.terms.review_end}
                      onClick={() => safe(() => write("dispute", [id, "0".repeat(64)]))}>Dispute</button>
                    <button disabled={busy || phase !== "DISPUTED" || now >= a.terms.expires}
                      onClick={() => safe(() => write("resolve", [id]))}>Re-review</button>
                    <button disabled={busy || phase !== "REVIEWED" || now < a.terms.review_end || now >= a.terms.expires}
                      onClick={() => safe(() => write("settle", [id]))}>Settle</button>
                    <button disabled={busy || !["FUNDED", "SUBMITTED", "REVIEWED", "DISPUTED"].includes(phase) || now < a.terms.expires}
                      onClick={() => safe(() => write("recover_expired", [id]))}>Recover expired</button>
                    <button className="primary" disabled={busy || !credit || credit.status !== "AVAILABLE"}
                      onClick={() => safe(() => write("withdraw", [id]))}>
                      {credit && credit.status === "AVAILABLE" ? `Withdraw ${gen(credit.amount)}` : "Withdraw credit"}
                    </button>
                  </div>

                  <div className="ledger">
                    <span>held {gen(a.held)}</span>
                    <span>paid {gen(a.paid)}</span>
                    <span>refunded {gen(a.refunded)}</span>
                  </div>
                </>
              ) : (
                <div className="empty">Paste a deployed contract, choose an ID, and sync.</div>
              )}
            </article>
          </section>
        )}

        {tab === "create" && (
          <section className="form">
            <p className="eyebrow">NEW IMMUTABLE AGREEMENT</p>
            <h2>Seal the acceptance boundary.</h2>
            <div className="grid">
              <label>Milestone title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              <label>Vendor wallet<input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="0x…" /></label>
              <label>Target origin (https host only)<input value={target} onChange={(e) => setTarget(e.target.value)} /></label>
              <label>Escrow · GEN<input value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
            </div>
            <label>Probe paths · one per line (resolved against the origin)
              <textarea rows={3} value={paths} onChange={(e) => setPaths(e.target.value)} />
            </label>
            <label>Acceptance checks · one per line
              <textarea rows={5} value={checks} onChange={(e) => setChecks(e.target.value)} />
            </label>
            <button className="primary" disabled={busy || !wallet || !validAddress(vendor) || !validTarget(target)}
              onClick={() => safe(create)}>Lock agreement terms →</button>
            <p className="fine">
              Creation deposits nothing. The creating wallet becomes the client; the vendor is sealed in immutable terms.
              The deployer receives no role.
            </p>
          </section>
        )}

        {tab === "rules" && (
          <section className="rules">
            <p className="eyebrow">PROOF BEFORE PROSE</p>
            <h2>What ShipGate accepts.</h2>
            <div className="rule-grid">
              <article><b>01 · The live service</b><p>Validators fetch each sealed probe path on-chain. A promise or a design doc satisfies nothing.</p></article>
              <article><b>02 · Semantic checks</b><p>An LLM decides, per sealed check, whether the captured responses actually satisfy it.</p></article>
              <article><b>03 · Consensus on meaning</b><p>Validators converge on the verdict (ACCEPTED / PARTIAL / REJECTED), not on byte-identical bodies.</p></article>
              <article><b>04 · Contract maps money</b><p>ACCEPTED pays the full escrow, PARTIAL pays the sealed fraction, REJECTED/UNREACHABLE refund the client.</p></article>
            </div>
            <div className="scope">
              <b>Explicit boundary</b>
              <p>A passing review proves the endpoint answered the checks when fetched. It does not prove permanent uptime, security, or correctness under every input.</p>
            </div>
          </section>
        )}
      </main>

      <footer>
        <span>StudioNet · GenLayer Intelligent Contract</span>
        <span>Deployer has no operator privilege</span>
      </footer>
    </>
  );
}
