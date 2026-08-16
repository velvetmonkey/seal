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

const remoteTags = git(["ls-remote", "--tags", "origin"]);
if (remoteTags.status !== 0) {
  process.stderr.write(remoteTags.stderr || "could not inspect release tags on origin\n");
  process.exit(remoteTags.status ?? 1);
}

const refs = new Map(
  remoteTags.stdout.trim().split("\n").filter(Boolean).map((line) => {
    const [commit, ref] = line.split(/\s+/, 2);
    return [ref, commit];
  }),
);
if (refs.size === 0) {
  process.stderr.write("could not establish release identity: origin returned no tags\n");
  process.exit(1);
}

const taggedCommit = refs.get(`refs/tags/${tag}^{}`) || refs.get(`refs/tags/${tag}`);
if (!taggedCommit) {
  process.stdout.write(`version identity available: ${tag} has not been released\n`);
  process.exit(0);
}

const head = git(["rev-parse", "HEAD"]);
if (head.status !== 0) {
  process.stderr.write(head.stderr || "could not resolve HEAD\n");
  process.exit(1);
}
if (taggedCommit !== head.stdout.trim()) {
  process.stderr.write(
    `version identity collision: ${tag} identifies ${taggedCommit}, but HEAD is ${head.stdout.trim()}; bump VERSION\n`,
  );
  process.exit(1);
}
process.stdout.write(`version identity exact: ${tag} identifies HEAD\n`);
