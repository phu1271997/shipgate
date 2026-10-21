// Drive the production build in real Chrome, read-path only (no wallet), against live StudioNet state.
import { chromium } from "playwright-core";
const BASE = process.env.BASE || "http://localhost:4178";
const results = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

async function check(name, fn) {
  try { await fn(); results.push([true, name]); console.log("  ok  ", name); }
  catch (e) { results.push([false, name + " — " + (e.message || e)]); console.log(" FAIL ", name, "—", e.message || e); }
}
const vis = async (sel, timeout = 25000) => page.waitForSelector(sel, { state: "visible", timeout });
const txt = async (sel) => (await page.textContent(sel))?.trim();

await check("home renders hero + nav", async () => {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await vis("header nav");
  await vis(".hero h1");
  if (!(await page.$$("nav a")).length) throw new Error("no nav links");
});

await check("explorer lists resolved seeded agreements", async () => {
  await page.goto(BASE + "/explorer", { waitUntil: "networkidle" });
  await vis(".xtable .xrow", 30000);
  const rows = await page.$$(".xtable .xrow");
  if (rows.length < 3) throw new Error("expected >=3 agreement rows, got " + rows.length);
  const body = await page.textContent("main");
  if (!/ACCEPTED/.test(body)) throw new Error("no ACCEPTED outcome shown");
  if (!/REJECTED/.test(body)) throw new Error("no REJECTED outcome shown");
});

await check("agreement #0 shows ACCEPTED verdict", async () => {
  await page.goto(BASE + "/agreements/0", { waitUntil: "networkidle" });
  await vis(".dossier", 30000);
  const t = await txt("main");
  if (!/ACCEPTED/.test(t)) throw new Error("no ACCEPTED verdict");
  if (!/SETTLED/.test(t)) throw new Error("expected SETTLED phase");
});

await check("agreement #1 shows REJECTED", async () => {
  await page.goto(BASE + "/agreements/1", { waitUntil: "networkidle" });
  await vis(".dossier", 30000);
  if (!/REJECTED/.test(await txt("main"))) throw new Error("no REJECTED verdict");
});

await check("agreement #2 shows ACCEPTED (disputed path)", async () => {
  await page.goto(BASE + "/agreements/2", { waitUntil: "networkidle" });
  await vis(".dossier", 30000);
  if (!/ACCEPTED/.test(await txt("main"))) throw new Error("no ACCEPTED verdict");
});

await check("non-existent agreement shows clean not-found (no crash)", async () => {
  await page.goto(BASE + "/agreements/999", { waitUntil: "networkidle" });
  await vis(".empty", 30000);
  const t = await txt("main");
  if (!/No agreement #999/.test(t)) throw new Error("no not-found message: " + t.slice(0, 120));
});

await check("create page renders form with disabled submit when no wallet", async () => {
  await page.goto(BASE + "/create", { waitUntil: "networkidle" });
  await vis(".form");
  const btn = await page.$(".form button.primary");
  if (!btn) throw new Error("no submit button");
  if (!(await btn.isDisabled())) throw new Error("submit should be disabled without a wallet");
});

await check("deep route served (SPA) + no console errors", async () => {
  if (consoleErrors.length) throw new Error(consoleErrors.slice(0, 3).join(" | "));
});

await browser.close();
const failed = results.filter((r) => !r[0]);
console.log(`\nE2E: ${results.length - failed.length}/${results.length} passed`);
if (consoleErrors.length) console.log("console errors:", consoleErrors.slice(0, 5));
process.exit(failed.length ? 1 : 0);
