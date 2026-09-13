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
  const failures = nestedFailures(output);
  const status = result.status === null ? `signal ${result.signal}` : `status ${result.status}`;
  return [
    `nested product suite exited with ${status}; ${failures.length} failing nested test${failures.length === 1 ? "" : "s"}${failures.length === 0 ? " (no not-ok line; read the raw output)" : ""}`,
    ...failures.map((failure) => `  not ok ${failure}`),
    "raw nested output:",
    output,
  ].join("\n");
}

test("a complete product suite leaves no seal or f5 temporary directory", () => {
  if (process.env.SEAL_TMP_LEAK_NESTED === "1") {
    assert.ok(fs.statSync(os.tmpdir()).isDirectory());
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
      SEAL_TMP_LEAK_NESTED: "1",
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

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, nestedStatusMessage(result, output));
  assert.deepEqual(survivors, [], `suite left temporary directories:\n${survivors.join("\n")}`);
});
