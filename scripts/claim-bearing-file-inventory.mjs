#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Fail-closed inventory for human-facing statements about Seal.
// Run: node scripts/claim-bearing-file-inventory.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "scripts/claim-bearing-files.json";

// A prose file is claim-bearing when it names a Seal product entity and makes a
// decidable assertion about it.  These two bounded patterns deliberately catch
// both "Seal runs ..." and "the hosted seal-check page runs ...".
const PRODUCT_ENTITY = /\b(?:seal(?:-check)?|seal[- ]?(?:demo|protect|checker|kernel)|approval gate|guarded (?:tool|path|action)|receipt checker|landing page)\b/i;
const ASSERTION = /\b(?:is|are|was|were|has|have|does|do|will|would|can|cannot|can't|must|should|supports?|requires?|runs?|executes?|checks?|verifies?|writes?|creates?|refuses?|gates?|protects?|controls?|proves?|prevents?|allows?|denies?|blocks?|forwards?|ships?|uses?|works?|matches?)\b/i;
const PROSE_EXTENSIONS = new Set([".md", ".html"]);
const NON_PROSE_EXTENSIONS = new Set([".cjs", ".mjs", ".js", ".json", ".yml", ".yaml", ".sh", ".png", ".wasm"]);
const NON_PROSE_PATHS = new Set([".gitignore", "LICENSE", "SHA256SUMS", "VERSION", "bin/seal"]);

let bad = false;
function fail(message) { console.error(`FAIL  ${message}`); bad = true; }
function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean).sort();
  } catch (error) {
    fail(`cannot enumerate tracked files: ${error.message}`);
    return [];
  }
}
function classify(path) {
  if (NON_PROSE_PATHS.has(path) || NON_PROSE_EXTENSIONS.has(extname(path))) return "non-prose";
  if (PROSE_EXTENSIONS.has(extname(path))) return "prose";
  return "unclassified";
}
function carriesClaim(text) {
  // Split at sentence/line boundaries so an entity and predicate must be close.
  return text.split(/[.!?\n]+/).some((unit) => PRODUCT_ENTITY.test(unit) && ASSERTION.test(unit));
}
let manifest;
try { manifest = JSON.parse(readFileSync(resolve(ROOT, MANIFEST), "utf8")); }
catch (error) { fail(`cannot read ${MANIFEST}: ${error.message}`); manifest = { files: {} }; }
if (!manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) {
  fail(`${MANIFEST}: files must be an object`);
  manifest.files = {};
}

const inventory = [];
for (const path of trackedFiles()) {
  const kind = classify(path);
  if (kind === "unclassified") { fail(`${path}: file kind is unclassified`); continue; }
  if (kind === "non-prose") continue;
  let text;
  try { text = readFileSync(resolve(ROOT, path), "utf8"); }
  catch (error) { fail(`${path}: cannot read prose file: ${error.message}`); continue; }
  if (carriesClaim(text)) inventory.push(path);
}
for (const [path, entry] of Object.entries(manifest.files)) {
  if (!inventory.includes(path)) fail(`${path}: manifest entry is not a current claim-bearing file`);
  if (!entry || typeof entry !== "object") { fail(`${path}: manifest entry must be an object`); continue; }
  const covered = Array.isArray(entry.coveredBy) && entry.coveredBy.length > 0
    && entry.coveredBy.every((item) => typeof item === "string" && /^[^:]+:\d+\b/.test(item));
  const reason = entry.allowlistReason;
  if (!covered && (typeof reason !== "string" || reason.trim() === "")) {
    fail(`${path}: no covering check and allowlistReason is empty`);
  }
  if (covered && typeof reason === "string" && reason.trim() !== "") {
    fail(`${path}: choose coveredBy or allowlistReason, not both`);
  }
}
for (const path of inventory) if (!(path in manifest.files)) fail(`${path}: new claim-bearing file is neither covered nor allowlisted`);

console.log(`claim-bearing inventory: ${inventory.length} files`);
for (const path of inventory) {
  const entry = manifest.files[path];
  const status = entry?.coveredBy?.length ? `COVERED by ${entry.coveredBy.join(", ")}` : `ALLOWLISTED: ${entry?.allowlistReason ?? "<missing>"}`;
  console.log(`${path}\t${status}`);
}
process.exit(bad ? 1 : 0);
