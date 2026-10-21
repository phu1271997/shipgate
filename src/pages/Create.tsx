import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useChain } from "../lib/chain";
import { parseSafeGEN, validAddress, validTarget } from "../protocol";

export default function Create() {
  const { wallet, busy, write, setError } = useChain();
  const navigate = useNavigate();
  const [title, setTitle] = useState("Ship a working status API");
  const [vendor, setVendor] = useState("");
  const [target, setTarget] = useState("https://api.example.com");
  const [paths, setPaths] = useState("/health\n/v1/status");
  const [checks, setChecks] = useState(
    "The /health endpoint returns HTTP 200 with a JSON body containing a status field set to ok.\nThe /v1/status endpoint returns JSON listing at least one service with an uptime value.",
  );
  const [budget, setBudget] = useState("0.001");

  const submit = async () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const terms = {
        title,
        vendor: vendor.toLowerCase(),
        target_url: target,
        probe_paths: paths.split("\n").map((x) => x.trim()).filter(Boolean),
        checks: checks.split("\n").map((x) => x.trim()).filter(Boolean),
        budget: parseSafeGEN(budget),
        partial_bps: 5000,
        submit_deadline: now + 1800,
        review_end: now + 3600,
        expires: now + 5400,
      };
      const { result } = await write("create_agreement", [JSON.stringify(terms)]);
      navigate(`/agreements/${Number(result)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
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
      <button className="primary" disabled={busy || !wallet || !validAddress(vendor) || !validTarget(target)} onClick={submit}>
        {busy ? "Working…" : "Lock agreement terms →"}
      </button>
      {!wallet && <p className="fine">Connect a wallet to create an agreement.</p>}
      <p className="fine">
        Creation deposits nothing. The creating wallet becomes the client; the vendor is sealed in immutable terms.
        The deployer receives no role.
      </p>
    </section>
  );
}
