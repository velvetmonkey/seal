#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// VERSION is authoritative; reader-facing release instructions must name it.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const ROOT = path.join(__dirname, "..");
function fail(message) { console.error(`FAIL version_drift: ${message}`); process.exit(1); }
function readClaimBearing(file) {
  const target = path.join(ROOT, file);
  let stat;
  try { stat = fs.statSync(target); } catch (error) {
    if (error.code === "ENOENT") fail(`${file} absent: ${target}`);
    fail(`${file} unreadable: ${target}: ${error.message}`);
  }
  if (!stat.isFile()) fail(`${file} unreadable: ${target}: not a regular file`);
  if ((stat.mode & 0o777) === 0) fail(`${file} unreadable: ${target}: mode 000 has no read permissions`);
  if (stat.size === 0) fail(`${file} empty: release claims are absent`);
  try { return fs.readFileSync(target, "utf8"); }
  catch (error) { fail(`${file} unreadable: ${target}: ${error.message}`); }
}
const version = readClaimBearing("VERSION").trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) fail(`VERSION is not SemVer: ${version}`);
const readme = readClaimBearing("README.md");
const result = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "buffer" });
if (result.status !== 0) fail(`cannot enumerate tracked files: ${result.stderr}`);
const files = result.stdout.toString().split("\0").filter(Boolean);
const pattern = /\bv(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)/g;
const ignored = [/^VERSION$/, /^test\//, /^runtime\//, /^docs\/OPEN-FINDINGS\.md$/, /^docs\/ROADMAP-/];
const failures = [];
for (const file of files) {
  if (ignored.some((rule) => rule.test(file))) continue;
  let text;
  try { text = fs.readFileSync(path.join(ROOT, file), "utf8"); }
  catch (error) { failures.push(`${file}: unreadable: ${error.message}`); continue; }
  text.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(pattern)) {
      const named = match[1].replace(/-linux-x64$/, "").replace(/\.md$/, "");
      if (named !== version) failures.push(`${file}:${index + 1}: v${match[1]} (VERSION is ${version})`);
    }
  });
}
if (failures.length) { console.error("FAIL version_drift:"); failures.forEach((failure) => console.error(failure)); process.exit(1); }
console.log(`PASS version_drift: README and ${files.length} tracked files name v${version}`);
