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

function fixture() {
  const readme = readFileSync(README, "utf8");
  const start = readme.indexOf("## 2. Demo");
  const end = readme.indexOf("### Repository transcript instrumentation", start);
  const demo = readme.slice(start, end);
  const transcript = [...demo.matchAll(/\*\*Output:\*\*\s*\n```text\n([\s\S]*?)\n```/g)]
    .map((match) => match[1])
    .join("\n");
  const root = mkdtempSync(join(tmpdir(), "seal-readme-transcript-"));
  const transcriptPath = join(root, "demo.txt");
  writeFileSync(transcriptPath, transcript);
  return { root, transcriptPath, transcript };
}

function run(transcriptPath, readmePath = README) {
  return spawnSync(process.execPath, [GUARD], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, SEAL_DEMO_TRANSCRIPT: transcriptPath, SEAL_DEMO_README: readmePath },
  });
}

test("README demo fences agree with the supplied transcript", (t) => {
  const space = fixture();
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(space.transcriptPath);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a changed README line is detected against the transcript", (t) => {
  const space = fixture();
  const changedReadme = join(space.root, "README.md");
  writeFileSync(changedReadme, readFileSync(README, "utf8").replace(
    'but carries a byte-identical copy',
    'but it carries a byte-identical copy',
  ));
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(space.transcriptPath, changedReadme);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /MISSING_DEMO_OUTPUT/);
});

test("a changed product transcript is detected against the README", (t) => {
  const space = fixture();
  writeFileSync(space.transcriptPath, space.transcript.replace(
    "Seal is a gate, not a sandbox:",
    "Seal is a gate and a sandbox:",
  ));
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(space.transcriptPath);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /MISSING_DEMO_OUTPUT/);
});
