#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { auditWorkflowGhRepoContext, formatFinding } = require("../scripts/check-workflow-gh-repo-context.cjs");

const ROOT = path.resolve(__dirname, "..");

function fixture(workflow) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-workflow-gh-repo-"));
  fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(root, ".github", "workflows", "fixture.yml"), workflow);
  return root;
}

test("each inline gh call has earlier checkout or explicit repository context", () => {
  const audit = auditWorkflowGhRepoContext(ROOT);
  assert.equal(audit.findings.length, 0, audit.findings.map(formatFinding).join("\n"));
  assert.ok(audit.calls.length > 0);
});

test("a new job with an unscoped gh call is refused by job and command", (t) => {
  const root = fixture(`name: Fixture
on: push
jobs:
  existing:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: gh issue list
  added-tomorrow:
    name: Added tomorrow
    runs-on: ubuntu-latest
    steps:
      - name: Missing repository
        run: gh release view v1.0.0
`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const audit = auditWorkflowGhRepoContext(root);
  assert.equal(audit.calls.length, 2);
  assert.deepEqual(audit.findings.map(formatFinding), [
    ".github/workflows/fixture.yml:14: job \"added-tomorrow\" (Added tomorrow) calls gh without an earlier checkout or repository context: gh release view v1.0.0",
  ]);
});

test("a checkout after a gh call does not supply earlier repository context", (t) => {
  const root = fixture(`jobs:
  ordering:
    steps:
      - run: gh run list
      - uses: actions/checkout@v4
`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { findings } = auditWorkflowGhRepoContext(root);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].jobId, "ordering");
  assert.equal(findings[0].command, "gh run list");
});

test("a job env map without GH_REPO is not repository context", (t) => {
  const root = fixture(`jobs:
  token-only:
    env:
      GH_TOKEN: x
    steps:
      - run: gh issue list
      - env:
          GH_REPO: owner/repo
        run: echo later step
`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const audit = auditWorkflowGhRepoContext(root);
  assert.equal(audit.calls.length, 1);
  assert.deepEqual(audit.findings.map((call) => call.command), ["gh issue list"]);
});

test("a step env map without GH_REPO is not repository context", (t) => {
  const root = fixture(`jobs:
  token-only:
    steps:
      - env:
          GH_TOKEN: x
        run: |
          cat <<'EOF'
          GH_REPO: this run text is not an env entry
          EOF
          gh issue list
`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const audit = auditWorkflowGhRepoContext(root);
  assert.equal(audit.calls.length, 1);
  assert.deepEqual(audit.findings.map((call) => call.command), ["gh issue list"]);
});

test("GH_REPO in job env supplies repository context", (t) => {
  const root = fixture(`jobs:
  job-env:
    env:
      GH_REPO: owner/repo
    steps:
      - run: gh issue list
`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const audit = auditWorkflowGhRepoContext(root);
  assert.equal(audit.calls.length, 1);
  assert.deepEqual(audit.findings, []);
});

test("GH_REPO in step env supplies repository context", (t) => {
  const root = fixture(`jobs:
  step-env:
    steps:
      - env: { GH_REPO: owner/repo }
        run: gh issue list
`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const audit = auditWorkflowGhRepoContext(root);
  assert.equal(audit.calls.length, 1);
  assert.deepEqual(audit.findings, []);
});

test("--repo on the command line supplies repository context", (t) => {
  const root = fixture(`jobs:
  command-repo:
    steps:
      - run: gh issue list --repo owner/repo
`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const audit = auditWorkflowGhRepoContext(root);
  assert.equal(audit.calls.length, 1);
  assert.deepEqual(audit.findings, []);
});

test("an earlier checkout supplies repository context", (t) => {
  const root = fixture(`jobs:
  checked-out:
    steps:
      - uses: actions/checkout@v4
      - run: gh issue list
`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const audit = auditWorkflowGhRepoContext(root);
  assert.equal(audit.calls.length, 1);
  assert.deepEqual(audit.findings, []);
});

test("step repository context does not leak to an earlier step", (t) => {
  const root = fixture(`jobs:
  scoped-step:
    steps:
      - run: gh issue list
      - env:
          GH_REPO: owner/repo
        run: gh release list
`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const audit = auditWorkflowGhRepoContext(root);
  assert.equal(audit.calls.length, 2);
  assert.deepEqual(audit.findings.map((call) => call.command), ["gh issue list"]);
});
