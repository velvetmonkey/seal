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
const SKIP = new Set([".git", "node_modules", "test", "fixtures", "vendor"]);
const CLAIM_WORDS = /what (it )?proves|proven|tested|not claimed|non-claim|claim:|claims|truth box|limitation|assurance|guarantee|does not/i;
const ENTRY_NAMES = /^(README\.md|EVALUATOR-START\.md|CLAIMS\.md|LIMITATIONS\.md|TRUTH-BOX\.md|index\.html)$/i;

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
  return { repo, full, substring };
}

function main() {
  const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST, "utf8")).uncovered;
  if (!Array.isArray(allowlist) || new Set(allowlist).size !== allowlist.length) throw new Error("allowlist must be a unique array");
  const rows = [];
  for (const [repo, root] of REPOS) {
    if (!fs.existsSync(root)) throw new Error(`${repo} checkout is missing: ${root}`);
    const coverage = guardCoverage(repo, root);
    for (const file of walk(root)) {
      const rel = `${repo}/${path.relative(root, file).replaceAll(path.sep, "/")}`;
      const kind = coverage.full.has(path.relative(root, file)) ? "full" : coverage.substring.has(path.relative(root, file)) ? "substring" : "uncovered";
      rows.push({ file: rel, kind });
    }
  }
  const counts = Object.fromEntries(["full", "substring", "uncovered"].map((kind) => [kind, rows.filter((row) => row.kind === kind).length]));
  const actualUncovered = rows.filter((row) => row.kind === "uncovered").map((row) => row.file).sort();
  const listed = [...allowlist].sort();
  const missing = actualUncovered.filter((file) => !allowlist.includes(file));
  const stale = allowlist.filter((file) => !actualUncovered.includes(file));
  console.log(`CLAIM COVERAGE: full=${counts.full} substring=${counts.substring} uncovered=${counts.uncovered} allowlisted=${allowlist.length}`);
  if (missing.length) console.error(`FAIL uncovered claim-bearing files not allowlisted: ${missing.join(", ")}`);
  if (stale.length) console.error(`FAIL allowlist names covered or absent files: ${stale.join(", ")}`);
  if (missing.length || stale.length) process.exitCode = 1;
  else console.log("PASS every uncovered claim-bearing file is explicitly allowlisted");
}

main();
