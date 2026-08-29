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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BLOCKS = [
  { begin: "<!-- claims:begin -->", end: "<!-- claims:end -->", // CLAIM-COVERAGE: docs/archive/LIMITATIONS.md#claims-block; CLAIM-COVERAGE: docs/assurance/index.html#claims-block
    canonical: "docs/archive/LIMITATIONS.md", mirrors: ["docs/assurance/index.html"] },
];

const CLAIM_MANIFEST = [
  ["docs/archive/LIMITATIONS.md", "Lane C runs a wasm-vs-interpreted-Lean differential in seal-host CI over a fixed corpus; it is evidence over that corpus, not a universal binary-equals-model proof."],
  ["docs/archive/README.md", "This archive has eighteen files registered with claim-bearing-file-inventory; removing its WHAT-IS document makes that check fail, removing AUTHORIZATION-RECORD.md makes claim-coverage-inventory fail, and removing this README makes claims-drift fail."],
  ["docs/archive/TRUTH-BOX.md", "non-claim. index.html mirrors these three lines verbatim between the same"], // CLAIM-COVERAGE: docs/archive/TRUTH-BOX.md#claims-drift
  ["docs/assurance/linkcheck-population-control.md", "separate-source\ncross-check"],
];

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
