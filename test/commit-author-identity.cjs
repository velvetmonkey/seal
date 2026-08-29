// SPDX-License-Identifier: Apache-2.0
// The CI invocation of this test supplies --base and --head.  Keeping the
// policy and its fixtures together prevents a separately maintained check
// from drifting away from the proof that exercises it.
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const CANONICAL_EMAIL = "9402464+velvetmonkey@users.noreply.github.com";
// RFC 2606 section 3 reserves .invalid.  Only this exact lane domain is safe
// from GitHub account attribution; a suffix match would accept an unsafe host.
const LANE_EMAIL = /^[^@\s]+@lanes\.seal\.invalid$/;
// These identities predate this control.  They are accepted only for a commit
// already reachable from origin/main, never for a newly proposed commit.
const HISTORIC_AUTHOR_EMAILS = new Set([
  "ccpin2@velvetmonkey.invalid",
  "ccpin@velvetmonkey.invalid",
  "clienterrors@users.noreply.github.com",
  "darwintiming13@users.noreply.github.com",
  "darwintiming14@users.noreply.github.com",
  "darwintiming16@users.noreply.github.com",
  "darwintiming18@users.noreply.github.com",
  "darwintiming20@users.noreply.github.com",
  "darwintiming21@users.noreply.github.com",
  "darwintiming23@users.noreply.github.com",
  "democheck2@users.noreply.github.com",
  "democheck3@users.noreply.github.com",
  "demoscratch@users.noreply.github.com",
  "diffrange@users.noreply.github.com",
  "docsnav4@velvetmonkey.local",
  "docsnav6@users.noreply.github.com",
  "docsnav@users.noreply.github.com",
  "keyid4@users.noreply.github.com",
  "monkey@velvet.local",
  "noreply@anthropic.com",
  "noreply@velvetmonkey",
  "pinonmergecold@example.invalid",
  "pinprotect@velvetmonkey.invalid",
  "provedclaim15@users.noreply.github.com",
  "provedclaim16@users.noreply.github.com",
  "publishctx2@users.noreply.github.com",
  "publishctx@users.noreply.github.com",
  "receiptspec2@users.noreply.github.com",
  "specrebase2@users.noreply.github.com",
  "specrebase3@users.noreply.github.com",
  "specrebase@users.noreply.github.com",
  "standin@velvetmonkey.invalid",
  "statusclaim2@users.noreply.github.com",
  "statusclaim3@users.noreply.github.com",
  "statusclaim@users.noreply.github.com",
  "velvetmonkey@users.noreply.github.com",
  "vicemarshalkek@protonmail.com",
]);

function git(root, args) {
  const env = { ...process.env };
  delete env.GIT_AUTHOR_NAME;
  delete env.GIT_AUTHOR_EMAIL;
  delete env.GIT_COMMITTER_NAME;
  delete env.GIT_COMMITTER_EMAIL;
  return spawnSync("git", ["-C", root, ...args], { encoding: "utf8", env });
}

function requireGit(root, args) {
  const result = git(root, args);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim();
}

function historicalCommit(root, sha, email) {
  if (!HISTORIC_AUTHOR_EMAILS.has(email)) return false;
  return git(root, ["merge-base", "--is-ancestor", sha, "refs/remotes/origin/main"]).status === 0;
}

function acceptedAuthorEmail(email) {
  return email === CANONICAL_EMAIL || LANE_EMAIL.test(email);
}

function addedCommits(root, base, head) {
  return requireGit(root, ["rev-list", "--reverse", `${base}..${head}`]).split("\n").filter(Boolean);
}

function violations(root, base, head, commits = addedCommits(root, base, head)) {
  return commits.flatMap((sha) => {
    const email = requireGit(root, ["show", "-s", "--format=%ae", sha]);
    if (acceptedAuthorEmail(email) || historicalCommit(root, sha, email)) return [];
    return [{ sha, email }];
  });
}

function check(root, base, head) {
  const commits = addedCommits(root, base, head);
  if (commits.length === 0) {
    process.stderr.write(`COMMIT_AUTHOR_IDENTITY_REJECTED: range ${base}..${head} contains zero added commits.\n`);
    return false;
  }
  const rejected = violations(root, base, head, commits);
  if (rejected.length) {
    for (const { sha, email } of rejected) {
      process.stderr.write(`COMMIT_AUTHOR_IDENTITY_REJECTED: commit ${sha} has author email ${email}; required ${CANONICAL_EMAIL} or <lane>@lanes.seal.invalid\n`);
    }
    return false;
  }
  process.stdout.write(`COMMIT_AUTHOR_IDENTITY_OK: every added commit from ${base} to ${head} has an allowed author identity.\n`);
  return true;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "seal-commit-author-"));
  requireGit(root, ["init", "-q"]);
  requireGit(root, ["config", "user.name", "velvetmonkey"]);
  requireGit(root, ["config", "user.email", CANONICAL_EMAIL]);
  writeFileSync(join(root, "README.md"), "base\n");
  requireGit(root, ["add", "README.md"]);
  requireGit(root, ["commit", "-qm", "base"]);
  requireGit(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  return root;
}

