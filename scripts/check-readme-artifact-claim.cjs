#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// The install transcript is release-facing copy. It must name the tag-time
// artifact, never a path from the builder's checkout or a moving dev identity.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const README = process.env.README_ARTIFACT_CLAIM_README || path.join(ROOT, "README.md");
const RELEASED_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

let readme;
try {
  readme = fs.readFileSync(README, "utf8");
} catch (error) {
  console.error(`FAIL  cannot read README artifact claim: ${error.message}`);
  process.exit(2);
}

const artifactLines = readme.split("\n").filter((line) => /seal-v[^\s`]+-linux-x64/.test(line));
const failures = [];
const publishedVersion = readme.match(/^SEAL_VERSION=v([^\s]+)$/m)?.[1];
if (!publishedVersion || !RELEASED_VERSION.test(publishedVersion)) failures.push("README must declare one exact published SEAL_VERSION");
const expected = `seal-v${publishedVersion}-linux-x64`;
for (const line of artifactLines) {
  if (/\/home\/monkey(?:\/|$)/.test(line)) failures.push(`builder-local absolute artifact path: ${line.trim()}`);
  if (/seal-v[^\s`]*-dev\.g[0-9a-f]+-linux-x64/.test(line)) {
    failures.push(`development artifact named in published-release copy: ${line.trim()}`);
  }
}

const exact = artifactLines.filter((line) => line.trim() === expected);
if (exact.length !== 1) failures.push(`expected exactly one tag-time artifact claim ${expected}; found ${exact.length}`);
const explanation = `At the exact release tag, your build writes \`${expected}\` in your own \`dist/\` directory;`;
if (!readme.includes(explanation)) failures.push(`README must explain that ${expected} appears in the reader's own dist/ directory`);

if (failures.length) {
  for (const failure of failures) console.error(`FAIL  ${failure}`);
  process.exit(1);
}
console.log(`PASS  README artifact claim is the tag-time filename: ${expected}`);
