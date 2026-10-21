import { NavLink, Outlet } from "react-router-dom";
import { explorer, useChain } from "../lib/chain";
import { validAddress } from "../protocol";

const short = (x: string) => (x ? `${x.slice(0, 6)}…${x.slice(-4)}` : "Connect wallet");

export default function Layout() {
  const { address, setAddress, wallet, connect, notice, error, setError } = useChain();
  const nav = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");

  return (
    <>
      <header>
        <NavLink to="/" className="brand">
          <span className="mark" aria-hidden />
          <div>
            <b>SHIPGATE</b>
            <span>LIVE-DELIVERABLE ESCROW</span>
          </div>
        </NavLink>
        <nav>
          <NavLink to="/" end className={nav}>Overview</NavLink>
          <NavLink to="/agreements" className={nav}>Agreements</NavLink>
          <NavLink to="/create" className={nav}>New</NavLink>
          <NavLink to="/explorer" className={nav}>Explorer</NavLink>
        </nav>
        <button className="connect" onClick={() => connect().catch((e) => setError(e instanceof Error ? e.message : String(e)))}>
          {wallet ? short(wallet) : "Connect wallet"}
        </button>
      </header>

      <div className="contract-bar">
        <label>ACTIVE CONTRACT
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x… deployed StudioNet address" />
        </label>
        {validAddress(address) && (
          <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">Explorer ↗</a>
        )}
      </div>

      <main>
        {error && <div className="alert error" onClick={() => setError("")}>{error}</div>}
        {notice && <div className="alert">{notice}</div>}
        <Outlet />
      </main>

      <footer>
        <span>StudioNet · GenLayer Intelligent Contract · Preview</span>
        <span>Deployer has no operator privilege</span>
      </footer>
    </>
  );
}
