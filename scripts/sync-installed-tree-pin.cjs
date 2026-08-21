#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Derive every installed-tree documentation pin from its authoritative bytes.
const fs = require("node:fs");
const path = require("node:path");

const {
  ROOT,
  buildDist,
  publishedTreeSha256FromRelease,
  quotedTreeHashHits,
  removeScratch,
  trackedFiles,
  treeSha256FromBuiltArtifact,
} = require("./installed-tree-pin.cjs");

const SITE_MANIFEST = path.join(ROOT, "scripts", "installed-tree-pin-sites.json");

function refuse(code, reason) {
  throw new Error(`REFUSE ${code}: ${reason}`);
}

function readConsumedFile(relative) {
  const target = path.join(ROOT, relative);
  let stat;
  try {
    stat = fs.statSync(target);
  } catch (error) {
    if (error && error.code === "ENOENT") refuse("input_absent", `${relative} is absent`);
    refuse("input_unreadable", `${relative} cannot be read: ${error.message}`);
  }
  if (!stat.isFile()) refuse("input_absent", `${relative} is not a file`);
  if ((stat.mode & 0o444) === 0) refuse("input_unreadable", `${relative} has no read bits`);
  let text;
  try {
    text = fs.readFileSync(target, "utf8");
  } catch (error) {
    refuse("input_unreadable", `${relative} cannot be read: ${error.message}`);
  }
  if (relative === "docs/start/install.md" && text.length === 0) {
    refuse("input_empty", `${relative} is empty`);
  }
  return text;
}

function rewriteHits(text, hits, hashes) {
  let rewritten = text;
  for (const hit of [...hits].sort((left, right) => right.index - left.index)) {
    const expected = hashes[hit.role];
    const hashIndex = text.indexOf(hit.hash, hit.index);
    if (hashIndex < hit.index) {
      refuse("hash_location_lost", `cannot locate ${hit.role} hash reported at offset ${hit.index}`);
    }
    rewritten = `${rewritten.slice(0, hashIndex)}${expected}${rewritten.slice(hashIndex + hit.hash.length)}`;
  }
  return rewritten;
}

function siteKey(site) {
  return `${site.file}:${site.line}:${site.column} ${site.kind} ${site.role}`;
}

function declaredSites() {
  const sites = JSON.parse(fs.readFileSync(SITE_MANIFEST, "utf8"));
  if (!Array.isArray(sites) || sites.length === 0) {
    refuse("pin_population_manifest_invalid", "installed-tree pin site manifest must be a non-empty array");
  }
  const keys = sites.map(siteKey);
  if (new Set(keys).size !== keys.length) {
    refuse("pin_population_manifest_invalid", "installed-tree pin site manifest contains duplicate sites");
  }
  return new Set(keys);
}

function assertDeclaredPopulation(discovered) {
  const declared = declaredSites();
  for (const key of declared) {
    if (!discovered.has(key)) refuse("pin_population_mismatch", `generator missing declared site ${key}`);
  }
  for (const key of discovered) {
    if (!declared.has(key)) refuse("pin_population_mismatch", `generator found undeclared site ${key}`);
  }
}

function main() {
  // build-dist loads sync-version, which also consumes this file. Validate it
  // here so missing content cannot escape as an anonymous dependency error.
  const installText = readConsumedFile("docs/start/install.md");

  // After the consumed-input preflight, build on every valid invocation. No
  // source file supplies a value that could be mistaken for a derived hash.
  const built = buildDist();
  let freshBuild;
  try {
    freshBuild = treeSha256FromBuiltArtifact(built.out, built.built.stdout, built.identity);
  } finally {
    removeScratch(built.out);
  }
  const hashes = {
    "fresh-build": freshBuild,
    "published-asset": publishedTreeSha256FromRelease(),
  };

  // Materialize every result in memory before the first write. In particular,
  // absent, unreadable, empty, or malformed inputs cannot cause partial output.
  const originals = new Map();
  const rewrites = new Map();
  const discoveredSites = new Set();
  let freshHits = 0;
  let publishedHits = 0;
  for (const relative of trackedFiles()) {
    const text = relative === "docs/start/install.md" ? installText : readConsumedFile(relative);
    const hits = quotedTreeHashHits(text, relative);
    for (const hit of hits) {
      const lineStart = text.lastIndexOf("\n", hit.index - 1) + 1;
      const kind = text.slice(hit.index).startsWith("tree") ? "tree" : "store";
      discoveredSites.add(siteKey({
        file: relative,
        line: hit.line,
        column: hit.index - lineStart + 1,
        kind,
        role: hit.role,
      }));
      if (hit.role === "fresh-build") freshHits += 1;
      else publishedHits += 1;
    }
    originals.set(relative, text);
    rewrites.set(relative, rewriteHits(text, hits, hashes));
  }
  assertDeclaredPopulation(discoveredSites);
  if (freshHits === 0) refuse("fresh_build_pin_absent", "no fresh-build installed-tree hash is quoted");
  if (publishedHits === 0) refuse("published_asset_pin_absent", "no published-asset installed-tree hash is quoted");

  let changed = 0;
  for (const [relative, rewritten] of rewrites) {
    if (rewritten === originals.get(relative)) continue;
    fs.writeFileSync(path.join(ROOT, relative), rewritten);
    changed += 1;
  }
  process.stdout.write(
    `fresh-build ${hashes["fresh-build"]}\n` +
      `published-asset ${hashes["published-asset"]}\n` +
      `updated ${changed} file${changed === 1 ? "" : "s"}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error && error.message ? error.message : error}\n`);
  process.exitCode = 1;
}
