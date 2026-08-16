#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// A released version names one commit. Once v$VERSION exists, any different
// HEAD must declare a new VERSION before CI may pass.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const version = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const tag = `v${version}`;

function git(args) {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

const exists = git(["show-ref", "--verify", "--quiet", `refs/tags/${tag}`]);
if (exists.status === 1) {
  process.stdout.write(`version identity available: ${tag} has not been released\n`);
  process.exit(0);
}
if (exists.status !== 0) {
  process.stderr.write(exists.stderr || `could not inspect refs/tags/${tag}\n`);
  process.exit(exists.status ?? 1);
}

const tagged = git(["rev-parse", `${tag}^{commit}`]);
const head = git(["rev-parse", "HEAD"]);
if (tagged.status !== 0 || head.status !== 0) {
  process.stderr.write(tagged.stderr || head.stderr || "could not resolve release identity\n");
  process.exit(1);
}
if (tagged.stdout.trim() !== head.stdout.trim()) {
  process.stderr.write(
    `version identity collision: ${tag} identifies ${tagged.stdout.trim()}, but HEAD is ${head.stdout.trim()}; bump VERSION\n`,
  );
  process.exit(1);
}
process.stdout.write(`version identity exact: ${tag} identifies HEAD\n`);
