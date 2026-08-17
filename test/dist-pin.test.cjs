// SPDX-License-Identifier: Apache-2.0
// The release asset is the product. The root SHA256SUMS is only a forbidden
// duplicate when it names an unpublished artifact; release-time generation
// owns the authoritative copy.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const CHECK = path.join(ROOT, "scripts", "check-root-release-pin.cjs");

function run(pin) {
  return spawnSync(process.execPath, [CHECK], {
    encoding: "utf8",
    env: { ...process.env, ...(pin ? { SEAL_ROOT_RELEASE_PIN: pin } : {}) },
  });
}

test("an absent root pin passes between releases", () => {
  const absent = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "seal-root-pin-"));
  const result = run(path.join(absent, "SHA256SUMS"));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^PASS root release pin absent:/);
});

test("an empty root pin passes between releases", () => {
  const empty = path.join(fs.mkdtempSync(path.join(require("node:os").tmpdir(), "seal-root-pin-")), "SHA256SUMS");
  fs.writeFileSync(empty, "\n");
  const result = run(empty);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^PASS root release pin empty:/);
});

test("an unreadable root pin refuses by name", () => {
  const directory = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "seal-root-pin-"));
  const result = run(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^REFUSE root_release_pin: cannot read .*SHA256SUMS|^REFUSE root_release_pin: cannot read /);
});
