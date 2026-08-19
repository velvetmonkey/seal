// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const GUARD = path.join(ROOT, "scripts", "check-checker-usage-header.cjs");
const SOURCE = path.join(ROOT, "checker", "seal-receipt-check.mjs");

function run(file, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.NODE_TEST_CONTEXT;
  if (file !== undefined) env.SEAL_CHECKER_USAGE_FILE = file;
  return spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: "utf8", env });
}

test("the published checker Usage header names the standalone filename", () => {
  const source = run();
  assert.equal(source.status, 0, source.stdout + source.stderr);
  assert.match(source.stdout, /PASS  published checker Usage header runs as node seal-receipt-check\.mjs/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-checker-usage-published-"));
  const published = path.join(dir, "seal-receipt-check.mjs");
  fs.copyFileSync(SOURCE, published);
  const result = run(published);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS  published checker Usage header runs as node seal-receipt-check\.mjs/);
});

test("an absent checker file is a named refusal, not a pass", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-checker-usage-absent-"));
  const missing = path.join(dir, "seal-receipt-check.mjs");
  const result = run(missing);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /^FAIL  checker_file_absent: .*:1: published checker is absent: /);
  assert.ok(result.stderr.includes(missing));
});

test("an empty checker file is a named refusal, not a pass", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-checker-usage-empty-"));
  const empty = path.join(dir, "seal-receipt-check.mjs");
  fs.writeFileSync(empty, "");
  const result = run(empty);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /^FAIL  checker_file_empty: .*:1: published checker is empty: /);
  assert.ok(result.stderr.includes(empty));
});

test("a checker with no Usage header is a named refusal, not a pass", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-checker-usage-noheader-"));
  const file = path.join(dir, "seal-receipt-check.mjs");
  fs.writeFileSync(file, "// SPDX-License-Identifier: Apache-2.0\nexport {};\n");
  const result = run(file);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /^FAIL  usage_header_absent: .*:1: published checker has no Usage header: /);
  assert.ok(result.stderr.includes(file));
});

test("a Usage header naming checker/ would not resolve for a standalone download", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-checker-usage-nested-"));
  const file = path.join(dir, "seal-receipt-check.mjs");
  const broken = fs.readFileSync(SOURCE, "utf8").replace(
    "//   node seal-receipt-check.mjs RECEIPT.json --pubkey (HEX | FILE)",
    "//   node checker/seal-receipt-check.mjs RECEIPT.json --pubkey (HEX | FILE)",
  );
  fs.writeFileSync(file, broken);
  const result = run(file);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(
    result.stderr,
    new RegExp(
      `^FAIL  usage_header_unresolvable_path: ${file}:33: Usage header names checker/seal-receipt-check\\.mjs, which would not resolve for a reader who downloaded the asset alone`,
    ),
  );
});
