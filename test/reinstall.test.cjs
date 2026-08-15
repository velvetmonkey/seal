// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SCRATCH_ROOT = "/home/monkey/scratch";
const BUILD = path.join(ROOT, "scripts", "build-dist.cjs");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return { code: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function buildArtifact() {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  const out = fs.mkdtempSync(path.join(SCRATCH_ROOT, "seal-reinstall-test-"));
  const built = run(process.execPath, [BUILD, "--out", out]);
  assert.equal(built.code, 0, `${built.stdout}${built.stderr}`);
  const [digest, bytes, name] = fs.readFileSync(path.join(out, "SHA256SUMS"), "utf8").trim().split(/\s+/);
  return { out, artifact: path.join(out, name), digest, bytes };
}

function install(built, prefix) {
  return run(built.artifact, ["--sha256", built.digest, "--bytes", built.bytes, "--prefix", prefix]);
}

test("installer succeeds over its verified existing immutable install", () => {
  const built = buildArtifact();
  const prefix = path.join(built.out, "prefix");
  const first = install(built, prefix);
  assert.equal(first.code, 0, `${first.stdout}${first.stderr}`);
  const second = install(built, prefix);
  assert.equal(second.code, 0, `${second.stdout}${second.stderr}`);
  const launched = run(process.execPath, [path.join(prefix, "bin", "seal"), "--version"]);
  assert.equal(launched.code, 0, `${launched.stdout}${launched.stderr}`);
  assert.equal(launched.stdout.trim(), VERSION);
});

test("installer refuses a physically unwritable launcher parent", () => {
  const built = buildArtifact();
  const prefix = path.join(built.out, "prefix");
  const first = install(built, prefix);
  assert.equal(first.code, 0, `${first.stdout}${first.stderr}`);
  const bin = path.join(prefix, "bin");
  fs.chmodSync(bin, 0o555);
  let refused;
  try {
    refused = install(built, prefix);
  } finally {
    fs.chmodSync(bin, 0o755);
  }
  assert.notEqual(refused.code, 0, `${refused.stdout}${refused.stderr}`);
  assert.match(refused.stderr, /^REFUSE install_parent_unwritable:/m);
});
