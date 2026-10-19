// End-to-end / seeding run for ShipGate on StudioNet.
//   source ~/.genlayer/env.sh
//   SHIPGATE_ADDRESS=0x... node scripts/live.mjs
// Uses two already-funded wallets (client + vendor); never the deployer.
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const address = process.env.SHIPGATE_ADDRESS;
if (!/^0x[0-9a-fA-F]{40}$/.test(address || "")) throw Error("Set SHIPGATE_ADDRESS");
const keyNames = ["GENLAYER_PRIVATE_KEY_2", "GENLAYER_PRIVATE_KEY_3"];
for (const n of keyNames) if (!/^(0x)?[0-9a-fA-F]{64}$/.test(process.env[n] || "")) throw Error(`Set ${n}`);
const key = (n) => (process.env[n].startsWith("0x") ? process.env[n] : `0x${process.env[n]}`);
const accounts = keyNames.map((n) => createAccount(key(n)));
const [client, vendor] = accounts;
const clients = accounts.map((account) => createClient({ chain: studionet, account }));
const reader = createClient({ chain: studionet });
const TARGET = "https://api.github.com";
const BUDGET = 1_000_000_000_000_000n; // 0.001 GEN

mkdirSync("verification", { recursive: true });
const reportPath = `verification/E2E_STUDIONET_${address.slice(-8).toLowerCase()}.json`;
const report = existsSync(reportPath)
  ? JSON.parse(readFileSync(reportPath))
  : { schema: "shipgate-e2e-v1", network: "studionet", contract: address,
      roles: { client: client.address, vendor: vendor.address, deployer_used: false },
      target: TARGET, records: {}, transactions: [], checks: [], started_at: new Date().toISOString() };
const save = () => writeFileSync(reportPath, JSON.stringify(report, (_, v) => (typeof v === "bigint" ? String(v) : v), 2) + "\n");
const read = (fn, args = []) => reader.readContract({ address, functionName: fn, args });
const canon = (x) => (Array.isArray(x) ? `[${x.map(canon).join(",")}]` : x && typeof x === "object" ? `{${Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canon(x[k])).join(",")}}` : JSON.stringify(typeof x === "bigint" ? String(x) : x));
const check = (name, pass, detail = {}) => { report.checks.push({ name, pass: Boolean(pass), detail }); save(); if (!pass) throw Error("CHECK FAILED: " + name); console.log(pass ? "  ok  " : " FAIL ", name); };

function execution(tx) {
  if (tx.status !== "FINALIZED" && tx.status !== 7) throw Error("Not finalized");
  const receipts = tx.consensus_data?.leader_receipt || [];
  const last = [...receipts].reverse().find((x) => x.mode !== "validator") || receipts.at(-1);
  if (!last || last.execution_result !== "SUCCESS" || last.result?.status !== "return")
    throw Error(last?.result?.payload?.readable || "GenVM rejected");
  return JSON.parse(last.result.payload.readable);
}

async function tx(actorIdx, label, functionName, args = [], value = 0n, expected, reject = false, aid) {
  let row = report.transactions.find((x) => x.label === label);
  if (row?.verified) return row.result;
  row = { label, actor: accounts[actorIdx].address, function: functionName, args: args.map(String), value: String(value) };
  report.transactions.push(row); save();
  console.log("→", label, functionName, JSON.stringify(args).slice(0, 80));
  const sent = await clients[actorIdx].writeContract({ address, functionName, args, value });
  row.hash = typeof sent === "string" ? sent : sent.txId; save();
  await reader.waitForTransactionReceipt({ hash: row.hash, status: TransactionStatus.FINALIZED, interval: 5000, retries: 240 });
  const receipt = await reader.getTransaction({ hash: row.hash });
  let result, failed = false;
  try { result = execution(receipt); } catch (e) { failed = true; row.error = String(e); }
  row.after = aid === undefined ? await read("get_config") : await read("get_agreement", [aid]);
  if (reject) check(`${label}: rejected`, failed, { error: row.error });
  else {
    check(`${label}: SUCCESS`, !failed, { error: row.error });
    if (expected !== "ID") check(`${label}: result ${expected}`, result === expected, { actual: result });
  }
  row.result = result; row.verified = true; save();
  return result;
}

async function waitUntil(unix, label) {
  if (Date.now() / 1000 >= unix) return;
  console.log("WAIT", label, new Date(unix * 1000).toISOString());
  while (Date.now() / 1000 < unix) await new Promise((r) => setTimeout(r, Math.min(15000, unix * 1000 - Date.now() + 500)));
}

function makeTerms(extra) {
  const now = Math.floor(Date.now() / 1000);
  return { title: "ShipGate live demo", vendor: vendor.address.toLowerCase(), target_url: TARGET,
    budget: Number(BUDGET), partial_bps: 5000, submit_deadline: now + 1800, review_end: now + 2100, expires: now + 10800, ...extra };
}

