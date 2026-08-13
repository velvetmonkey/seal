const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

function runCommand(args, cache, dataHome, input = undefined) {
  try {
    return { code: 0, output: execFileSync(process.execPath, [path.join(__dirname, "../bin/seal"), ...args], {
      env: { ...process.env, SEAL_CACHE_DIR: cache, XDG_DATA_HOME: dataHome }, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }) };
  } catch (error) {
    return { code: error.status, output: `${error.stdout || ""}${error.stderr || ""}` };
  }
}
function runDemo(input, cache, dataHome) { return runCommand(["demo"], cache, dataHome, input); }

test("seal demo distinguishes approval, decline, and EOF", () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-runtime-approval-test-"));
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "seal-data-test-"));
  const approved = runDemo("y\n", cache, dataHome);
  assert.equal(approved.code, 0);
  assert.match(approved.output, /EXECUTED  demo server accepted the approved call/);
  assert.match(approved.output, /PASS VERIFIED  the receipt re-derived the approved decision/);
  assert.match(approved.output, /Verify later with: /);

  const declined = runDemo("N\n", cache, dataHome);
  assert.equal(declined.code, 0);
  assert.match(declined.output, /Demo stopped safely; no call executed\./);

  const eof = runDemo("", cache, dataHome);
  assert.notEqual(eof.code, 0);
  assert.match(eof.output, /No approval response received \(EOF\); no call executed\./);
});

test("seal demo keeps receipts for later verification and keeps both runs", () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-runtime-receipt-test-"));
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "seal-data-receipt-test-"));
  const first = runDemo("y\n", cache, dataHome);
  assert.equal(first.code, 0);
  const firstPath = first.output.match(/^RECEIPT\s+(.+)$/m)?.[1];
  assert.ok(firstPath, first.output);
  assert.ok(fs.existsSync(firstPath), firstPath);
  assert.match(first.output, /Verify later with: /);

  const verifyCache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-runtime-verify-test-"));
  const verifyDataHome = fs.mkdtempSync(path.join(os.tmpdir(), "seal-data-verify-test-"));
  const verified = runCommand(["verify", firstPath], verifyCache, verifyDataHome);
  assert.equal(verified.code, 0, verified.output);
  assert.match(verified.output, /PASS  VERIFIED|PASS VERIFIED/);

  const second = runDemo("y\n", cache, dataHome);
  assert.equal(second.code, 0);
  const secondPath = second.output.match(/^RECEIPT\s+(.+)$/m)?.[1];
  assert.ok(secondPath, second.output);
  assert.notEqual(secondPath, firstPath);
  assert.ok(fs.existsSync(firstPath), `first receipt was lost: ${firstPath}`);
  assert.ok(fs.existsSync(secondPath), secondPath);
});

test("seal demo fails closed when the runtime cannot be downloaded", () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-runtime-test-"));
  assert.throws(
    () => execFileSync(process.execPath, [path.join(__dirname, "../bin/seal"), "demo"], {
      env: { ...process.env, SEAL_CACHE_DIR: cache, SEAL_RUNTIME_BASE_URL: "http://127.0.0.1:1/no-runtime" },
      input: "n\n", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }),
    /runtime download failed|fetch failed|ECONNREFUSED/,
  );
});
