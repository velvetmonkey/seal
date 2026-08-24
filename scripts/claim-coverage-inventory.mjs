#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Family claim-surface accounting. This names uncovered prose as debt; it
// does not pretend the debt is covered.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST = path.join(process.env.FAMILY_SEAL_ROOT ?? ROOT, "scripts/claim-coverage-allowlist.json");
const REPOS = [
  ["seal", process.env.FAMILY_SEAL_ROOT ?? ROOT],
  ["seal-check", process.env.FAMILY_SEAL_CHECK_ROOT ?? path.join(ROOT, ".family/seal-check")],
  ["seal-demo", process.env.FAMILY_SEAL_DEMO_ROOT ?? path.join(ROOT, ".family/seal-demo")],
  ["seal-live-demo", process.env.FAMILY_SEAL_LIVE_DEMO_ROOT ?? path.join(ROOT, ".family/seal-live-demo")],
  ["seal-verify-action", process.env.FAMILY_SEAL_VERIFY_ACTION_ROOT ?? path.join(ROOT, ".family/seal-verify-action")],
  ["seal-assurance-kit", process.env.FAMILY_SEAL_ASSURANCE_KIT_ROOT ?? path.join(ROOT, ".family/seal-assurance-kit")],
  ["mcp-seal-dev", process.env.FAMILY_MCP_SEAL_DEV_ROOT ?? path.join(ROOT, ".family/mcp-seal-dev")],
];
// Sibling repositories are supplied separately through REPOS. Do not recurse
// into their CI checkout parent while walking the Seal checkout.
const SKIP = new Set([".git", ".family", "node_modules", "test", "fixtures", "vendor"]);
const CLAIM_WORDS = /what (it )?proves|proven|tested|not claimed|non-claim|claim:|claims|truth box|limitation|assurance|guarantee|does not/i;
const ENTRY_NAMES = /^(README\.md|EVALUATOR-START\.md|CLAIMS\.md|LIMITATIONS\.md|TRUTH-BOX\.md|index\.html)$/i;
// These fetched sibling pages make claims but have no entry in their
// repository's claims-drift manifest. Keep that debt visible as named gaps;
// an uncovered page is never reclassified as substring coverage.
const DECLARED_GAPS = new Set([
  "seal-live-demo/docs/ARCHITECTURE.md",
  "seal-assurance-kit/docs/ARCHITECTURE.md",
]);

function walk(root, dir = root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(root, full, out);
    else if (/\.(md|html)$/i.test(entry.name)) {
      const text = fs.readFileSync(full, "utf8");
      if (ENTRY_NAMES.test(entry.name) || CLAIM_WORDS.test(text)) out.push(full);
    }
  }
  return out;
}

function guardCoverage(repo, root) {
  const scriptPath = path.join(root, "scripts/claims-drift.mjs");
  const source = fs.readFileSync(scriptPath, "utf8");
  const full = new Set();
  for (const match of source.matchAll(/canonical:\s*["']([^"']+)["']\s*,\s*mirrors:\s*\[([^\]]*)\]/g)) {
    full.add(match[1]);
    for (const mirror of match[2].matchAll(/["']([^"']+)["']/g)) full.add(mirror[1]);
  }
  const substring = new Set();
  const manifest = source.match(/const CLAIM_MANIFEST = \[([\s\S]*?)\];/);
  for (const match of (manifest?.[1] ?? "").matchAll(/\[\s*["']([^"']+)["']/g)) substring.add(match[1]);
  const declared = new Set();
  const declarationPath = path.join(root, "scripts/claim-bearing-files.json");
  if (fs.existsSync(declarationPath)) {
    const declarations = JSON.parse(fs.readFileSync(declarationPath, "utf8")).files;
    if (!declarations || typeof declarations !== "object" || Array.isArray(declarations)) {
      throw new Error(`${declarationPath}: files must be an object`);
    }
    for (const [claimFile, entry] of Object.entries(declarations)) {
      if (!Array.isArray(entry?.coveredBy) || entry.coveredBy.length === 0) continue;
      for (const reference of entry.coveredBy) {
        const parsed = /^(.*):(\d+)$/.exec(reference);
        if (!parsed || !parsed[1] || Number(parsed[2]) < 1) {
          throw new Error(`${declarationPath}: ${claimFile} coveredBy ${JSON.stringify(reference)} must be path:line`);
        }
        const proofPath = path.join(root, parsed[1]);
        const line = fs.readFileSync(proofPath, "utf8").split(/\r?\n/)[Number(parsed[2]) - 1];
        if (line === undefined || !line.includes(`CLAIM-COVERAGE: ${claimFile}`)) {
          throw new Error(`${declarationPath}: ${claimFile} coveredBy ${JSON.stringify(reference)} lacks its CLAIM-COVERAGE binding`);
        }
      }
      declared.add(claimFile);
    }
  }
  return { repo, full, substring, declared };
}

function main() {
  const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST, "utf8")).uncovered;
  if (!Array.isArray(allowlist) || new Set(allowlist).size !== allowlist.length) throw new Error("allowlist must be a unique array");
  const rows = [];
  for (const [repo, root] of REPOS) {
    if (!fs.existsSync(root)) {
      console.error(`FINDING required family checkout missing: ${repo} (${root})`);
      process.exitCode = 1;
      return;
    }
    const coverage = guardCoverage(repo, root);
    for (const file of walk(root)) {
      const local = path.relative(root, file).replaceAll(path.sep, "/");
      const rel = `${repo}/${local}`;
      // A family allowlist entry deliberately retains uncovered-debt status.
      // Otherwise, a locally validated coveredBy declaration is real partial
      // coverage and must not disappear merely because it is not claims-drift.
      const locallyDeclared = coverage.declared.has(local) && !allowlist.includes(rel);
      const kind = coverage.full.has(local) ? "full" : coverage.substring.has(local) || locallyDeclared ? "substring" : "uncovered";
      rows.push({ file: rel, kind });
    }
  }
  if (rows.length === 0) {
    console.error("ERROR family claim-bearing population is empty; refusing to treat silence as complete claim coverage");
    process.exitCode = 1;
    return;
  }
  const counts = Object.fromEntries(["full", "substring", "uncovered"].map((kind) => [kind, rows.filter((row) => row.kind === kind).length]));
  const actualUncovered = rows.filter((row) => row.kind === "uncovered").map((row) => row.file).sort();
  const listed = [...allowlist].sort();
  const declared = actualUncovered.filter((file) => DECLARED_GAPS.has(file));
  const missing = actualUncovered.filter((file) => !allowlist.includes(file) && !DECLARED_GAPS.has(file));
  const stale = allowlist.filter((file) => !actualUncovered.includes(file));
  const staleGaps = [...DECLARED_GAPS].filter((file) => !actualUncovered.includes(file));
  console.log(`CLAIM COVERAGE: full=${counts.full} substring=${counts.substring} uncovered=${counts.uncovered} allowlisted=${allowlist.length} declared-gaps=${declared.length}`);
  for (const file of declared) console.log(`GAP uncovered claim-bearing file declared: ${file}`);
  if (missing.length) console.error(`FAIL uncovered claim-bearing files not allowlisted: ${missing.join(", ")}`);
  if (stale.length) console.error(`FAIL allowlist names covered or absent files: ${stale.join(", ")}`);
  if (staleGaps.length) console.error(`FAIL declared gaps name covered or absent files: ${staleGaps.join(", ")}`);
  if (missing.length || stale.length || staleGaps.length) process.exitCode = 1;
  else console.log("PASS every uncovered claim-bearing file is explicitly allowlisted or declared as a gap");
}

main();