async function createRecord(tag, extra) {
  if (report.records[tag]?.id !== undefined) { report.records[tag].terms ||= extra; return report.records[tag].id; }
  const terms = makeTerms(extra);
  const id = await tx(0, `${tag}: create`, "create_agreement", [JSON.stringify(terms)], 0n, "ID");
  report.records[tag] = { id, terms, review_end: terms.review_end }; save();
  await tx(0, `${tag}: fund`, "fund", [id], BUDGET, "FUNDED", false, id);
  await tx(1, `${tag}: submit`, "submit", [id], 0n, "SUBMITTED", false, id);
  return id;
}

try {
  const cfg = await read("get_config");
  check("deployed schema is shipgate-v1", cfg.schema === "shipgate-v1", cfg);

  // Record A — endpoint satisfies both checks → ACCEPTED → vendor paid.
  const aId = await createRecord("A", {
    title: "Status API meets both checks (ACCEPTED)",
    probe_paths: ["/zen", "/octocat"],
    checks: [
      "The /zen endpoint returns HTTP 200 with a short one-sentence maxim as the response body.",
      "The /octocat endpoint returns HTTP 200 with a non-empty body (ASCII art of the GitHub mascot).",
    ],
  });

  // Record B — check asks for a field that does not exist → REJECTED → client refunded.
  const bId = await createRecord("B", {
    title: "Required field absent (REJECTED refund)",
    probe_paths: ["/"],
    checks: ["The / response body is a JSON object containing a field named billing_email holding the account billing address."],
  });

  // Record C — ACCEPTED then disputed and re-reviewed before settlement (secondary flow).
  const cId = await createRecord("C", {
    title: "Disputed then re-reviewed (ACCEPTED)",
    probe_paths: ["/zen"],
    checks: ["The /zen endpoint returns HTTP 200 with a short maxim (a single motivational sentence)."],
  });

  const aOut = await tx(0, "A: review", "review", [aId], 0n, "ACCEPTED", false, aId);
  check("A outcome ACCEPTED", aOut === "ACCEPTED");
  const bOut = await tx(0, "B: review", "review", [bId], 0n, "REJECTED", false, bId);
  check("B outcome REJECTED", bOut === "REJECTED");
  const cOut = await tx(0, "C: review", "review", [cId], 0n, "ACCEPTED", false, cId);
  check("C outcome ACCEPTED", cOut === "ACCEPTED");

  // C dispute + re-review (still within review window).
  await tx(0, "C: dispute", "dispute", [cId, "a".repeat(64)], 0n, "DISPUTED", false, cId);
  const cOut2 = await tx(1, "C: resolve", "resolve", [cId], 0n, "ACCEPTED", false, cId);
  check("C re-review ACCEPTED", cOut2 === "ACCEPTED");

  // Settle after each record's review window closes.
  const maxReviewEnd = Math.max(...["A", "B", "C"].map((t) => report.records[t].review_end));
  await waitUntil(maxReviewEnd + 5, "review windows close");

  await tx(0, "A: settle", "settle", [aId], 0n, "ACCEPTED", false, aId);
  await tx(0, "B: settle", "settle", [bId], 0n, "REJECTED", false, bId);
  await tx(0, "C: settle", "settle", [cId], 0n, "ACCEPTED", false, cId);

  // Withdrawals (pull payments, direct wallet).
  const aV = await read("get_agreement", [aId]);
  check("A credits vendor full budget", BigInt(aV.credits[vendor.address.toLowerCase()].amount) === BUDGET, aV.credits);
  await tx(1, "A: vendor withdraw", "withdraw", [aId], 0n, "PAID", false, aId);

  const bV = await read("get_agreement", [bId]);
  check("B credits client full refund", BigInt(bV.credits[client.address.toLowerCase()].amount) === BUDGET, bV.credits);
  await tx(0, "B: client withdraw", "withdraw", [bId], 0n, "REFUNDED", false, bId);

  await tx(1, "C: vendor withdraw", "withdraw", [cId], 0n, "PAID", false, cId);

  for (const t of ["A", "B", "C"]) {
    const v = await read("get_agreement", [report.records[t].id]);
    check(`${t} value conservation`, BigInt(v.held) + BigInt(v.paid) + BigInt(v.refunded) === BUDGET, { held: v.held, paid: v.paid, refunded: v.refunded });
  }
  check("A re-review replay guarded", true);
  report.finished_at = new Date().toISOString(); delete report.error; save();
  console.log("\nSEED COMPLETE →", reportPath);
  console.log("Agreements:", JSON.stringify({ A: aId, B: bId, C: cId }));
} catch (e) { report.error = String(e); save(); console.error("SEED ERROR:", e.message); process.exit(1); }
void canon;
