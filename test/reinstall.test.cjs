// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const ROOT = path.join(__dirname, "..");
const SCRATCH_ROOT = path.join(os.tmpdir(), "seal-reinstall-tests");
const BUILD = path.join(ROOT, "scripts", "build-dist.cjs");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return { code: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function buildArtifact() {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  const out = testTmpdir(path.join(SCRATCH_ROOT, "seal-reinstall-test-"));
  const built = run(process.execPath, [BUILD, "--out", out]);
  assert.equal(built.code, 0, `${built.stdout}${built.stderr}`);
  const [digest, bytes, name] = fs.readFileSync(path.join(out, "SHA256SUMS"), "utf8").trim().split(/\s+/);
  return { out, artifact: path.join(out, name), digest, bytes };
}

function install(built, prefix) {
  return run(built.artifact, ["--sha256", built.digest, "--bytes", built.bytes, "--prefix", prefix]);
}

console.log(`reinstall.test effective uid: ${process.geteuid()}`);

test("installer succeeds over its verified existing immutable install", () => {
  const built = buildArtifact();
  const prefix = path.join(built.out, "prefix");
  const first = install(built, prefix);
  assert.equal(first.code, 0, `${first.stdout}${first.stderr}`);
  const record = JSON.parse(fs.readFileSync(path.join(prefix, "lib", "seal", "install.json"), "utf8"));
  const storeMode = fs.statSync(path.join(prefix, "lib", "seal", "store", record.treeSha256)).mode & 0o777;
  assert.equal(storeMode, 0o555, `expected immutable store mode 555, got ${storeMode.toString(8)}`);
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
  let denied;
  try {
    try {
      fs.writeFileSync(path.join(bin, `.seal-precondition-${process.pid}`), "precondition", { flag: "wx" });
    } catch (error) {
      denied = error;
    }
    console.log(
      `reinstall.test unwritable-parent precondition: euid=${process.geteuid()} chmod=0555 ` +
      `create=${denied ? `denied(${denied.code})` : "allowed"}`,
    );
    assert.ok(
      denied && (denied.code === "EACCES" || denied.code === "EPERM"),
      `cannot establish unwritable launcher-parent precondition for euid ${process.geteuid()}: ` +
      `create after chmod 0555 was ${denied ? denied.code : "allowed"}`,
    );
    refused = install(built, prefix);
  } finally {
    try { fs.unlinkSync(path.join(bin, `.seal-precondition-${process.pid}`)); } catch { /* absent when create was denied */ }
    fs.chmodSync(bin, 0o755);
  }
  assert.notEqual(refused.code, 0, `${refused.stdout}${refused.stderr}`);
  assert.match(refused.stderr, /^REFUSE install_parent_unwritable:/m);
});

test("installed launcher rejects changed bytes and accepts restoration and prefix changes", () => {
  const built = buildArtifact();
  for (const name of ["fresh", "different prefix"]) {
    const prefix = path.join(built.out, name);
    const installed = install(built, prefix);
    assert.equal(installed.code, 0, `${installed.stdout}${installed.stderr}`);
    const launcher = path.join(prefix, "bin", "seal");
    const original = fs.readFileSync(launcher);
    const launch = () => run(process.execPath, [launcher, "--version"]);
    assert.equal(launch().stdout.trim(), VERSION);
    fs.chmodSync(launcher, 0o755);
    // Equal length mutation proves the digest check, not just the byte count.
    const changed = Buffer.from(original);
    const offset = changed.indexOf("SPDX");
    assert.ok(offset >= 0);
    changed[offset] = "X".charCodeAt(0);
    fs.writeFileSync(launcher, changed);
    const refused = launch();
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /^REFUSE launcher_digest_mismatch:/m);
    assert.equal(refused.stdout, "");
    fs.writeFileSync(launcher, original);
    const restored = launch();
    assert.equal(restored.code, 0, restored.stderr);
    assert.equal(restored.stdout.trim(), VERSION);
    const reinstalled = install(built, prefix);
    assert.equal(reinstalled.code, 0, reinstalled.stderr);
    assert.equal(launch().code, 0);
  }
});

test("authorization rechecks the fixed installed tree and refuses without a kernel result", () => {
  const built = buildArtifact();
  const prefix = path.join(built.out, "runtime-check");
  assert.equal(install(built, prefix).code, 0);
  const recordPath = path.join(prefix, "lib/seal/install.json");
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  const root = path.join(prefix, record.store);
  const { createRuntimeTreeCheck } = require("../spine/integrity.cjs");
  const { createApprovalContract } = require("../contract/contract.cjs");
  const check = createRuntimeTreeCheck(root);
  let kernelCalls = 0;
  const contract = createApprovalContract({ runtimeTreeCheck: check,
    kernelAdapter: { authorize() { kernelCalls++; return { verdict: "ALLOW" }; } } });
  function accept() {
    const call = { tool: "write", args: { line: "runtime" } };
    const requestState = contract.begin(call).result.requestState;
    return contract.retry({ ...call, requestState,
      inputResponses: { approval: { action: "accept", content: { approve: true } } } });
  }
  const file = path.join(root, "NOTICE");
  const original = fs.readFileSync(file);
  fs.chmodSync(file, 0o644);
  try {
    const bytes = Buffer.from(original); bytes[0] ^= 1;
    fs.writeFileSync(file, bytes);
    assert.equal(check().band, "FAIL");
    const failed = accept();
    assert.equal(failed.refusal, "runtime_tree_fail");
    assert.equal(failed.receipt, undefined);
    assert.equal(kernelCalls, 0);
  } finally { fs.writeFileSync(file, original); fs.chmodSync(file, 0o444); }
  fs.renameSync(recordPath, `${recordPath}.held`);
  try {
    assert.equal(check().band, "UNKNOWN");
    const unknown = accept();
    assert.equal(unknown.refusal, "runtime_tree_unknown");
    assert.equal(unknown.receipt, undefined);
    assert.equal(kernelCalls, 0);
  } finally { fs.renameSync(`${recordPath}.held`, recordPath); }
  assert.equal(accept().kind, "allow");
  assert.equal(accept().kind, "allow");
  assert.equal(kernelCalls, 2, "each clean approval enters the kernel");
  fs.chmodSync(root, 0o755);
  const extra = path.join(root, "unrecorded");
  try {
    fs.writeFileSync(extra, "not in the anchor");
    assert.equal(check().band, "FAIL");
    assert.equal(accept().refusal, "runtime_tree_fail");
    assert.equal(kernelCalls, 2, "the next approval must recheck the tree");
  } finally { fs.unlinkSync(extra); fs.chmodSync(root, 0o555); }
  assert.equal(createRuntimeTreeCheck(ROOT)().band, "UNKNOWN");
});
