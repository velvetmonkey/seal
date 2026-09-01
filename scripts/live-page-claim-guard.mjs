#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Live landing-page truth guard. Unlike a link check, this reads the bytes
// actually served by seal-check and compares both its identity and literal
// <button> controls with the evaluator walk's marked live-page claims.
//
// Scope: this guard proves only that its required public-page sentence exists, two
// named old phrasings are absent, the fetched HTML has no literal <button> tag,
// and that complete HTML equals this frozen pin. It does not inspect or execute
// app.js or wasm/seal.js. A green result cannot show that the page executes
// nothing, or that no MCP tool-call runs.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const URL = process.env.LIVE_CLAIM_GUARD_URL ?? "https://velvetmonkey.github.io/seal-check/";
const PAGE_RELATIVE = process.env.LIVE_CLAIM_GUARD_PAGE_RELATIVE ?? "docs/start/evaluator-walk.md";
const PAGE = process.env.LIVE_CLAIM_GUARD_PAGE ?? process.env.LIVE_CLAIM_GUARD_README ?? resolve(ROOT, PAGE_RELATIVE);
const CLAIM_SITES = resolve(ROOT, "scripts/live-page-claim-sites.json");
const PIN = Object.freeze({
  commit: process.env.LIVE_CLAIM_GUARD_COMMIT ?? "0edfc3d44a5e10f2805e18a59fcd2b0438f2bb59",
  bytes: Number(process.env.LIVE_CLAIM_GUARD_BYTES ?? "12198"),
  sha256: process.env.LIVE_CLAIM_GUARD_SHA256 ?? "7af9e3360e42c2e36b5eec352b2e359c9bf215a39821ab79921194e0d5594269",
});
const PROVENANCE_URL = process.env.LIVE_CLAIM_GUARD_PROVENANCE_URL
  ?? `https://raw.githubusercontent.com/velvetmonkey/seal-check/${PIN.commit}/index.html`;
const PROVENANCE_PAGE = `https://github.com/velvetmonkey/seal-check/commit/${PIN.commit}`;
const RUNNER_TEMP = process.env.RUNNER_TEMP;
if (RUNNER_TEMP !== undefined && !existsSync(RUNNER_TEMP)) {
  console.error(`ERROR  RUNNER_TEMP operator-supplied path does not exist: ${resolve(RUNNER_TEMP)}; the live-page guard will not create it`);
  process.exit(2);
}
const CACHE_DIR = resolve(RUNNER_TEMP ?? tmpdir(), "live-page-claim-guard");
// The cache key is exactly the pinned Git commit. Git commits are immutable, so
// a source file cached under this key cannot become stale for this pin.
const CACHE_PATH = resolve(CACHE_DIR, `${encodeURIComponent(PIN.commit)}.index.html`);
let bad = false;
function fail(message) { console.error(`FAIL  ${message}`); bad = true; }

function claimRegions(page) {
  let sites;
  try { sites = JSON.parse(readFileSync(CLAIM_SITES, "utf8")); }
  catch (error) { fail(`live-page claim site manifest is unreadable: ${CLAIM_SITES}: ${error.message}`); return []; }
  if (!Array.isArray(sites) || sites.length === 0) {
    fail("live-page claim site manifest must be a non-empty array");
    return [];
  }
  const endpoint = "https://velvetmonkey.github.io/seal-check/";
  const lineStarts = [0];
  for (let at = page.indexOf("\n"); at !== -1; at = page.indexOf("\n", at + 1)) lineStarts.push(at + 1);
  const declared = new Set();
  const regions = [];
  for (const site of sites) {
    const key = `${site.file}:${site.line}:${site.column}`;
    if (site.file !== PAGE_RELATIVE || !Number.isSafeInteger(site.line) || !Number.isSafeInteger(site.column) || site.line < 1 || site.column < 1) {
      fail(`live-page claim site manifest has invalid site ${key}`);
      continue;
    }
    if (declared.has(key)) { fail(`live-page claim site manifest has duplicate site ${key}`); continue; }
    declared.add(key);
    const begin = lineStarts[site.line - 1] + site.column - 1;
    if (!Number.isSafeInteger(begin) || !page.startsWith(endpoint, begin)) {
      fail(`public page is missing declared live-page claim site ${key}`);
      continue;
    }
    const lineBegin = lineStarts[site.line - 1];
    const paragraphEnd = page.indexOf("\n\n", begin);
    const end = paragraphEnd === -1 ? page.length : paragraphEnd;
    regions.push({ begin: lineBegin, end, text: page.slice(lineBegin, end) });
  }
  for (let at = page.indexOf(endpoint); at !== -1; at = page.indexOf(endpoint, at + endpoint.length)) {
    const line = page.slice(0, at).split("\n").length;
    const lineStart = page.lastIndexOf("\n", at - 1) + 1;
    const key = `${PAGE_RELATIVE}:${line}:${at - lineStart + 1}`;
    if (!declared.has(key)) fail(`public-page live-page behaviour sentence at byte ${at} is outside the checked site manifest`);
  }
  if (regions.length === 0) fail("public page has no checked live-page claim site");
  return regions;
}

