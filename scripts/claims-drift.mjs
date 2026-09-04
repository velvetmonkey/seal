#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Claims drift guard. Credibility-critical claim text is mirrored across
// surfaces; this asserts each mirror is a verbatim copy of its canonical block,
// so drift fails loudly instead of shipping silently.
//
// The canonical non-claims block (<!-- claims:begin --> ... <!-- claims:end -->)
// lives in docs/archive/LIMITATIONS.md and is mirrored in docs/assurance/index.html. The README links
// to the canonical honesty surface instead of duplicating it.
//
// Exit codes: 0 in sync · 1 drift (diff printed) · 2 markers missing/malformed.
// Node only, no dependencies. Run: node scripts/claims-drift.mjs
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(process.env.SEAL_CLAIMS_DRIFT_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));

const BLOCKS = [
  { begin: "<!-- claims:begin -->", end: "<!-- claims:end -->", // CLAIM-COVERAGE: docs/archive/LIMITATIONS.md#claims-block; CLAIM-COVERAGE: docs/assurance/index.html#claims-block
    canonical: "docs/archive/LIMITATIONS.md", mirrors: ["docs/assurance/index.html"] },
  { begin: "<!-- truthbox:begin -->", end: "<!-- truthbox:end -->", // CLAIM-COVERAGE: docs/archive/TRUTH-BOX.md#truth-box; CLAIM-COVERAGE: docs/assurance/index.html#truth-box
    canonical: "docs/archive/TRUTH-BOX.md", mirrors: ["docs/assurance/index.html"] },
];

const CLAIM_MANIFEST = [
  ["docs/archive/LIMITATIONS.md", "Lane C runs a wasm-vs-interpreted-Lean differential in seal-host CI over a fixed corpus; it is evidence over that corpus, not a universal binary-equals-model proof."],
];

const ARCHIVE_CLAIM_PAGE = "docs/archive/README.md"; // CLAIM-COVERAGE: docs/archive/README.md#archive-count
const ARCHIVE_CLAIM_MANIFEST = "scripts/claim-bearing-files.json";
const EXPECTED_ARCHIVE_CLAIM_FILES = 19;
const LINKCHECK_SCRIPT = "scripts/linkcheck.mjs";
const LINKCHECK_TEST = "test/linkcheck.test.mjs";

if (BLOCKS.length === 0) {
  console.error("ERROR claims-drift block population is empty; refusing to treat silence as complete claim synchronization");
  process.exit(1);
}

// FAMILY-SHARED:BEGIN core
let fatal = false;

function fatalError(message) {
  fatal = true;
  console.error(message);
}

function extract(file, begin, end) {
  let text;
  try {
    text = readFileSync(resolve(ROOT, file), "utf8");
  } catch (e) {
    fatalError(`ERROR  ${file}: ${e.message}`);
    return null;
  }
  const i = text.indexOf(begin);
  const j = text.indexOf(end);
  if (i === -1 || j === -1 || j < i) {
    fatalError(`ERROR  ${file}: markers missing or malformed (need ${begin} ... ${end})`);
    return null;
  }
  if (text.indexOf(begin, i + 1) !== -1 || text.indexOf(end, j + 1) !== -1) {
    fatalError(`ERROR  ${file}: multiple ${begin} pairs — exactly one region per file`);
    return null;
  }
  return text.slice(i + begin.length, j);
}
// FAMILY-SHARED:END core

