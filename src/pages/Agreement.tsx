import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { loadConfig, useChain } from "../lib/chain";
import { gen, nextAction, outcomeTone, phases, validAddress, type Agreement as A } from "../protocol";

export default function Agreement() {
  const { id: idParam } = useParams();
  const navigate = useNavigate();
  const { reader, address, wallet, busy, write, setError } = useChain();
  const id = Math.max(0, Number(idParam ?? 0) || 0);
  const [a, setA] = useState<A>();
  const [state, setState] = useState<"idle" | "loading" | "notfound" | "error">("loading");

  const load = useCallback(async () => {
    if (!validAddress(address)) { setState("error"); setError("Set a deployed StudioNet contract address above."); return; }
    setState("loading");
    try {
      const cfg = await loadConfig(reader, address);
      if (id >= Number(cfg.count ?? 0)) { setState("notfound"); setA(undefined); return; }
      const v = (await reader.readContract({ address: address as `0x${string}`, functionName: "get_agreement", args: [id] })) as A;
      setA(v); setState("idle");
    } catch (e) {
      setState("error"); setError(e instanceof Error ? e.message : String(e));
    }
  }, [reader, address, id, setError]);

  useEffect(() => { load(); }, [load]);

  const act = async (method: string, args: (string | number)[], value?: bigint, slow = false) => {
    try { await write(method, args, value, slow); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  if (state === "loading") return <section className="dossier"><div className="empty">Loading agreement #{id}…</div></section>;
  if (state === "error") return <section className="dossier"><div className="empty">Could not load. Check the contract address above, then retry. <button onClick={load}>Retry</button></div></section>;
  if (state === "notfound" || !a)
    return (
      <section className="dossier">
        <div className="empty">
          No agreement #{id} on this contract.
          <div style={{ marginTop: 12 }}><button onClick={() => navigate("/explorer")}>Open the Explorer</button> <button onClick={() => navigate("/create")}>Create one</button></div>
        </div>
      </section>
    );

  const phase = a.phase;
  const now = Math.floor(Date.now() / 1000);
  const outcome = a.verdict?.result.outcome;
  const credit = wallet ? a.credits?.[wallet] : undefined;

  return (
    <section className="workspace">
      <aside className="rail">
        <p>STATE MACHINE</p>
        {phases.map((p, i) => (
          <div className={`${phase === p ? "current" : ""} ${phases.indexOf(phase) > i ? "done" : ""}`} key={p}>
            <i>{i + 1}</i><span>{p.replaceAll("_", " ")}</span>
          </div>
        ))}
        <div className="pager">
          <button disabled={id === 0} onClick={() => navigate(`/agreements/${id - 1}`)}>← #{id - 1}</button>
          <button onClick={() => navigate(`/agreements/${id + 1}`)}>#{id + 1} →</button>
        </div>
      </aside>

      <article className="dossier">
        <div className="dossier-head">
          <div>
            <p className="eyebrow">SHIPMENT MANIFEST #{id}</p>
            <h2>{a.terms.title}</h2>
          </div>
          <span className={`status ${phase.toLowerCase()}`}>{phase}</span>
        </div>

        <div className="facts">
          <div><small>Target origin</small><b>{a.terms.target_url}</b></div>
          <div><small>Vendor</small><b>{a.terms.vendor.slice(0, 6)}…{a.terms.vendor.slice(-4)}</b></div>
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
            <div><b>Probed paths</b>{a.terms.probe_paths.map((p) => <code key={p}>{p}</code>)}</div>
            <div><b>Observed status</b>{a.verdict?.snapshot?.observations?.map((o) => <code key={o.path}>{o.path} → {o.status} ({o.length}b)</code>) || <span>Not reviewed yet</span>}</div>
          </div>
          <ol className="checks">
            {a.terms.checks.map((c, i) => (
              <li key={i} className={a.verdict?.result.matched.includes(i) ? "pass" : outcome ? "fail" : ""}>{c}</li>
            ))}
          </ol>
        </div>

        <div className="actions">
          <button disabled={busy || phase !== "DRAFT" || wallet !== a.client} onClick={() => act("fund", [id], BigInt(a.terms.budget))}>Fund exact escrow</button>
          <button disabled={busy || phase !== "FUNDED" || wallet !== a.terms.vendor.toLowerCase()} onClick={() => act("submit", [id])}>Submit deliverable</button>
          <button disabled={busy || phase !== "SUBMITTED"} onClick={() => act("review", [id], 0n, true)}>Run live review</button>
          <button disabled={busy || phase !== "REVIEWED" || now >= a.terms.review_end} onClick={() => act("dispute", [id, "0".repeat(64)])}>Dispute</button>
          <button disabled={busy || phase !== "DISPUTED" || now >= a.terms.expires} onClick={() => act("resolve", [id], 0n, true)}>Re-review</button>
          <button disabled={busy || phase !== "REVIEWED" || now < a.terms.review_end || now >= a.terms.expires} onClick={() => act("settle", [id])}>Settle</button>
          <button disabled={busy || !["FUNDED", "SUBMITTED", "REVIEWED", "DISPUTED"].includes(phase) || now < a.terms.expires} onClick={() => act("recover_expired", [id])}>Recover expired</button>
          <button className="primary" disabled={busy || !credit || credit.status !== "AVAILABLE"} onClick={() => act("withdraw", [id])}>
            {credit && credit.status === "AVAILABLE" ? `Withdraw ${gen(credit.amount)}` : "Withdraw credit"}
          </button>
        </div>
        {!wallet && <p className="fine">Read-only — connect a wallet to act on this agreement.</p>}

        <div className="ledger">
          <span>held {gen(a.held)}</span>
          <span>paid {gen(a.paid)}</span>
          <span>refunded {gen(a.refunded)}</span>
        </div>
        <button className="ghost" onClick={load} disabled={busy}>↻ Refresh state</button>
      </article>
    </section>
  );
}