function commit(root, message, name, email) {
  writeFileSync(join(root, "README.md"), `${message}\n`);
  requireGit(root, ["add", "README.md"]);
  requireGit(root, ["-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "-qm", message]);
  return requireGit(root, ["rev-parse", "HEAD"]);
}

test("a newly added non-canonical author is rejected by email and commit sha", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = requireGit(root, ["rev-parse", "HEAD"]);
  const sha = commit(root, "offending", "ccclient", "ccclient@users.noreply.github.com");
  assert.deepEqual(violations(root, base, "HEAD"), [{ sha, email: "ccclient@users.noreply.github.com" }]);
});

test("a canonical added commit passes", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = requireGit(root, ["rev-parse", "HEAD"]);
  commit(root, "canonical", "velvetmonkey", CANONICAL_EMAIL);
  assert.deepEqual(violations(root, base, "HEAD"), []);
});

test("a lane-domain added commit passes", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = requireGit(root, ["rev-parse", "HEAD"]);
  commit(root, "lane", "lane", "authoridentity@lanes.seal.invalid");
  assert.deepEqual(violations(root, base, "HEAD"), []);
});

test("a near-miss lane suffix is rejected", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = requireGit(root, ["rev-parse", "HEAD"]);
  const sha = commit(root, "near miss", "evil", "evil@notlanes.seal.invalid.example.com");
  assert.deepEqual(violations(root, base, "HEAD"), [{ sha, email: "evil@notlanes.seal.invalid.example.com" }]);
});

test("a lane-domain lookalike is rejected", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = requireGit(root, ["rev-parse", "HEAD"]);
  const sha = commit(root, "lane lookalike", "evil", "x@evil-lanes.seal.invalid");
  assert.deepEqual(violations(root, base, "HEAD"), [{ sha, email: "x@evil-lanes.seal.invalid" }]);
});

test("an unlisted GitHub noreply author is rejected", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = requireGit(root, ["rev-parse", "HEAD"]);
  const sha = commit(root, "unlisted noreply", "someone", "someone@users.noreply.github.com");
  assert.deepEqual(violations(root, base, "HEAD"), [{ sha, email: "someone@users.noreply.github.com" }]);
});

test("the named historic identities cannot be reused by a new commit", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = requireGit(root, ["rev-parse", "HEAD"]);
  const sha = commit(root, "historic identity reuse", "clienterrors", "clienterrors@users.noreply.github.com");
  assert.deepEqual(violations(root, base, "HEAD"), [{ sha, email: "clienterrors@users.noreply.github.com" }]);
});

test("the fixture constructs author and committer identity", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const savedIdentity = {
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL,
  };
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: "ambient lane author",
    GIT_AUTHOR_EMAIL: "ambient@lanes.seal.invalid",
    GIT_COMMITTER_NAME: "ambient lane committer",
    GIT_COMMITTER_EMAIL: "ambient@lanes.seal.invalid",
  });
  t.after(() => {
    for (const [name, value] of Object.entries(savedIdentity)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const sha = commit(root, "explicit identity", "fixture author", "fixture-author@example.invalid");
  assert.equal(requireGit(root, ["show", "-s", "--format=%an%n%ae%n%cn%n%ce", sha]), [
    "fixture author",
    "fixture-author@example.invalid",
    "fixture author",
    "fixture-author@example.invalid",
  ].join("\n"));
});

test("a rewind range with zero added commits is rejected", (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const head = requireGit(root, ["rev-parse", "HEAD"]);
  const base = commit(root, "later", "velvetmonkey", CANONICAL_EMAIL);
  assert.equal(check(root, base, head), false);
});

function rangeArgs(argv) {
  const options = {
    base: process.env.SEAL_COMMIT_AUTHOR_BASE,
    head: process.env.SEAL_COMMIT_AUTHOR_HEAD,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--base") options.base = argv[++index];
    else if (argv[index] === "--head") options.head = argv[++index];
  }
  return options.base && options.head ? options : null;
}

const range = rangeArgs(process.argv.slice(2));
if (range) {
  test("CI commit-author-identity range", () => {
    assert.equal(check(resolve(__dirname, ".."), range.base, range.head), true);
  });
}
