#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// The release asset is authoritative. A root pin is permitted only when it
// names the exact asset of a published release; an absent or empty
// root file is the intentional between-releases state.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const PIN = process.env.SEAL_ROOT_RELEASE_PIN || path.join(ROOT, "SHA256SUMS");

function refuse(message) {
  process.stderr.write(`REFUSE root_release_pin: ${message}\n`);
  process.exit(1);
}

let text;
try {
  text = fs.readFileSync(PIN, "utf8");
} catch (error) {
  if (error.code === "ENOENT") {
    process.stdout.write("PASS root release pin absent: release-time SHA256SUMS is authoritative\n");
    process.exit(0);
  }
  refuse(`cannot read ${PIN}: ${error.message}`);
}
if (text.trim() === "") {
  process.stdout.write("PASS root release pin empty: release-time SHA256SUMS is authoritative\n");
  process.exit(0);
}

const lines = text.split(/\r?\n/).map((line, index) => ({ line, number: index + 1 })).filter(({ line }) => line.trim());
if (lines.length !== 1) refuse(`expected one non-empty line, found ${lines.length}`);
const entry = lines[0];
const fields = entry.line.trim().split(/\s+/);
if (fields.length !== 2 || !/^[0-9a-f]{64}$/.test(fields[0]) || !fields[1]) {
  refuse(`offending line ${entry.number}: ${entry.line}`);
}
const [digest, name] = fields;

function repository() {
  const remote = spawnSync("git", ["config", "--get", "remote.origin.url"], { cwd: ROOT, encoding: "utf8" });
  if (remote.status !== 0) refuse(`cannot determine origin repository: ${remote.stderr.trim()}`);
  const match = remote.stdout.trim().match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) refuse(`origin is not a GitHub repository: ${remote.stdout.trim()}`);
  return `${match[1]}/${match[2]}`;
}

const result = spawnSync("gh", ["api", "--paginate", "--slurp", `repos/${repository()}/releases?per_page=100`], { cwd: ROOT, encoding: "utf8" });
if (result.status !== 0) refuse(`cannot inspect published releases: ${(result.stderr || "gh api failed").trim()}`);
let pages;
try { pages = JSON.parse(result.stdout); }
catch (error) { refuse(`cannot parse published releases: ${error.message}`); }
const releases = pages.flat();
const asset = releases.flatMap((release) => release.assets.map((candidate) => ({ release, candidate })))
  .find(({ candidate }) => candidate.name === name);
if (!asset) refuse(`offending line ${entry.number} names unpublished artifact ${name}`);
const publishedDigest = asset.candidate.digest?.replace(/^sha256:/, "");
if (publishedDigest && publishedDigest !== digest) refuse(`offending line ${entry.number} digest differs from published asset ${name}`);
process.stdout.write(`PASS root release pin names published asset ${name} from ${asset.release.tag_name}\n`);
