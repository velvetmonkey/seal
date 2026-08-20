#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// A documented release instruction names a tag independent of its transport.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ROOT = path.join(__dirname, "..");
function fail(message) { console.error(`FAIL published_claim: ${message}`); process.exit(1); }
function unknown(message) { console.error(`UNKNOWN published_claim: ${message}`); process.exit(2); }
function readClaimBearing(file) {
  const target = path.join(ROOT, file);
  let stat;
  try { stat = fs.statSync(target); } catch (error) {
    if (error.code === "ENOENT") fail(`${file} absent: ${target}`);
    fail(`${file} unreadable: ${target}: ${error.message}`);
  }
  if (!stat.isFile()) fail(`${file} unreadable: ${target}: not a regular file`);
  if ((stat.mode & 0o777) === 0) fail(`${file} unreadable: ${target}: mode 000 has no read permissions`);
  if (stat.size === 0) fail(`${file} empty: release claim instructions are absent`);
  try { return fs.readFileSync(target, "utf8"); }
  catch (error) { fail(`${file} unreadable: ${target}: ${error.message}`); }
}
function repo() {
  let remote;
  try { remote = execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd: ROOT, encoding: "utf8" }).trim(); }
  catch (error) { unknown(`cannot determine origin repository: ${error.message}`); }
  const match = remote.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) unknown(`origin is not a GitHub repository: ${remote}`);
  return `${match[1]}/${match[2]}`;
}
function trackedDocuments() {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT }).toString().split("\0").filter(Boolean);
  return files.filter((file) => !file.startsWith("test/") && /\.(md|html|txt|yml|yaml|cjs|mjs|js|sh)$/.test(file)).map((file) => ({ file, text: fs.readFileSync(path.join(ROOT, file), "utf8") }));
}
function instructionTags(documents) {
  const tagPattern = /\bv(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)/g;
  const tags = [];
  for (const { file, text } of documents) text.split(/\r?\n/).forEach((line, index) => {
    if (!/(release|download|artifact|SHA256SUMS|SEAL_VERSION|\b[A-Z_]*TAG[A-Z_]*\s*=|gh\s+(?:api|release)|curl|wget|wrapper)/i.test(line)) return;
    for (const match of line.matchAll(tagPattern)) tags.push({ tag: `v${match[1].replace(/-linux-x64$/, "").replace(/\.md$/, "")}`, file, line: index + 1, text: line.trim() });
  });
  return tags.filter((candidate, index, all) => all.findIndex((other) => other.tag === candidate.tag) === index);
}
async function main() {
  readClaimBearing("README.md");
  const documents = trackedDocuments();
  const tags = instructionTags(documents);
  if (!tags.length) fail("no documented release instruction names a release tag");
  const api = process.env.SEAL_RELEASES_API || `https://api.github.com/repos/${repo()}/releases?per_page=100`;
  let response;
  try { response = await fetch(api, { headers: { accept: "application/vnd.github+json" } }); }
  catch (error) { unknown(`cannot reach GitHub releases API: ${error.message}`); }
  if (!response.ok) unknown(`GitHub returned HTTP ${response.status} for ${api}`);
  let releases;
  try { releases = await response.json(); } catch (error) { unknown(`cannot parse GitHub releases response: ${error.message}`); }
  if (!Array.isArray(releases)) unknown("GitHub releases response was not an array");
  const unpublished = tags.filter(({ tag }) => !releases.some((release) => release.tag_name === tag));
  if (unpublished.length) {
    for (const claim of unpublished) console.error(`${claim.file}:${claim.line}: ${claim.text}`);
    fail(`documented release instruction names unpublished tag ${unpublished[0].tag}`);
  }
  console.log(`PASS published_claim: ${tags.map(({ tag }) => tag).join(", ")} are published release tags`);
}
main().catch((error) => unknown(`unanswerable release response: ${error.message}`));
