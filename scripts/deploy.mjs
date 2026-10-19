// Deploy ShipGate to GenLayer StudioNet.
//   source ~/.genlayer/env.sh   # exports GENLAYER_PRIVATE_KEY
//   npm run deploy
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { readFileSync } from "node:fs";

const raw = process.env.GENLAYER_PRIVATE_KEY;
if (!/^(0x)?[0-9a-fA-F]{64}$/.test(raw || "")) throw Error("Set GENLAYER_PRIVATE_KEY (source ~/.genlayer/env.sh)");
const key = raw.startsWith("0x") ? raw : `0x${raw}`;
const account = createAccount(key);
const client = createClient({ chain: studionet, account });
const reader = createClient({ chain: studionet });

const code = readFileSync(new URL("../contracts/Contract.py", import.meta.url), "utf8");
console.log("Deployer:", account.address);
console.log("Balance :", String(await reader.getBalance({ address: account.address })));

const hash = await client.deployContract({ code, args: [] });
console.log("Deploy tx:", hash);
await reader.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, interval: 5000, retries: 240 });
const tx = await reader.getTransaction({ hash });

const addrRe = /^0x[0-9a-fA-F]{40}$/;
const candidates = [
  tx?.data?.contract_address, tx?.data?.contractAddress, tx?.to_address, tx?.recipient,
  tx?.txDataDecoded?.contract_address,
  ...(tx?.data ? Object.values(tx.data) : []),
].filter((x) => typeof x === "string" && addrRe.test(x) && !/^0x0{40}$/.test(x));

let address = candidates[0];
if (!address) {
  // Fall back: scan the whole tx object for the first non-zero 40-hex address that resolves to a schema.
  const seen = new Set();
  const walk = (o) => { if (!o || typeof o !== "object") return; for (const v of Object.values(o)) {
    if (typeof v === "string" && addrRe.test(v) && !/^0x0{40}$/.test(v)) seen.add(v);
    else if (typeof v === "object") walk(v);
  } };
  walk(tx);
  for (const a of seen) {
    try { await reader.getContractSchema({ address: a }); address = a; break; } catch { /* keep scanning */ }
  }
}
if (!address) { console.error(JSON.stringify(tx, null, 2).slice(0, 4000)); throw Error("Could not determine deployed address"); }

const cfg = await reader.readContract({ address, functionName: "get_config", args: [] });
if (cfg.schema !== "shipgate-v1") throw Error("Deployed schema mismatch: " + JSON.stringify(cfg));
console.log("\nDEPLOYED ShipGate at:", address);
console.log("get_config:", JSON.stringify(cfg));
console.log("\nSet VITE_CONTRACT_ADDRESS=" + address + " in .env and Vercel.");
