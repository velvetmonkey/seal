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

test("job env step env command repo and earlier checkout each supply context", (t) => {
  const root = fixture(`jobs:
  job-env:
    env:
      GH_REPO: owner/repo
    steps:
      - run: gh issue list
  step-env:
    steps:
      - env: { GH_REPO: owner/repo }
        run: gh issue list
  command-repo:
    steps:
      - run: gh issue list --repo owner/repo
  checked-out:
    steps:
      - uses: actions/checkout@v4
      - run: gh issue list
`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const audit = auditWorkflowGhRepoContext(root);
  assert.equal(audit.calls.length, 4);
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
