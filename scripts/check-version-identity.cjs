#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// A released version names one commit. A feature branch inherits main's
// published version unless it changes VERSION and thereby introduces a claim.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

function git(args) {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function output(result) {
  return result.status === 0 ? result.stdout.trim() : "";
}

const version = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const tag = `v${version}`;

const headResult = git(["rev-parse", "HEAD"]);
if (headResult.status !== 0) {
  fail(headResult.stderr || "could not resolve HEAD");
}
const head = headResult.stdout.trim();

// CI checkouts may omit origin/main or the history needed to find its merge
// base. Fetch those inputs before deciding; ambiguity is never a pass.
let baseResult = git(["merge-base", "HEAD", "origin/main"]);
if (baseResult.status !== 0 || !output(baseResult)) {
  const fetchMain = git(["fetch", "origin", "main"]);
  if (fetchMain.status !== 0) {
    fail(`base ambiguity: could not fetch origin/main\n${fetchMain.stderr || ""}`);
  }

  const shallow = output(git(["rev-parse", "--is-shallow-repository"]));
  if (shallow === "true") {
    const unshallow = git(["fetch", "--unshallow", "origin"]);
    if (unshallow.status !== 0) {
      fail(`base ambiguity: shallow history prevented establishing merge-base\n${unshallow.stderr || ""}`);
    }
  }

  baseResult = git(["merge-base", "HEAD", "origin/main"]);
}
if (baseResult.status !== 0 || !output(baseResult)) {
  fail(
    `base ambiguity: could not establish merge-base between HEAD and origin/main\n${baseResult.stderr || ""}`,
  );
}
const base = baseResult.stdout.trim();

const baseVersionResult = git(["show", `${base}:VERSION`]);
if (baseVersionResult.status !== 0) {
  fail(`could not determine VERSION at merge-base ${base}\n${baseVersionResult.stderr || ""}`);
}
const baseVersion = baseVersionResult.stdout.trim();
const claimIntroduced = version !== baseVersion;

const remoteTags = git(["ls-remote", "--tags", "origin"]);
if (remoteTags.status !== 0) {
  fail(remoteTags.stderr || "could not inspect release tags on origin");
}

const refs = new Map(
  remoteTags.stdout.trim().split("\n").filter(Boolean).map((line) => {
    const [commit, ref] = line.split(/\s+/, 2);
    return [ref, commit];
  }),
);
const taggedCommit = refs.get(`refs/tags/${tag}^{}`) || refs.get(`refs/tags/${tag}`);

if (!taggedCommit) {
  process.stdout.write(`version identity available: ${tag} has not been released\n`);
  process.exit(0);
}

if (taggedCommit !== head && claimIntroduced) {
  fail(
    `version identity collision: ${tag} identifies ${taggedCommit}, but HEAD is ${head}; bump VERSION`,
  );
}

if (taggedCommit === head) {
  process.stdout.write(`version identity exact: ${tag} identifies HEAD\n`);
} else {
  process.stdout.write(
    `version identity inherited: ${tag} identifies ${taggedCommit}; VERSION unchanged from merge-base ${base}\n`,
  );
}
