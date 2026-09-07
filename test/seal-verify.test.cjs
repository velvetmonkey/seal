// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const CLI = path.join(__dirname, "../bin/seal");

function run(args, input = "") {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }) };
  } catch (error) {
    return { code: error.status, out: `${error.stdout || ""}${error.stderr || ""}` };
  }
}

function realReceipt() {
  const dir = testTmpdir(path.join(os.tmpdir(), "seal-verify-v2-"));
  const demo = run(["demo", "--dir", dir], "y\n");
  assert.equal(demo.code, 0, demo.out);
  const name = fs.readdirSync(path.join(dir, "receipts")).find((entry) => entry.endsWith("-ALLOW.json"));
  return {
    dir,
    receipt: path.join(dir, "receipts", name),
    publicKey: fs.readFileSync(path.join(dir, "receipt-signer.pub"), "utf8").trim(),
  };
}

test("seal verify exits successfully only for a signed receipt and the correct key", () => {
  const real = realReceipt();
  const result = run(["verify", real.receipt, "--pubkey", real.publicKey]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /Document structure       VALID/);
  assert.match(result.out, /Signature and bindings   VALID/);
  assert.match(result.out, /Verifier-local verdict   REPRODUCED/);
  assert.match(result.out, /VERIFY    UNVERIFIED/);

  const wrong = crypto.generateKeyPairSync("ed25519").publicKey
    .export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  const wrongKey = run(["verify", real.receipt, "--pubkey", wrong]);
  assert.notEqual(wrongKey.code, 0, wrongKey.out);
  assert.match(wrongKey.out, /signature_mismatch/);

  const withoutKey = run(["verify", real.receipt]);
  assert.notEqual(withoutKey.code, 0, withoutKey.out);
  assert.match(withoutKey.out, /Signature and bindings   UNVERIFIED/);
  assert.match(withoutKey.out, /VERIFY    UNVERIFIED/);
});

test("seal verify exits nonzero for a fabricated unsigned receipt", () => {
  const real = realReceipt();
  const body = JSON.parse(fs.readFileSync(real.receipt, "utf8"));
  delete body.signature;
  const fabricated = path.join(real.dir, "fabricated.json");
  fs.writeFileSync(fabricated, JSON.stringify(body));
  const result = run(["verify", fabricated, "--pubkey", real.publicKey]);
  assert.notEqual(result.code, 0, result.out);
  assert.match(result.out, /Signature and bindings   UNVERIFIED/);
  assert.match(result.out, /VERIFY    UNVERIFIED/);
});

test("verify distinguishes an uninspectable path from unreadable receipt contents", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-verify-inputs-"));
  const absent = path.join(root, "absent.json");
  const missing = run(["verify", absent]);
  assert.notEqual(missing.code, 0, missing.out);
  assert.match(missing.out, /^seal: cannot inspect receipt path:/);
  const unreadable = run(["verify", "/proc/1/mem"]);
  assert.notEqual(unreadable.code, 0, unreadable.out);
  assert.match(unreadable.out, /^seal: cannot read receipt contents:/);
});

test("verify refuses empty, malformed, and non-receipt JSON paths", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-verify-invalid-"));
  for (const [name, bytes, pattern] of [
    ["empty.json", "", /receipt is empty/],
    ["bad.json", "{", /read_failed/],
    ["not-a-receipt.json", "{}", /unsupported receipt schema/],
  ]) {
    const target = path.join(root, name);
    fs.writeFileSync(target, bytes);
    const result = run(["verify", target]);
    assert.notEqual(result.code, 0, `${name} unexpectedly passed: ${result.out}`);
    assert.match(result.out, pattern);
  }
});

test("verify refuses a tampered producer receipt", () => {
  const real = realReceipt();
  const body = JSON.parse(fs.readFileSync(real.receipt, "utf8"));
  body.arguments.line = "tampered";
  const target = path.join(real.dir, "tampered.json");
  fs.writeFileSync(target, JSON.stringify(body));
  const result = run(["verify", target]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /commitment_mismatch/);
});

test("verify refuses a changed local kernel before reporting a verdict", () => {
  const real = realReceipt();
  const tree = path.join(real.dir, "verifier");
  const source = path.resolve(__dirname, "..");
  for (const entry of ["bin", "spine", "scripts", "checker", "contract", "runtime", "runtime-manifest.json", "package.json", "VERSION"]) {
    fs.cpSync(path.join(source, entry), path.join(tree, entry), { recursive: true });
  }
  const { spawnSync } = require("node:child_process");
  const verify = () => spawnSync(process.execPath, [path.join(tree, "bin/seal"), "verify", real.receipt, "--pubkey", real.publicKey], {
    encoding: "utf8", env: { ...process.env, SEAL_CACHE_DIR: path.join(real.dir, "empty-cache") },
  });
  const honest = verify();
  assert.equal(honest.status, 0, honest.stdout + honest.stderr);
  assert.match(honest.stdout, /Verifier-local verdict   REPRODUCED/);

  for (const relative of ["kernel/wasm/seal.wasm", "kernel/wasm/seal.js"]) {
    const target = path.join(tree, "runtime", relative);
    const pinned = fs.readFileSync(target);
    try {
      // A valid WASM custom section changes the binary without breaking replay.
      // A JS comment likewise preserves execution, so replay failure cannot
      // accidentally satisfy this integrity-refusal regression.
      fs.appendFileSync(target, relative.endsWith(".wasm")
        ? Buffer.from([0, 2, 1, 120]) : "\n// changed local glue\n");
      const changed = verify();
      assert.equal(changed.status, 1, changed.stdout + changed.stderr);
      assert.match(changed.stderr, /local kernel runtime integrity check failed/);
      assert.ok(changed.stderr.includes(`${relative} hash mismatch`), changed.stderr);
      assert.doesNotMatch(changed.stdout + changed.stderr, /REPRODUCED|Document structure/);
    } finally {
      fs.writeFileSync(target, pinned);
    }
  }
});
