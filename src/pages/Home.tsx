import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();
  const [id, setId] = useState("0");

  return (
    <>
      <section className="hero">
        <p className="eyebrow">THE ESCROW CHECKS THE SERVICE ITSELF</p>
        <h1>Ship it live.<br /><em>Validators confirm it works.</em> Get paid.</h1>
        <p>
          GenLayer validators fetch your deployed endpoint on-chain and judge whether the live responses
          satisfy sealed acceptance checks — not a screenshot, not a README, not a promise.
        </p>
        <div className="hero-cta">
          <div className="jump">
            <input type="number" min="0" value={id} onChange={(e) => setId(e.target.value)} aria-label="Agreement id" />
            <button className="primary" onClick={() => navigate(`/agreements/${Math.max(0, Number(id) || 0)}`)}>Inspect agreement →</button>
          </div>
          <button onClick={() => navigate("/explorer")}>Browse the Explorer</button>
          <button onClick={() => navigate("/create")}>Create an agreement</button>
        </div>
      </section>

      <section className="rules">
        <p className="eyebrow">PROOF BEFORE PROSE</p>
        <h2>What ShipGate accepts.</h2>
        <div className="rule-grid">
          <article><b>01 · The live service</b><p>Validators fetch each sealed probe path on-chain. A promise or a design doc satisfies nothing.</p></article>
          <article><b>02 · Semantic checks</b><p>An LLM decides, per sealed check, whether the captured responses actually satisfy it.</p></article>
          <article><b>03 · Consensus on meaning</b><p>Validators converge on the verdict (ACCEPTED / PARTIAL / REJECTED), not on byte-identical bodies.</p></article>
          <article><b>04 · Contract maps money</b><p>ACCEPTED pays the full escrow, PARTIAL the sealed fraction, REJECTED / UNREACHABLE refund the client.</p></article>
        </div>
        <div className="scope">
          <b>Explicit boundary</b>
          <p>A passing review proves the endpoint answered the checks when fetched. It does not prove permanent uptime, security, or correctness under every input.</p>
        </div>
      </section>
    </>
  );
}