let page;
try { page = readFileSync(PAGE, "utf8"); }
catch (error) { console.error(`ERROR  cannot read public-page claim population ${PAGE}: ${error.message}`); process.exit(2); }
const regions = claimRegions(page);
const claims = regions.map((region) => region.text).join("\n");
if (!claims.includes("The landing page has **zero `<button>` controls**.")) {
  fail("checked public-page population must state: The landing page has **zero `<button>` controls**.");
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

if (buttons !== 0) fail(`landing page has ${buttons} <button> controls; checked public page claims zero`);
else console.log("INFO  landing-page control count: zero <button> controls");

let pinnedSource;
let sourceSha256;
try {
  pinnedSource = readFileSync(CACHE_PATH);
  sourceSha256 = createHash("sha256").update(pinnedSource).digest("hex");
  if (pinnedSource.length !== PIN.bytes || sourceSha256 !== PIN.sha256) {
    const byteCheck = pinnedSource.length === PIN.bytes ? "bytes match" : `bytes ${pinnedSource.length} != pin ${PIN.bytes}`;
    const digestCheck = sourceSha256 === PIN.sha256 ? "sha256 matches" : `sha256 ${sourceSha256} != pin ${PIN.sha256}`;
    console.error(`ERROR  PINNED SEAL-CHECK PROVENANCE MISMATCH for ${PIN.commit}: poisoned cache ${CACHE_PATH}; ${byteCheck}; ${digestCheck}`);
    process.exit(2);
  } else {
    console.log(`INFO  Pinned source cache hit for seal-check@${PIN.commit}; no provenance fetch`);
  }
} catch (error) {
  if (error.code !== "ENOENT") console.error(`WARN  cannot read pinned source cache ${CACHE_PATH}: ${error.message}`);
}

if (!pinnedSource) {
  console.log(`INFO  Fetching pinned seal-check@${PIN.commit} source: ${PROVENANCE_URL}`);
  try {
    const response = await fetch(PROVENANCE_URL, { redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      const failure = new Error(`HTTP ${response.status}`);
      failure.provenanceClass = response.status === 429 || response.status >= 500 ? "transient" : "substantive";
      throw failure;
    }
    pinnedSource = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    const headline = error.provenanceClass === "substantive"
      ? "PINNED SEAL-CHECK PROVENANCE MISMATCH"
      : "PINNED SEAL-CHECK PROVENANCE TRANSIENTLY UNREACHABLE";
    console.error(`ERROR  ${headline} for ${PIN.commit}: ${error.message}`);
    console.error("ERROR  refusing a green result because pinned commit bytes were not checked");
    process.exit(2);
  }
  sourceSha256 = createHash("sha256").update(pinnedSource).digest("hex");
}

if (pinnedSource.length !== PIN.bytes || sourceSha256 !== PIN.sha256) {
  const byteCheck = pinnedSource.length === PIN.bytes ? "bytes match" : `bytes ${pinnedSource.length} != pin ${PIN.bytes}`;
  const digestCheck = sourceSha256 === PIN.sha256 ? "sha256 matches" : `sha256 ${sourceSha256} != pin ${PIN.sha256}`;
  console.error(`ERROR  PINNED SEAL-CHECK PROVENANCE MISMATCH for ${PIN.commit}: ${byteCheck}; ${digestCheck}`);
  process.exit(2);
}
try {
  mkdirSync(CACHE_DIR, { recursive: true });
  const temporaryPath = `${CACHE_PATH}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, pinnedSource);
  renameSync(temporaryPath, CACHE_PATH);
} catch (error) {
  console.error(`WARN  cannot write pinned source cache ${CACHE_PATH}: ${error.message}`);
}
if (!pinnedSource.equals(body)) {
  fail(`served landing page differs from seal-check@${PIN.commit}: expected ${PIN.bytes} bytes sha256 ${PIN.sha256}; got ${body.length} bytes sha256 ${sha256}`);
  console.error(`INFO  Confirm the candidate release's provenance before repinning: ${PROVENANCE_PAGE}`);
  console.error(`DIFF  ${changedRegion(pinnedSource.toString("utf8"), text)}`);
  console.error("INFO  After reviewing that provenance and this changed region, update the commit, byte count, and sha256 together in scripts/live-page-claim-guard.mjs.");
} else if (body.length !== PIN.bytes || sha256 !== PIN.sha256) {
  fail(`served landing page differs from seal-check@${PIN.commit}: expected ${PIN.bytes} bytes sha256 ${PIN.sha256}; got ${body.length} bytes sha256 ${sha256}`);
} else {
  console.log(`INFO  served bytes match pinned seal-check@${PIN.commit}`);
}
process.exit(bad ? 1 : 0);
