#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// VERSION is authoritative.  This check is deliberately a source scan: a
// future editor cannot make a new release claim without either deriving it or
// adding a visible, checked literal.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const version = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
  console.error(`FAIL version_drift: VERSION is not SemVer: ${version}`);
  process.exit(1);
}

const ignored = [
  /^EVALUATOR-START\.md$/,
  /^contract\//,
  /^harness\//,
  /^runtime\/kernel\//,
  /^docs\/OPEN-FINDINGS\.md$/,
  /^docs\/ROADMAP-/,
];
const result = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "buffer" });
if (result.status !== 0) {
  console.error(`FAIL version_drift: cannot enumerate tracked files: ${result.stderr}`);
  process.exit(1);
}
const files = result.stdout.toString("utf8").split("\0").filter(Boolean);
const pattern = /\bv(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)/g;
const failures = [];
const fixtureVersions = new Set(["0.2.0-rc.1", "1.1.0-rc.1"]);
for (const file of files) {
  if (file === "VERSION" || ignored.some((rule) => rule.test(file))) continue;
  let text;
  try { text = fs.readFileSync(path.join(ROOT, file), "utf8"); }
  catch (error) {
    failures.push(`${file}: unreadable: ${error.message}`);
    continue;
  }
  text.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(pattern)) {
      const named = match[1].replace(/-linux-x64$/, "").replace(/\.md$/, "");
      if (file === "test/version-identity-gate.test.cjs" && fixtureVersions.has(named)) continue;
      if (named !== version) failures.push(`${file}:${index + 1}: v${match[1]} (VERSION is ${version})`);
    }
  });
}
if (failures.length) {
  console.error("FAIL version_drift:");
  failures.forEach((failure) => console.error(failure));
  process.exit(1);
}
console.log(`PASS version_drift: all checked release mentions name v${version}`);
