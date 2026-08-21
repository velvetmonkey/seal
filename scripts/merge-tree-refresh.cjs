#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Merge transaction: materialise the post-merge tree, then refresh and record.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  buildDist,
  removeScratch,
  quotedTreeHashHits,
  treeSha256FromBuiltArtifact,
} = require("./installed-tree-pin.cjs");

const ROOT = path.join(__dirname, "..");
const LEDGER = path.join(ROOT, "docs", "INSTALLED-TREE-REFRESHES.json");
const HASH = /^[0-9a-f]{64}$/;
const FRESH_BUILD_LINE = 68;

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
}

function pin() {
  const text = fs.readFileSync(path.join(ROOT, "docs/install.md"), "utf8");
  const match = text.match(/\*\*Seal installed-tree pin role:\*\* `fresh-build`[\s\S]*?tree: ([0-9a-f]{64})/);
  if (!match) throw new Error("REFUSE fresh_build_pin_absent: docs/install.md has no fresh-build tree pin");
  return match[1];
}

function publishedPins(text) {
  return quotedTreeHashHits(text, "docs/install.md")
    .filter((hit) => hit.role === "published-asset")
    .map((hit) => ({ line: hit.line, hash: hit.hash }));
}

function refusePublishedRewrite(before, after) {
  const prior = publishedPins(before);
  const current = publishedPins(after);
  if (prior.length !== current.length) {
    throw new Error("REFUSE published_asset_pin: docs/install.md role published-asset population changed");
  }
  for (let index = 0; index < prior.length; index += 1) {
    if (prior[index].line !== current[index].line || prior[index].hash !== current[index].hash) {
      throw new Error(`REFUSE published_asset_pin: docs/install.md:${current[index]?.line ?? prior[index].line} role published-asset is immutable`);
    }
  }
}

function refreshFreshBuildPin() {
  const text = fs.readFileSync(path.join(ROOT, "docs/install.md"), "utf8");
  const hits = quotedTreeHashHits(text, "docs/install.md").filter((hit) => hit.role === "fresh-build");
  if (hits.length !== 1 || hits[0].line !== FRESH_BUILD_LINE) {
    throw new Error(`REFUSE fresh_build_pin_site: expected exactly docs/install.md:${FRESH_BUILD_LINE} fresh-build pin; found ${hits.length}`);
  }
  const built = buildDist();
  let fresh;
  try { fresh = treeSha256FromBuiltArtifact(built.out, built.built.stdout, built.identity); }
  finally { removeScratch(built.out); }
  const hit = hits[0];
  const at = text.indexOf(hit.hash, hit.index);
  if (at < hit.index) throw new Error("REFUSE hash_location_lost: cannot locate docs/install.md fresh-build hash");
  fs.writeFileSync(path.join(ROOT, "docs/install.md"), `${text.slice(0, at)}${fresh}${text.slice(at + hit.hash.length)}`);
}

function mergeInProgress() {
  return spawnSync("git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { cwd: ROOT, encoding: "utf8" }).status === 0;
}

function main() {
  const merge = process.argv[2];
  if (!merge || process.argv.length !== 3) throw new Error("usage: node scripts/merge-tree-refresh.cjs <branch-or-commit>");
  const before = fs.readFileSync(path.join(ROOT, "docs/install.md"), "utf8");
  run("git", ["merge", "--no-commit", "--no-ff", merge]);
  try {
    // Reject the merge before this writer runs if it would alter a published
    // claim. This is a refusal by the protected role, not a best-effort skip.
    refusePublishedRewrite(before, fs.readFileSync(path.join(ROOT, "docs/install.md"), "utf8"));
    const old = pin();
    refreshFreshBuildPin();
    const fresh = pin();
    if (!HASH.test(old) || !HASH.test(fresh)) throw new Error("REFUSE malformed fresh-build pin");
    const ledger = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
    if (!Array.isArray(ledger.entries)) throw new Error("REFUSE ledger_invalid: entries array is absent");
    run("git", ["add", "docs/install.md"]);
    run("git", ["commit", "--no-edit"]);
    const mergeSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(mergeSha)) throw new Error("REFUSE merge_sha_absent: refreshed merge commit is unavailable");
    ledger.entries.push({ old, new: fresh, merge: mergeSha });
    fs.writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
    run("git", ["add", "docs/INSTALLED-TREE-REFRESHES.json"]);
    run("git", ["commit", "-m", "Record installed-tree pin refresh"]);
    process.stdout.write(`Recorded refreshed merge ${mergeSha}: installed-tree pin ${old} -> ${fresh}.\n`);
  } catch (error) {
    if (mergeInProgress()) run("git", ["merge", "--abort"]);
    throw error;
  }
}

try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
