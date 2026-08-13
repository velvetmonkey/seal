const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

function runDemo(input, cache) {
  try {
    return { code: 0, output: execFileSync(process.execPath, [path.join(__dirname, "../bin/seal"), "demo"], {
      env: { ...process.env, SEAL_CACHE_DIR: cache }, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }) };
  } catch (error) {
    return { code: error.status, output: `${error.stdout || ""}${error.stderr || ""}` };
  }
}

test("seal demo distinguishes approval, decline, and EOF", () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-runtime-approval-test-"));
  const approved = runDemo("y\n", cache);
  assert.equal(approved.code, 0);
  assert.match(approved.output, /EXECUTED  demo server accepted the approved call/);
  assert.match(approved.output, /PASS VERIFIED  the receipt re-derived the approved decision/);

  const declined = runDemo("N\n", cache);
  assert.equal(declined.code, 0);
  assert.match(declined.output, /Demo stopped safely; no call executed\./);

  const eof = runDemo("", cache);
  assert.notEqual(eof.code, 0);
  assert.match(eof.output, /No approval response received \(EOF\); no call executed\./);
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
