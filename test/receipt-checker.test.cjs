// SPDX-License-Identifier: Apache-2.0
// Producer/judge integration: the product emits the one v2 receipt and the
// separately landed verifier accepts it without importing the producer.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");
const CHECKER = path.join(ROOT, "checker", "seal-receipt-v2.mjs");

function makeRealReceipt() {
  const dir = testTmpdir(path.join(os.tmpdir(), "seal-receipt-v2-"));
  const demo = spawnSync(process.execPath, [SEAL, "demo", "--dir", dir], {
    input: "y\n", encoding: "utf8", timeout: 30000,
  });
  assert.equal(demo.status, 0, `${demo.stdout}\n${demo.stderr}`);
  const name = fs.readdirSync(path.join(dir, "receipts")).find((entry) => entry.endsWith("-ALLOW.json"));
  assert.ok(name, demo.stdout);
  return {
    dir,
    receipt: path.join(dir, "receipts", name),
    publicKey: fs.readFileSync(path.join(dir, "receipt-signer.pub"), "utf8").trim(),
  };
}

function check(receipt, publicKey, checker = CHECKER) {
  const args = [checker, receipt];
  if (publicKey) args.push("--pubkey", publicKey);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function writeMutation(real, name, mutate) {
  const body = JSON.parse(fs.readFileSync(real.receipt, "utf8"));
  mutate(body);
  const target = path.join(real.dir, name);
  fs.writeFileSync(target, JSON.stringify(body));
  return target;
}

test("the producer emits a signed v2 receipt accepted by the pre-landed judge", () => {
  const real = makeRealReceipt();
  const body = JSON.parse(fs.readFileSync(real.receipt, "utf8"));
  assert.equal(body.seal_receipt, "v2");
  assert.equal(body.action, "ALLOW");
  assert.equal(body.verdict, "ALLOW");
  assert.deepEqual(body.granted_capabilities.map(({ target }) => target), body.kernel_inputs.approvals);
  const result = check(real.receipt, real.publicKey);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Document structure       VALID/);
  assert.match(result.stdout, /Signature and bindings   VALID/);
  assert.match(result.stdout, /Verifier-local verdict   REPRODUCED/);
  assert.match(result.stdout, /Event occurrence         NOT ESTABLISHED/);
  assert.match(result.stdout, /VERIFY    UNVERIFIED/);
});

test("altered arguments are RED at the v2 commitment boundary", () => {
  const real = makeRealReceipt();
  const body = JSON.parse(fs.readFileSync(real.receipt, "utf8"));
  body.arguments.line = "altered";
  const tampered = path.join(real.dir, "tampered.json");
  fs.writeFileSync(tampered, JSON.stringify(body));
  const result = check(tampered, real.publicKey);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^REFUSE commitment_mismatch:/);
});

test("three distinct mutation sites each produce a distinct refusal", () => {
  const real = makeRealReceipt();
  const argumentsResult = check(writeMutation(real, "arguments.json", (body) => { body.arguments.line = "altered"; }), real.publicKey);
  const signatureResult = check(writeMutation(real, "signature.json", (body) => { body.signature.value = "0".repeat(128); }), real.publicKey);
  const verdictResult = check(writeMutation(real, "verdict.json", (body) => { body.verdict = "BLOCK"; delete body.signature; }));
  assert.match(argumentsResult.stdout, /^REFUSE commitment_mismatch:/);
  assert.match(signatureResult.stdout, /^REFUSE signature_mismatch:/);
  assert.match(verdictResult.stdout, /^REFUSE verdict_mismatch:/);
});

test("the signature is the unforgeable backstop: repairing commitments still refuses", () => {
  const { canonical, sha256Hex } = require("../spine/receipt-v2.cjs");
  const real = makeRealReceipt();
  const forged = writeMutation(real, "forged.json", (body) => {
    body.arguments.line = "altered and recommitted";
    body.replay.args_sha256 = sha256Hex(canonical(body.arguments));
  });
  const result = check(forged, real.publicKey);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^REFUSE signature_mismatch:/);
});

