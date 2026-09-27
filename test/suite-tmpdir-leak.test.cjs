// SPDX-License-Identifier: Apache-2.0
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function suiteDirectories(root = os.tmpdir()) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith("seal-") || name.startsWith("f5-"))
    .sort();
}

function suiteSummary(output) {
  return output.split(/\r?\n/)
    .filter((line) => /^# (?:tests|pass|fail|skipped|todo) \d+$/.test(line) || /^ROSTER: /.test(line))
    .join("\n");
}

// The nested suite can fail for any reason at all, not only the one a reader
// has in mind. Name each failing nested test with its location and first error
// line so the cause is in the message, and keep the raw nested output after
// the names so a reader can check the parse against what the suite said.
function nestedFailures(output) {
  const lines = output.split(/\r?\n/);
  const failures = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)not ok \d+ - (.*)$/);
    if (!match) continue;
    const indent = match[1];
    let location = "";
    let error = "";
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line.startsWith(`${indent}  `)) break;
      const field = line.slice(indent.length + 2);
      if (field === "...") break;
      if (!location) location = field.match(/^location: '(.*)'$/)?.[1] ?? "";
      if (!error) {
        const inline = field.match(/^error: '(.*)'$/)?.[1];
        if (inline !== undefined) error = inline;
        else if (/^error: \|-?$/.test(field)) error = lines[cursor + 1]?.trim() ?? "";
      }
    }
    failures.push(`${match[2].trim()}${location ? ` [${location}]` : ""}${error ? `: ${error}` : ""}`);
  }
  return failures;
}

function nestedStatusMessage(result, output) {
  if (result.error || result.signal) return `leak check did not run: nested product suite interrupted (${result.error?.message || result.signal})`;
  const failures = nestedFailures(output);
  const status = result.status === null ? `signal ${result.signal}` : `status ${result.status}`;
  return [
    `nested product suite exited with ${status}; ${failures.length} failing nested test${failures.length === 1 ? "" : "s"}${failures.length === 0 ? " (no not-ok line; read the raw output)" : ""}`,
    ...failures.map((failure) => `  not ok ${failure}`),
    "raw nested output:",
    output,
  ].join("\n");
}

function snapshotDirectories(root, file, exclude) {
  const before = suiteDirectories(root).filter((name) => name !== exclude);
  fs.writeFileSync(file, JSON.stringify({ root, before, started: Date.now() }));
}

function checkDirectories(file) {
  let snapshot, after;
  try {
    snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.ok(Array.isArray(snapshot.before));
    after = suiteDirectories(snapshot.root);
  } catch (error) {
    throw new Error(`leak check did not run: cannot read snapshot or temporary root: ${error.message}`);
  }
  const survivors = after.filter((name) => !snapshot.before.includes(name));
  process.stdout.write([
    `TMPDIR LEAK ROOT ${snapshot.root}`,
    `TMPDIR LEAK COUNT BEFORE ${snapshot.before.length}`,
    `TMPDIR LEAK COUNT AFTER ${after.length}`,
    `TMPDIR LEAK SURVIVORS ${survivors.length}`,
    `TMPDIR LEAK DURATION_MS ${Date.now() - snapshot.started}`,
    "",
  ].join("\n"));
  assert.deepEqual(survivors, [], `suite left temporary directories:\n${survivors.join("\n")}`);
}

if (process.argv[2] === "--snapshot") {
  snapshotDirectories(...process.argv.slice(3));
} else if (process.argv[2] === "--check") {
  checkDirectories(process.argv[3]);
} else {

test("a complete product suite leaves no seal or f5 temporary directory", () => {
  if (process.env.SEAL_TMP_LEAK_SNAPSHOT) {
    const snapshot = JSON.parse(fs.readFileSync(process.env.SEAL_TMP_LEAK_SNAPSHOT, "utf8"));
    assert.equal(snapshot.root, os.tmpdir());
    assert.ok(Array.isArray(snapshot.before));
    return;
  }

  const target = path.resolve(process.env.SEAL_TMP_LEAK_TARGET_ROOT || ROOT);
  const tempRoot = os.tmpdir();
  const before = suiteDirectories(tempRoot);
  const result = spawnSync("bash", [path.join(target, "scripts", "run-complete-product-suite.sh")], {
    cwd: target,
    encoding: "utf8",
    env: {
      ...process.env,
      SEAL_TMP_LEAK_SNAPSHOT: undefined,
      NODE_TEST_CONTEXT: undefined,
    },
    timeout: 900000,
  });
  const after = suiteDirectories(tempRoot);
  const beforeSet = new Set(before);
  const survivors = after.filter((name) => !beforeSet.has(name));
  const output = `${result.stdout}${result.stderr}`;

  process.stdout.write([
    `TMPDIR LEAK ROOT ${tempRoot}`,
    `TMPDIR LEAK COUNT BEFORE ${before.length}`,
    `TMPDIR LEAK COUNT AFTER ${after.length}`,
    `TMPDIR LEAK SURVIVORS ${survivors.length}`,
    suiteSummary(output),
    "",
  ].join("\n"));

  assert.equal(result.error, undefined, nestedStatusMessage(result, output));
  assert.equal(result.status, 0, nestedStatusMessage(result, output));
  assert.deepEqual(survivors, [], `suite left temporary directories:\n${survivors.join("\n")}`);
});

function leakFixture(t, count = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leak-control-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tests = path.join(root, "tests");
  fs.mkdirSync(tests);
  const file = path.join(tests, "fixture.test.cjs");
  fs.writeFileSync(file, `const test = require('node:test'); for (let i = 0; i < ${count}; i++) test('fixture ' + i, () => {});\n`);
  const roster = path.join(root, "roster.txt");
  fs.writeFileSync(roster, "fixture.test.cjs\n");
  const manifest = path.join(root, "manifest.tsv");
  fs.writeFileSync(manifest, fs.readFileSync(path.join(ROOT, "scripts/critical-property-manifest.tsv"), "utf8")
    .split("\n").filter((line) => line && !line.startsWith("#"))
    .map((line) => `${line.split("\t")[0]}\tfixture.test.cjs\tfixture 0`).join("\n") + "\n");
  const env = { ...process.env, NODE_TEST_CONTEXT: undefined, RUNNER_TEMP: root,
    TMPDIR: root, TMP: root, TEMP: root, TMPGUARD_RUN_ROOT: undefined,
    SEAL_TMP_LEAK_NESTED: undefined, SEAL_TMP_LEAK_SNAPSHOT: undefined,
    SEAL_PRODUCT_SCRIPT_ROOT: ROOT, SEAL_PRODUCT_TEST_ROOT: tests,
    SEAL_PRODUCT_TEST_DIR: tests, SEAL_PRODUCT_TEST_ROSTER: roster,
    SEAL_CRITICAL_PROPERTY_MANIFEST: manifest };
  return { root, file, env };
}

function runLeakFixture(space, driver = path.join(ROOT, "scripts/run-complete-product-suite.sh")) {
  return spawnSync("bash", [driver], { cwd: ROOT, env: space.env, encoding: "utf8" });
}

test("an interrupted suite says the leak check did not run", () => {
  const result = spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { timeout: 1, encoding: "utf8" });
  assert.equal(result.error?.code, "ETIMEDOUT");
  assert.match(nestedStatusMessage(result, `${result.stdout}${result.stderr}`), /leak check did not run/);
});