// Per-line trim + drop blanks; strip any HTML <pre> wrapper. The claim text
// itself contains no HTML entities or tags, so tag-stripping is safe.
function normalise(block) {
  return block
    .replace(/<pre[^>]*>/g, "")
    .replace(/<\/pre>/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

// FAMILY-SHARED:BEGIN evaluation
let drift = false;
if (CLAIM_MANIFEST.length === 0) fatalError("ERROR  CLAIM_MANIFEST must contain at least one claim");
for (const blk of BLOCKS) {
  const canonicalBlock = extract(blk.canonical, blk.begin, blk.end);
  const canonical = canonicalBlock === null ? null : normalise(canonicalBlock);
  if (!canonical) {
    if (canonical !== null) {
      fatalError(`ERROR  ${blk.canonical}: canonical block is empty`);
    }
    for (const file of blk.mirrors) extract(file, blk.begin, blk.end);
    continue;
  }
  for (const file of blk.mirrors) {
    const mirrorBlock = extract(file, blk.begin, blk.end);
    if (mirrorBlock === null) continue;
    const got = normalise(mirrorBlock);
    if (got === canonical) {
      console.log(`PASS  ${file} matches ${blk.canonical}`);
      continue;
    }
    drift = true;
    console.error(`FAIL  ${file} diverges from ${blk.canonical}:`);
    const a = canonical.split("\n");
    const b = got.split("\n");
    for (let k = 0; k < Math.max(a.length, b.length); k++) {
      if (a[k] !== b[k]) {
        console.error(`  line ${k + 1}:`);
        console.error(`    canonical : ${a[k] ?? "<missing>"}`);
        console.error(`    ${file.padEnd(12)}: ${b[k] ?? "<missing>"}`);
      }
    }
  }
}

for (const [file, claim] of CLAIM_MANIFEST) {
  let text;
  try { text = readFileSync(resolve(ROOT, file), "utf8"); }
  catch (e) {
    fatalError(`ERROR  claim manifest entry ${file}: ${e.message}`);
    continue;
  }
  if (text.includes(claim)) console.log(`PASS  ${file} contains repaired claim`);
  else { drift = true; console.error(`FAIL  ${file} missing repaired claim: ${claim}`); }
}

if (drift) {
  console.error("\nCLAIMS DRIFT — edit the canonical file first, then mirror verbatim.");
  if (!fatal) process.exitCode = 1;
}
if (fatal) {
  process.exitCode = 2;
}
if (!drift && !fatal) {
  console.log("all claim blocks in sync across all surfaces");
}
// FAMILY-SHARED:END evaluation

let factDrift = false;
let archiveManifest;
try {
  archiveManifest = JSON.parse(readFileSync(resolve(ROOT, ARCHIVE_CLAIM_MANIFEST), "utf8"));
} catch (e) {
  fatalError(`ERROR  ${ARCHIVE_CLAIM_MANIFEST}: ${e.message}`);
}
if (archiveManifest) {
  const files = archiveManifest.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    fatalError(`ERROR  ${ARCHIVE_CLAIM_MANIFEST}: files must be an object`);
  } else {
    const archiveFiles = Object.keys(files).filter((file) => file.startsWith("docs/archive/"));
    if (archiveFiles.length === EXPECTED_ARCHIVE_CLAIM_FILES) {
      console.log(`PASS  ${ARCHIVE_CLAIM_MANIFEST} registers ${EXPECTED_ARCHIVE_CLAIM_FILES} archive files`);
    } else {
      factDrift = true;
      console.error(`FAIL  ${ARCHIVE_CLAIM_MANIFEST} registers ${archiveFiles.length} archive files; expected ${EXPECTED_ARCHIVE_CLAIM_FILES}`);
    }
  }
}

let linkcheckScript;
let linkcheckTest;
try { linkcheckScript = readFileSync(resolve(ROOT, LINKCHECK_SCRIPT), "utf8"); }
catch (e) { fatalError(`ERROR  ${LINKCHECK_SCRIPT}: ${e.message}`); }
try { linkcheckTest = readFileSync(resolve(ROOT, LINKCHECK_TEST), "utf8"); }
catch (e) { fatalError(`ERROR  ${LINKCHECK_TEST}: ${e.message}`); }
if (linkcheckScript !== undefined && linkcheckTest !== undefined) {
  const linkcheckSpecifier = String.raw`(?:\.\./scripts/linkcheck\.mjs|${LINKCHECK_SCRIPT})`;
  const takesProductLogic = new RegExp(
    String.raw`(?:\bfrom\s*["']${linkcheckSpecifier}["']|\bimport\s*\(\s*["']${linkcheckSpecifier}["']|\brequire\s*\(\s*["']${linkcheckSpecifier}["'])`,
    "u",
  ).test(linkcheckTest);
  const runsProduct = linkcheckTest.includes(`path.join(ROOT, "${LINKCHECK_SCRIPT}")`);
  const hasIndependentPopulation = linkcheckTest.includes("function expectedTargets()")
    && linkcheckTest.includes("assert.deepEqual(scanned, expectedTargets()");
  if (!takesProductLogic && runsProduct && hasIndependentPopulation && linkcheckScript.length > 0) {
    console.log(`PASS  ${LINKCHECK_TEST} cross-checks ${LINKCHECK_SCRIPT} without importing or requiring it`);
  } else {
    factDrift = true;
    console.error(`FAIL  ${LINKCHECK_TEST} must execute ${LINKCHECK_SCRIPT} and reconstruct expected targets without importing or requiring product logic`);
  }
}

if (factDrift) {
  console.error("\nCLAIMS FACT DRIFT — repair the source fact, not its assertion sentence.");
  if (!fatal) process.exitCode = 1;
}
if (fatal) process.exitCode = 2;
if (!factDrift && !fatal) console.log("all source fact checks pass");
