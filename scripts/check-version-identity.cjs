#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// A released version names one commit. A feature branch inherits main's
// published version unless it changes VERSION and thereby introduces a claim.
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

const headResult = git(["rev-parse", "--verify", "HEAD^{commit}"]);
if (headResult.status !== 0 || !output(headResult)) {
  fail(`version identity ambiguity: unresolved HEAD\n${headResult.stderr || ""}`);
}
const head = headResult.stdout.trim();

// The claim under judgement is the one the commit carries. Reading the working
// tree would let an uncommitted edit hide a committed collision, or invent one.
const versionResult = git(["show", `${head}:VERSION`]);
if (versionResult.status !== 0 || !output(versionResult)) {
  fail(
    `version identity ambiguity: unreadable VERSION at ${head}\n${versionResult.stderr || ""}`,
  );
}
const version = versionResult.stdout.trim();
const tag = `v${version}`;

// A missing base is evidence that the checkout cannot answer this gate, not an
// invitation to repair its inputs. Full-history CI checkouts provide this ref.
const mainRef = git(["show-ref", "--verify", "--quiet", "refs/remotes/origin/main"]);
if (mainRef.status !== 0) {
  fail("base ambiguity: refs/remotes/origin/main is absent");
}

// A failed merge-base is ambiguous, including in a shallow checkout.  Do not
// fetch or otherwise repair history here: CI must supply a complete base.
// --all because a criss-cross history has more than one merge base, and which
// single one git would have named is not a fact this gate may lean on.
const baseResult = git(["merge-base", "--all", "HEAD", "origin/main"]);
if (baseResult.status !== 0 || !output(baseResult)) {
  fail(
    `base ambiguity: could not establish merge-base between HEAD and origin/main\n${baseResult.stderr || ""}`,
  );
}
const bases = baseResult.stdout.trim().split("\n").map((line) => line.trim()).filter(Boolean);

const baseVersions = bases.map((candidate) => {
  const baseVersionResult = git(["show", `${candidate}:VERSION`]);
  if (baseVersionResult.status !== 0 || !output(baseVersionResult)) {
    fail(
      `version identity ambiguity: unreadable merge-base VERSION at ${candidate}\n${baseVersionResult.stderr || ""}`,
    );
  }
  return baseVersionResult.stdout.trim();
});

// A version is inherited only when every merge base already carries it. Matching
// one base out of several is a new claim standing behind whichever base git
// happened to name first.
const claimIntroduced = baseVersions.some((baseVersion) => baseVersion !== version);

const remoteTags = git(["ls-remote", "--tags", "origin"]);
if (remoteTags.status !== 0) {
  fail(`release identity ambiguity: failed ls-remote --tags origin\n${remoteTags.stderr || ""}`);
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
    `version identity inherited: ${tag} identifies ${taggedCommit}; VERSION unchanged from merge-base ${bases.join(", ")}\n`,
  );
}
