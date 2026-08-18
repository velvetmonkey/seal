#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Live landing-page truth guard. Unlike a link check, this reads the bytes
// actually served by seal-check and compares both its identity and literal
// <button> controls with the README's marked live-page claims.
//
// Scope: this guard proves only that its required README sentence exists, two
// named old phrasings are absent, the fetched HTML has no literal <button> tag,
// and that complete HTML equals this frozen pin. It does not inspect or execute
// app.js or wasm/seal.js. A green result cannot show that the page executes
// nothing, or that no MCP tool-call runs.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const URL = process.env.LIVE_CLAIM_GUARD_URL ?? "https://velvetmonkey.github.io/seal-check/";
const README = process.env.LIVE_CLAIM_GUARD_README ?? resolve(ROOT, "README.md");
const PIN = Object.freeze({
  commit: process.env.LIVE_CLAIM_GUARD_COMMIT ?? "e152a053637845600e1eceaee70cea873801c609",
  bytes: Number(process.env.LIVE_CLAIM_GUARD_BYTES ?? "10459"),
  sha256: process.env.LIVE_CLAIM_GUARD_SHA256 ?? "e3afe8e2d8f8181279068900a7e2b0e832c7c48ecca40edbb586d53c6475064e",
});
const PROVENANCE_URL = process.env.LIVE_CLAIM_GUARD_PROVENANCE_URL
  ?? `https://raw.githubusercontent.com/velvetmonkey/seal-check/${PIN.commit}/index.html`;
const PROVENANCE_PAGE = `https://github.com/velvetmonkey/seal-check/commit/${PIN.commit}`;
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
    regions.push({ begin, end: end + END.length, text: readme.slice(begin + BEGIN.length, end) }); // CLAIM-COVERAGE: README.md
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
if (!claims.includes("The landing page has **zero `<button>` controls**.")) {
  fail("README checked population must state: The landing page has **zero `<button>` controls**.");
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

function changedRegion(expected, actual) {
  let start = 0;
  const shared = Math.min(expected.length, actual.length);
  while (start < shared && expected[start] === actual[start]) start += 1;
  let expectedEnd = expected.length;
  let actualEnd = actual.length;
  while (expectedEnd > start && actualEnd > start && expected[expectedEnd - 1] === actual[actualEnd - 1]) {
    expectedEnd -= 1;
    actualEnd -= 1;
  }
  const contextStart = Math.max(0, start - 80);
  const contextEnd = Math.max(expectedEnd, actualEnd) + 80;
  const excerpt = (value, end) => JSON.stringify(value.slice(contextStart, Math.min(end + 80, contextEnd)));
  return `first changed region near byte ${start}:\n- pinned ${excerpt(expected, expectedEnd)}\n+ served ${excerpt(actual, actualEnd)}`;
}

if (buttons !== 0) fail(`landing page has ${buttons} <button> controls; README claims zero`);
else console.log("PASS  landing-page control count agrees with README: zero <button> controls");
if (body.length !== PIN.bytes || sha256 !== PIN.sha256) {
  fail(`served landing page differs from seal-check@${PIN.commit}: expected ${PIN.bytes} bytes sha256 ${PIN.sha256}; got ${body.length} bytes sha256 ${sha256}`);
  console.error(`INFO  Confirm the candidate release's provenance before repinning: ${PROVENANCE_PAGE}`);
  console.error(`INFO  Fetching the pinned seal-check@${PIN.commit} source for a changed-region diagnostic: ${PROVENANCE_URL}`);
  let pinnedSource;
  try {
    const response = await fetch(PROVENANCE_URL, { redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    pinnedSource = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    console.error(`ERROR  PINNED SEAL-CHECK PROVENANCE UNREACHABLE for ${PIN.commit}: ${error.message}`);
    console.error("ERROR  refusing a diagnosable pass: confirm the pinned release provenance before updating PIN");
    process.exit(2);
  }
  const sourceSha256 = createHash("sha256").update(pinnedSource).digest("hex");
  if (pinnedSource.length !== PIN.bytes || sourceSha256 !== PIN.sha256) {
    console.error(`ERROR  pinned provenance source for seal-check@${PIN.commit} does not match this guard's frozen pin: ${pinnedSource.length} bytes sha256 ${sourceSha256}`);
    process.exit(2);
  }
  console.error(`DIFF  ${changedRegion(pinnedSource.toString("utf8"), text)}`);
  console.error("INFO  After reviewing that provenance and this changed region, update the commit, byte count, and sha256 together in scripts/live-page-claim-guard.mjs.");
} else {
  console.log(`PASS  served bytes match pinned seal-check@${PIN.commit}`);
}
process.exit(bad ? 1 : 0);
