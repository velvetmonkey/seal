#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Enforce that the fresh-build pin and its merge ledger describe this commit.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  ROOT,
  buildDist,
  removeScratch,
  quotedTreeHashHits,
  treeSha256FromBuiltArtifact,
} = require("./installed-tree-pin.cjs");

const INSTALL = path.join(ROOT, "docs", "install.md");
const LEDGER = path.join(ROOT, "docs", "INSTALLED-TREE-REFRESHES.json");
const HASH = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

function fail(message) {
  process.stderr.write(`INSTALLED TREE PIN CHECK FAILED: ${message}\n`);
  process.exitCode = 1;
}

function readFile(relative, emptyCode) {
  const target = path.join(ROOT, relative);
  let stat;
  try { stat = fs.statSync(target); } catch (error) {
    fail(`${relative} is absent or unreadable: ${error.message}`); return null;
  }
  if (!stat.isFile() || (stat.mode & 0o444) === 0) {
    fail(`${relative} is absent or unreadable`); return null;
  }
  try {
    const text = fs.readFileSync(target, "utf8");
    if (emptyCode && text.length === 0) { fail(`${relative} is empty`); return null; }
    return text;
  } catch (error) { fail(`${relative} is absent or unreadable: ${error.message}`); return null; }
}

function git(args) {
  return spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8" });
}

function freshPin(text) {
  const hits = quotedTreeHashHits(text, "docs/install.md").filter((hit) => hit.role === "fresh-build");
  return hits.length === 1 ? hits[0].hash : null;
}

function main() {
  const text = readFile("docs/install.md", true);
  const ledgerText = readFile("docs/INSTALLED-TREE-REFRESHES.json", true);
  if (text === null || ledgerText === null) return;
  let ledger;
  try { ledger = JSON.parse(ledgerText); } catch (error) { fail(`ledger is invalid JSON: ${error.message}`); return; }
  if (!ledger || ledger.version !== 1 || !Array.isArray(ledger.entries) || ledger.entries.length === 0) {
    fail("ledger is missing a non-empty entries array"); return;
  }
  let fresh;
  try { fresh = quotedTreeHashHits(text, "docs/install.md").filter((hit) => hit.role === "fresh-build"); }
  catch (error) { fail(error.message); return; }
  if (fresh.length !== 1) { fail(`docs/install.md must contain exactly one fresh-build pin; found ${fresh.length}`); return; }
  const { out, built, identity } = buildDist();
  let expected;
  try { expected = treeSha256FromBuiltArtifact(out, built.stdout, identity); } finally { removeScratch(out); }
  if (fresh[0].hash !== expected) {
    fail(`docs/install.md:${fresh[0].line} fresh-build pin ${fresh[0].hash} does not match built tree ${expected}`); return;
  }
  const entry = ledger.entries.at(-1);
  if (!HASH.test(entry?.old || "") || !HASH.test(entry?.new || "") || !COMMIT.test(entry?.merge || "")) {
    fail("latest ledger entry must contain 64-hex old/new values and a 40-hex merge SHA"); return;
  }
  if (entry.new !== expected) { fail(`latest ledger new value ${entry.new} does not match built tree ${expected}`); return; }
  if (ledger.entries.length === 1) {
    const parent = git(["rev-parse", "HEAD^"]);
    if (parent.status === 0) {
      const previous = git(["show", `${parent.stdout.trim()}:docs/install.md`]);
      const previousPin = previous.status === 0 ? freshPin(previous.stdout) : null;
      if (previousPin && entry.old !== previousPin) { fail(`latest ledger old value ${entry.old} does not match parent pin ${previousPin}`); return; }
    }
  } else {
    const previous = ledger.entries.at(-2);
    if (entry.old !== previous?.new) { fail("latest ledger old value does not chain from the previous refresh"); return; }
  }
  if (entry.merge !== git(["rev-parse", "HEAD"]).stdout.trim() && git(["cat-file", "-e", `${entry.merge}^{commit}`]).status !== 0) {
    fail(`latest ledger merge SHA is not a repository commit: ${entry.merge}`); return;
  }
  process.stdout.write(`INSTALLED TREE PIN CHECK OK: docs/install.md:${fresh[0].line} ${expected}; recorded merge ${entry.merge}.\n`);
}

main();
