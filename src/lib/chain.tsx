import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import type { CalldataEncodable, Hash } from "genlayer-js/types";
import { execution, normalizeTx, validAddress } from "../protocol";

declare global {
  interface Window {
    ethereum?: { request: (x: { method: string; params?: unknown[] }) => Promise<unknown> };
  }
}

export const explorer = "https://explorer-studio.genlayer.com";
export const deployedAddress = import.meta.env.VITE_CONTRACT_ADDRESS || "";
const SCHEMA = "shipgate-v1";
const CHAIN_ID_HEX = "0x" + studionet.id.toString(16);

export async function ensureNetwork() {
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

type ChainCtx = {
  reader: ReturnType<typeof createClient>;
  address: string;
  setAddress: (a: string) => void;
  wallet: string;
  connect: () => Promise<void>;
  busy: boolean;
  notice: string;
  error: string;
  setNotice: (s: string) => void;
  setError: (s: string) => void;
  read: (fn: string, args?: CalldataEncodable[]) => Promise<unknown>;
  write: (method: string, args: CalldataEncodable[], value?: bigint, slow?: boolean) => Promise<{ hash: Hash; result: unknown }>;
};

const Ctx = createContext<ChainCtx | null>(null);
export const useChain = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useChain outside provider");
  return c;
};

export function ChainProvider({ children }: { children: ReactNode }) {
  const reader = useMemo(() => createClient({ chain: studionet }), []);
  const [address, setAddressRaw] = useState(localStorage.getItem("shipgate-address") || deployedAddress);
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Connect a StudioNet wallet, or inspect any deployed agreement.");
  const [error, setError] = useState("");
  const busyRef = useRef(false);

  const setAddress = (a: string) => { setAddressRaw(a); if (validAddress(a)) localStorage.setItem("shipgate-address", a); };

  const connect = async () => {
    if (!window.ethereum) throw Error("Install a compatible wallet extension (e.g. MetaMask).");
    await ensureNetwork();
    const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
    setWallet(accounts[0]?.toLowerCase() || "");
    setNotice("Wallet connected on StudioNet.");
  };

  const read = (fn: string, args: CalldataEncodable[] = []) =>
    reader.readContract({ address: address as `0x${string}`, functionName: fn, args });

  const write = async (method: string, args: CalldataEncodable[], value?: bigint, slow = false) => {
    if (busyRef.current) throw Error("A transaction is already in progress.");
    if (!window.ethereum || !wallet) throw Error("Connect a wallet first.");
    if (!validAddress(address)) throw Error("Set a deployed StudioNet contract address first.");
    busyRef.current = true; setBusy(true); setError("");
    try {
      await ensureNetwork();
      const client = createClient({ chain: studionet, account: wallet as `0x${string}`, provider: window.ethereum });
      const raw = await client.writeContract({ address: address as `0x${string}`, functionName: method, args, value: value ?? 0n });
      const hash = normalizeTx(raw) as Hash;
      setNotice(`Submitted ${method}. ${slow ? "Validators are fetching the live endpoint and voting — this takes longer than a normal transaction." : "Waiting for acceptance…"} ${hash}`);
      await reader.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, retries: 100, interval: 3000 });
      setNotice(`Accepted ${method}. Waiting for finalization… ${hash}`);
      await reader.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, retries: 100, interval: 3000 });
      const tx = await reader.getTransaction({ hash });
      const result = execution(tx);
      setNotice(`${method} finalized. ${hash}`);
      return { hash, result };
    } finally {
      busyRef.current = false; setBusy(false);
    }
  };

  const value: ChainCtx = { reader, address, setAddress, wallet, connect, busy, notice, error, setNotice, setError, read, write };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export async function loadConfig(reader: ReturnType<typeof createClient>, address: string) {
  const cfg = (await reader.readContract({ address: address as `0x${string}`, functionName: "get_config", args: [] })) as { schema?: string; count?: number };
  if (cfg.schema !== SCHEMA) throw Error("Address is not a ShipGate contract.");
  return cfg;
}
