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
function runLauncher(launcher, args, cache, dataHome, input = undefined, extraEnv = {}) {
  try {
    return { code: 0, output: execFileSync(process.execPath, [launcher, ...args], {
      env: { ...process.env, SEAL_CACHE_DIR: cache, XDG_DATA_HOME: dataHome, ...extraEnv }, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }) };
  } catch (error) {
    return { code: error.status, output: `${error.stdout || ""}${error.stderr || ""}` };
  }
}
function runDemo(input, cache, dataHome) { return runCommand(["demo"], cache, dataHome, input); }

test("seal demo emits the exact hint for each launcher mode", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-hint-modes-"));
  const cache = fs.mkdtempSync(path.join(root, "cache-"));
  const dataHome = fs.mkdtempSync(path.join(root, "data-"));
  const npxLauncher = path.join(root, "_npx", "pkg", "bin", "seal");
  const pathLauncher = path.join(root, "path-bin", "seal");
  fs.mkdirSync(path.dirname(npxLauncher), { recursive: true });
  fs.mkdirSync(path.dirname(pathLauncher), { recursive: true });
  fs.symlinkSync(path.join(__dirname, "../bin/seal"), npxLauncher);
  fs.symlinkSync(path.join(__dirname, "../bin/seal"), pathLauncher);
  const receipt = (output) => output.match(/^RECEIPT\s+(.+)$/m)?.[1];

  const npx = runLauncher(npxLauncher, ["demo"], cache, dataHome, "y\n", { PATH: "/usr/bin:/bin" });
  assert.equal(npx.code, 0, npx.output);
  assert.match(npx.output, new RegExp(`Verify later with: npx github:velvetmonkey/seal verify ${receipt(npx.output)}`));

  const installed = runLauncher(pathLauncher, ["demo"], cache, dataHome, "y\n", { PATH: `${path.dirname(pathLauncher)}:/usr/bin:/bin` });
  assert.equal(installed.code, 0, installed.output);
  assert.match(installed.output, new RegExp(`Verify later with: seal verify ${receipt(installed.output)}`));

  const direct = runLauncher(path.join(__dirname, "../bin/seal"), ["demo"], cache, dataHome, "y\n", { PATH: "/usr/bin:/bin" });
  assert.equal(direct.code, 0, direct.output);
  const directReceipt = receipt(direct.output);
  assert.match(direct.output, new RegExp(`Verify later with: ${directReceipt}`));
  assert.doesNotMatch(direct.output, /Verify later with: (?:npx |seal verify)/);

  const ambient = runLauncher(pathLauncher, ["demo"], cache, dataHome, "y\n", { PATH: `${path.dirname(pathLauncher)}:/usr/bin:/bin`, npm_command: "exec", npm_config_npx: "true" });
  assert.equal(ambient.code, 0, ambient.output);
  assert.match(ambient.output, new RegExp(`Verify later with: seal verify ${receipt(ambient.output)}`));
});

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
