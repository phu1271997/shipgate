export type Agreement = {
  id: number;
  client: string;
  terms: {
    title: string;
    vendor: string;
    target_url: string;
    probe_paths: string[];
    checks: string[];
    budget: number;
    partial_bps: number;
    submit_deadline: number;
    review_end: number;
    expires: number;
  };
  terms_digest: string;
  phase: string;
  submission?: { submitter: string; at: number };
  verdict?: {
    result: { outcome: string; matched: number[] };
    snapshot?: {
      target: string;
      paths: string[];
      observations: { path: string; status: number; content_type: string; length: number; body_sha256: string }[];
    } | null;
    reviewed_at: number;
  };
  dispute?: { by: string; reason_digest: string } | null;
  held: number;
  paid: number;
  refunded: number;
  credits: Record<string, { amount: number; payout_amount: number; refund_amount: number; kind: string; status: string }>;
};

export const validAddress = (x: string) =>
  /^0x[0-9a-fA-F]{40}$/.test(x) && !/^0x0{40}$/.test(x);

export const validTarget = (x: string) =>
  /^https:\/\/[A-Za-z0-9._:-]+$/.test(x) && x.includes(".") && x.length <= 200;

export const normalizeTx = (x: unknown) => {
  if (typeof x === "string" && /^0x[0-9a-fA-F]{64}$/.test(x)) return x;
  if (x && typeof x === "object" && "txId" in x && typeof (x as { txId: unknown }).txId === "string")
    return (x as { txId: string }).txId;
  throw Error("Wallet returned an invalid transaction hash.");
};

export const parseSafeGEN = (text: string) => {
  if (!/^(0|[1-9]\d{0,3})(\.\d{1,18})?$/.test(text))
    throw Error("Enter a positive GEN amount with up to 18 decimals.");
  const [whole, fraction = ""] = text.split(".");
  const wei = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
  if (wei <= 0n || wei > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error("Amount exceeds the exact integer range supported by this form.");
  return Number(wei);
};

export function execution(tx: unknown): unknown {
  const value = tx as {
    status?: string | number;
    consensus_data?: {
      leader_receipt?: Array<{ mode?: string; execution_result?: string; result?: { status?: string; payload?: { readable?: string } | string } }>;
      votes?: Record<string, string>;
    };
  };
  if (value.status !== "FINALIZED" && value.status !== 7) throw Error("Transaction has not finalized.");
  const receipts = value.consensus_data?.leader_receipt || [];
  const receipt = [...receipts].reverse().find((x) => x.mode !== "validator") || receipts.at(-1);
  const payload = receipt?.result?.payload;
  const readable = payload && typeof payload === "object" ? payload.readable : undefined;
  if (!receipt || receipt.execution_result !== "SUCCESS" || receipt.result?.status !== "return" || readable === undefined)
    throw Error(typeof payload === "string" ? payload : "GenVM execution did not succeed.");
  if (Object.values(value.consensus_data?.votes || {}).filter((x) => x === "agree").length < 3)
    throw Error("Validator consensus was not established.");
  return JSON.parse(readable);
}

export const gen = (n: number) => `${(Number(n) / 1e18).toFixed(4)} GEN`;

export const phases = ["DRAFT", "FUNDED", "SUBMITTED", "REVIEWED", "DISPUTED", "SETTLED", "RECOVERED"];

export const outcomeTone = (o?: string) =>
  o === "ACCEPTED" ? "good" : o === "PARTIAL" ? "warn" : o === "REJECTED" || o === "UNREACHABLE" ? "bad" : "";

export const nextAction = (phase: string, wallet: string, a?: Agreement) => {
  if (!a) return "SYNC";
  const w = wallet.toLowerCase();
  if (phase === "DRAFT") return w === a.client ? "FUND ESCROW" : "WAIT FOR CLIENT";
  if (phase === "FUNDED") return w === a.terms.vendor.toLowerCase() ? "SUBMIT DELIVERABLE" : "WAIT FOR VENDOR";
  if (phase === "SUBMITTED") return "RUN LIVE REVIEW";
  if (phase === "REVIEWED") return "DISPUTE OR SETTLE";
  if (phase === "DISPUTED") return "RE-REVIEW";
  return "WITHDRAW CREDIT";
};