test("the suite catches a planted seal directory before cleanup", (t) => {
  const space = leakFixture(t);
  const original = fs.readFileSync(space.file, "utf8");
  fs.appendFileSync(space.file, "for (const prefix of ['seal-planted-', 'f5-planted-']) require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), prefix));\n");
  const red = runLeakFixture(space);
  assert.notEqual(red.status, 0, red.stdout + red.stderr);
  assert.match(red.stdout + red.stderr, /suite left temporary directories:[\s\S]*seal-planted-/);
  assert.match(red.stdout + red.stderr, /f5-planted-/);
  fs.writeFileSync(space.file, original);
  const green = runLeakFixture(space);
  assert.equal(green.status, 0, green.stdout + green.stderr);
  assert.match(green.stdout, /TMPDIR LEAK SURVIVORS 0/);
});

test("the ordinary suite still checks leaks with 200 more cases", (t) => {
  const space = leakFixture(t, 201);
  const result = runLeakFixture(space);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /# tests 201/);
  assert.match(result.stdout, /TMPDIR LEAK SURVIVORS 0/);
});


test("a forced nested timeout fails with the did-not-check message", (t) => {
  const space = leakFixture(t);
  const scripts = path.join(space.root, "scripts");
  fs.mkdirSync(scripts);
  fs.writeFileSync(path.join(scripts, "run-complete-product-suite.sh"), "sleep 10\n");
  const copy = path.join(space.root, "timeout.test.cjs");
  fs.writeFileSync(copy, fs.readFileSync(__filename, "utf8").replace("timeout: 900000", "timeout: 1"));
  const result = spawnSync(process.execPath, ["--test", "--test-name-pattern=^a complete product suite leaves", copy], {
    cwd: ROOT, encoding: "utf8", env: { ...space.env, SEAL_TMP_LEAK_TARGET_ROOT: space.root },
  });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /leak check did not run: nested product suite interrupted/);
  // Restore both the budget and the real driver, then check the clean fixture.
  fs.writeFileSync(copy, fs.readFileSync(__filename, "utf8"));
  fs.writeFileSync(path.join(scripts, "run-complete-product-suite.sh"),
    fs.readFileSync(path.join(ROOT, "scripts/run-complete-product-suite.sh"), "utf8"));
  const restored = spawnSync(process.execPath, ["--test", "--test-name-pattern=^a complete product suite leaves", copy], {
    cwd: ROOT, encoding: "utf8", env: { ...space.env, SEAL_TMP_LEAK_TARGET_ROOT: space.root },
  });
  assert.equal(restored.status, 0, restored.stdout + restored.stderr);
  assert.match(restored.stdout, /TMPDIR LEAK SURVIVORS 0/);
});

test("a driver that exits before checking cannot pass", (t) => {
  const space = leakFixture(t);
  const driver = path.join(space.root, "early-exit.sh");
  fs.writeFileSync(driver, fs.readFileSync(path.join(ROOT, "scripts/run-complete-product-suite.sh"), "utf8")
    .replace('run_tests=("${declared_tests[@]}")', 'exit 0\nrun_tests=("${declared_tests[@]}")'));
  const result = runLeakFixture(space, driver);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /leak check did not run: suite driver exited before the final comparison/);
});

test("a missing snapshot is an explicit did-not-check failure", (t) => {
  const space = leakFixture(t);
  const result = spawnSync(process.execPath, [__filename, "--check", path.join(space.root, "missing.json")], {
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /leak check did not run: cannot read snapshot or temporary root/);
});

}