test("the checker runs with the seal binary absent (copied to a clean dir)", () => {
  const real = makeRealReceipt();
  const clean = testTmpdir(path.join(os.tmpdir(), "seal-v2-checker-only-"));
  fs.mkdirSync(path.join(clean, "checker"));
  fs.cpSync(path.join(ROOT, "runtime"), path.join(clean, "runtime"), { recursive: true });
  const isolated = path.join(clean, "checker", "seal-receipt-v2.mjs");
  fs.copyFileSync(CHECKER, isolated);
  assert.equal(fs.existsSync(path.join(clean, "bin", "seal")), false);
  const result = check(real.receipt, real.publicKey, isolated);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Verifier-local verdict   REPRODUCED/);
});

test("the verifier takes its key out of band and never reaches positive VERIFY", () => {
  const real = makeRealReceipt();
  const withoutKey = spawnSync(process.execPath, [CHECKER, real.receipt], { encoding: "utf8" });
  assert.equal(withoutKey.status, 0, withoutKey.stdout + withoutKey.stderr);
  assert.match(withoutKey.stdout, /Signature and bindings   UNVERIFIED/);
  assert.match(withoutKey.stdout, /VERIFY    UNVERIFIED/);
});

test("the retired v1 checker and sorted-key producer are absent", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "checker", "seal-receipt-check.mjs")), false);
  assert.equal(fs.existsSync(path.join(ROOT, "spine", "receipt-seal.cjs")), false);
});

for (const [label, command] of [["seal verify", [SEAL, "verify"]], ["standalone checker", [CHECKER]]]) {
  test(`argshape ${label} rejects corrupt UTF-8 but accepts genuine multibyte text`, () => {
    const real = makeRealReceipt();
    const { generateSigner, sealReceipt } = require("../spine/receipt-v2.cjs");
    const signer = generateSigner();
    const record = JSON.parse(fs.readFileSync(real.receipt));
    record.reason = "legitimate é 漢 😀 replacement �";
    const bytes = Buffer.from(JSON.stringify(sealReceipt(signer, record, record.action)));
    const legitimate = path.join(real.dir, "legitimate.json");
    fs.writeFileSync(legitimate, bytes);
    const checked = spawnSync(process.execPath, [...command, legitimate, "--pubkey", signer.publicKeyHex], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    assert.match(checked.stdout, /Signature and bindings   VALID/);
    assert.match(checked.stdout, /Verifier-local verdict   REPRODUCED/);
    const at = bytes.indexOf(Buffer.from("�"));
    assert.ok(at >= 0);
    const corrupt = path.join(real.dir, "corrupt.json");
    fs.writeFileSync(corrupt, Buffer.concat([bytes.subarray(0, at), Buffer.from([0xff]), bytes.subarray(at + 3)]));
    const refused = spawnSync(process.execPath, [...command, corrupt, "--pubkey", signer.publicKeyHex], { encoding: "utf8" });
    assert.equal(refused.status, 1, `corrupt bytes accepted: ${refused.stdout}${refused.stderr}`);
    assert.match(refused.stdout + refused.stderr, /read_failed|ill-formed UTF-8/);
  });
}

for (const [label, value] of [["1", 1], ["1.5", 1.5], ["true", true], ["false", false], ["0", 0], ["[]", []], ["null", null], ["missing", undefined]]) {
  test(`argshape receipt validator independently refuses ${label} through both CLIs`, () => {
    const real = makeRealReceipt();
    const body = JSON.parse(fs.readFileSync(real.receipt));
    if (value === undefined) delete body.arguments;
    else body.arguments = value;
    const file = path.join(real.dir, "shape.json");
    fs.writeFileSync(file, JSON.stringify(body));
    for (const command of [[SEAL, "verify"], [CHECKER]]) {
      const refused = spawnSync(process.execPath, [...command, file, "--pubkey", real.publicKey], { encoding: "utf8" });
      assert.equal(refused.status, 1, refused.stdout + refused.stderr);
      assert.match(refused.stdout + refused.stderr, /tool and arguments are required/);
    }
  });
}
