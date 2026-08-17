#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Live landing-page truth guard.  Unlike a link check, this reads the bytes
// actually served by seal-check and compares both its identity and its controls
// with the README's marked live-page claims.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const URL = process.env.LIVE_CLAIM_GUARD_URL ?? "https://velvetmonkey.github.io/seal-check/";
const README = process.env.LIVE_CLAIM_GUARD_README ?? resolve(ROOT, "README.md");
const PIN = Object.freeze({
  commit: process.env.LIVE_CLAIM_GUARD_COMMIT ?? "a67abf7",
  bytes: Number(process.env.LIVE_CLAIM_GUARD_BYTES ?? "12453"),
  sha256: process.env.LIVE_CLAIM_GUARD_SHA256 ?? "26a06e2b93d73b222e3b19fc04c64d9326d62392ecb84fb7d9b449d1308c46ef",
});
const BEGIN = "<!-- live-page-claims:begin -->";
const END = "<!-- live-page-claims:end -->";

let bad = false;
function fail(message) { console.error(`FAIL  ${message}`); bad = true; }

function claimRegions(readme) {
  const regions = [];
  let offset = 0;
  while (true) {
    const begin = readme.indexOf(BEGIN, offset);
    if (begin === -1) break;
    const end = readme.indexOf(END, begin + BEGIN.length);
    if (end === -1) { fail(`README live-page claim block beginning at byte ${begin} has no end marker`); break; }
    regions.push({ begin, end: end + END.length, text: readme.slice(begin + BEGIN.length, end) });
    offset = end + END.length;
  }
  if (regions.length === 0) fail("README has no checked live-page claim block");
  return regions;
}

let readme;
try { readme = readFileSync(README, "utf8"); }
catch (error) { console.error(`ERROR  cannot read README claim population ${README}: ${error.message}`); process.exit(2); }
const regions = claimRegions(readme);
const endpoint = "https://velvetmonkey.github.io/seal-check/";
for (let at = readme.indexOf(endpoint); at !== -1; at = readme.indexOf(endpoint, at + endpoint.length)) {
  if (!regions.some((region) => at >= region.begin && at < region.end)) {
    fail(`README live-page behaviour sentence at byte ${at} is outside <!-- live-page-claims --> checked population`);
  }
}

const claims = regions.map((region) => region.text).join("\n");
if (!claims.includes("The landing page has **zero `<button>` controls** and does not run MCP tool-calls.")) {
  fail("README checked population must state: The landing page has **zero `<button>` controls** and does not run MCP tool-calls.");
}
if (/runs? a supplied MCP tool-call|to run a supplied MCP tool-call/i.test(claims)) {
  fail("README claims the landing page runs a supplied MCP tool-call, but the checked landing-page control model forbids that claim");
}

let body;
try {
  const response = await fetch(URL, { redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  body = Buffer.from(await response.arrayBuffer());
} catch (error) {
  // Network uncertainty is evidence we did not obtain, not a successful check.
  console.error(`ERROR  LIVE PAGE UNREACHABLE ${URL}: ${error.message}`);
  console.error("ERROR  refusing a green result because served bytes were not checked");
  process.exit(2);
}

const text = body.toString("utf8");
const buttons = (text.match(/<button\b/gi) ?? []).length;
const sha256 = createHash("sha256").update(body).digest("hex");
console.log(`LIVE  ${URL}: ${body.length} bytes, sha256 ${sha256}, ${buttons} <button> controls`);

if (buttons !== 0) fail(`landing page has ${buttons} <button> controls; README claims zero`);
else console.log("PASS  landing-page control count agrees with README: zero <button> controls");
if (body.length !== PIN.bytes || sha256 !== PIN.sha256) {
  fail(`served landing page differs from seal-check@${PIN.commit}: expected ${PIN.bytes} bytes sha256 ${PIN.sha256}; got ${body.length} bytes sha256 ${sha256}`);
  console.error("INFO  To repin after reviewing a deliberate seal-check release, update PIN in scripts/live-page-claim-guard.mjs with the release commit, fetched byte count, and sha256 together.");
} else {
  console.log(`PASS  served bytes match pinned seal-check@${PIN.commit}`);
}
process.exit(bad ? 1 : 0);
