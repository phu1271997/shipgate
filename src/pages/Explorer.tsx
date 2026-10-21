import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { explorer, loadConfig, useChain } from "../lib/chain";
import { gen, outcomeTone, validAddress, type Agreement as A } from "../protocol";

const TERMINAL = ["SETTLED", "RECOVERED"];

export default function Explorer() {
  const { reader, address } = useChain();
  const [rows, setRows] = useState<A[]>([]);
  const [count, setCount] = useState(0);
  const [state, setState] = useState<"idle" | "loading" | "error">("loading");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (!validAddress(address)) { setState("error"); setMsg("Set a deployed StudioNet contract address above."); return; }
    setState("loading"); setMsg("");
    try {
      const cfg = await loadConfig(reader, address);
      const n = Number(cfg.count ?? 0);
      setCount(n);
      const ids = Array.from({ length: Math.min(n, 60) }, (_, i) => n - 1 - i).filter((i) => i >= 0);
      const loaded = await Promise.all(ids.map((i) =>
        reader.readContract({ address: address as `0x${string}`, functionName: "get_agreement", args: [i] }).catch(() => null)));
      setRows(loaded.filter(Boolean) as A[]);
      setState("idle");
    } catch (e) {
      setState("error"); setMsg(e instanceof Error ? e.message : String(e));
    }
  }, [reader, address]);

  useEffect(() => { load(); }, [load]);

  const resolved = rows.filter((r) => TERMINAL.includes(r.phase));
  const open = rows.filter((r) => !TERMINAL.includes(r.phase));

  const Row = (a: A) => {
    const o = a.verdict?.result.outcome;
    const paid = Number(a.paid), refunded = Number(a.refunded);
    return (
      <Link to={`/agreements/${a.id}`} className="xrow" key={a.id}>
        <span className="xid">#{a.id}</span>
        <span className="xtitle">{a.terms.title}</span>
        <span className={`status ${a.phase.toLowerCase()}`}>{a.phase}</span>
        {o ? <span className={`xoutcome ${outcomeTone(o)}`}>{o} · {a.verdict?.result.matched.length}/{a.terms.checks.length}</span> : <span className="xoutcome">—</span>}
        <span className="xmoney">{paid ? `paid ${gen(paid)}` : refunded ? `refunded ${gen(refunded)}` : gen(a.terms.budget)}</span>
      </Link>
    );
  };

  return (
    <section className="explorer">
      <div className="explorer-head">
        <div>
          <p className="eyebrow">ON-CHAIN ACTIVITY</p>
          <h2>Explorer</h2>
          <p className="sub">Every agreement on this contract, read live from StudioNet. Verdicts are produced by validator consensus, not a ShipGate server.</p>
        </div>
        <div className="explorer-actions">
          <button onClick={load} disabled={state === "loading"}>↻ Refresh</button>
          {validAddress(address) && <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">Contract on Explorer ↗</a>}
        </div>
      </div>

      {state === "loading" && <div className="empty">Reading on-chain state…</div>}
      {state === "error" && <div className="empty">{msg} <button onClick={load}>Retry</button></div>}

      {state === "idle" && (
        <>
          <div className="xstats">
            <div><b>{count}</b><small>total agreements</small></div>
            <div><b>{resolved.length}</b><small>resolved (settled / recovered)</small></div>
            <div><b>{resolved.filter((r) => Number(r.paid) > 0).length}</b><small>paid a vendor</small></div>
          </div>

          {rows.length === 0 && <div className="empty">No agreements yet on this contract.</div>}

          {resolved.length > 0 && (
            <>
              <h3 className="xsection">Resolved cases</h3>
              <div className="xtable">{resolved.map(Row)}</div>
            </>
          )}
          {open.length > 0 && (
            <>
              <h3 className="xsection">In progress</h3>
              <div className="xtable">{open.map(Row)}</div>
            </>
          )}
          {count > rows.length && <p className="fine">Showing the most recent {rows.length} of {count}.</p>}
        </>
      )}
    </section>
  );
}
