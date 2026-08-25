// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = resolve(__dirname, "..");
const GUARD = join(ROOT, "scripts", "readme-demo-transcript-guard.mjs");
const README = join(ROOT, "README.md");
const DEMO_OUTPUT = join(ROOT, "test", "fixtures", "readme-demo-output.txt");
const CHECKER_OUTPUT = join(ROOT, "test", "fixtures", "readme-demo-checker-output.txt");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "seal-readme-transcript-"));
  const transcriptPath = join(root, "demo.txt");
  const checkerPath = join(root, "checker.txt");
  writeFileSync(transcriptPath, readFileSync(DEMO_OUTPUT));
  writeFileSync(checkerPath, readFileSync(CHECKER_OUTPUT));
  return { root, transcriptPath, checkerPath, transcript: readFileSync(DEMO_OUTPUT, "utf8") };
}

function run(transcriptPath, readmePath = README, checkerPath = CHECKER_OUTPUT) {
  return spawnSync(process.execPath, [GUARD], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      SEAL_DEMO_TRANSCRIPT: transcriptPath,
      SEAL_DEMO_CHECKER_TRANSCRIPT: checkerPath,
      SEAL_DEMO_README: readmePath,
    },
  });
}

test("README demo fences agree with the supplied transcript", (t) => {
  const space = fixture();
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(space.transcriptPath, README, space.checkerPath);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a changed README line is detected against the transcript", (t) => {
  const space = fixture();
  const changedReadme = join(space.root, "README.md");
  writeFileSync(changedReadme, readFileSync(README, "utf8").replace(
    'INPUT REQUIRED',
    'INPUT NEEDED',
  ));
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(space.transcriptPath, changedReadme);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /MISSING_DEMO_OUTPUT/);
});

test("a changed product transcript is detected against the README", (t) => {
  const space = fixture();
  writeFileSync(space.transcriptPath, space.transcript.replace(
    "BLOCKED",
    "STOPPED",
  ));
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(space.transcriptPath);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /MISSING_DEMO_OUTPUT/);
});

test("a deleted terminal capture is detected", (t) => {
  const space = fixture();
  const changedReadme = join(space.root, "README.md");
  writeFileSync(changedReadme, readFileSync(README, "utf8").replace(
    "```text\nchild calls observed:",
    "INPUT REQUIRED",
  ));
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(space.transcriptPath, changedReadme, space.checkerPath);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /CAPTURE_FENCE_ABSENT/);
});
