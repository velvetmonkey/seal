const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");

function runCommand(args, cache, dataHome, input = undefined) {
  const result = spawnSync(process.execPath, [path.join(__dirname, "../bin/seal"), ...args], {
    env: { ...process.env, SEAL_CACHE_DIR: cache, XDG_DATA_HOME: dataHome }, input, encoding: "utf8",
  });
  return { code: result.status, output: `${result.stdout || ""}${result.stderr || ""}` };
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

function hintModeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-hint-modes-"));
  const cache = fs.mkdtempSync(path.join(root, "cache-"));
  const dataHome = fs.mkdtempSync(path.join(root, "data-"));
  const npxLauncher = path.join(root, "_npx", "pkg", "bin", "seal");
  const pathLauncher = path.join(root, "path-bin", "seal");
  fs.mkdirSync(path.dirname(npxLauncher), { recursive: true });
  fs.mkdirSync(path.dirname(pathLauncher), { recursive: true });
  fs.symlinkSync(path.join(__dirname, "../bin/seal"), npxLauncher);
  fs.symlinkSync(path.join(__dirname, "../bin/seal"), pathLauncher);
  return { root, cache, dataHome, npxLauncher, pathLauncher, receipt: (output) => output.match(/^RECEIPT\s+(.+)$/m)?.[1] };
}

test("seal demo emits the exact npx launcher hint", () => {
  const { cache, dataHome, npxLauncher, receipt } = hintModeFixture();
  const npx = runLauncher(npxLauncher, ["demo"], cache, dataHome, "y\n", { PATH: "/usr/bin:/bin" });
  assert.equal(npx.code, 0, npx.output);
  assert.match(npx.output, new RegExp(`Verify later with: npx github:velvetmonkey/seal verify ${receipt(npx.output)}`));
});

test("seal demo emits the exact PATH-installed launcher hint", () => {
  const { cache, dataHome, pathLauncher, receipt } = hintModeFixture();
  const installed = runLauncher(pathLauncher, ["demo"], cache, dataHome, "y\n", { PATH: `${path.dirname(pathLauncher)}:/usr/bin:/bin` });
  assert.equal(installed.code, 0, installed.output);
  assert.match(installed.output, new RegExp(`Verify later with: seal verify ${receipt(installed.output)}`));
});

test("seal demo emits the exact direct-node launcher hint", () => {
  const { cache, dataHome, receipt } = hintModeFixture();
  const direct = runLauncher(path.join(__dirname, "../bin/seal"), ["demo"], cache, dataHome, "y\n", { PATH: "/usr/bin:/bin" });
  assert.equal(direct.code, 0, direct.output);
  const directReceipt = receipt(direct.output);
  assert.match(direct.output, new RegExp(`Verify later with: ${directReceipt}`));
  assert.doesNotMatch(direct.output, /Verify later with: (?:npx |seal verify)/);
});

test("seal demo emits the exact PATH hint despite ambient npm variables", () => {
  const { cache, dataHome, pathLauncher, receipt } = hintModeFixture();
  const ambient = runLauncher(pathLauncher, ["demo"], cache, dataHome, "y\n", { PATH: `${path.dirname(pathLauncher)}:/usr/bin:/bin`, npm_command: "exec", npm_config_npx: "true" });
  assert.equal(ambient.code, 0, ambient.output);
  assert.match(ambient.output, new RegExp(`Verify later with: seal verify ${receipt(ambient.output)}`));
});

test("seal demo and help describe the approval decision without claiming execution", () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-runtime-approval-test-"));
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "seal-data-test-"));
  const approved = runDemo("y\n", cache, dataHome);
  assert.equal(approved.code, 0);
  assert.match(approved.output, /BLOCKED  the kernel found no matching approval/);
  assert.match(approved.output, /Approval requested/);
  assert.match(approved.output, /Tool          db\.execute/);
  assert.match(approved.output, /Exact effect  database: demo\n                sql: drop table users/);
  assert.match(approved.output, /Scope         these exact arguments/);
  assert.match(approved.output, /Approve\? \[y\/N\]/);
  assert.match(approved.output, /ALLOWED  the kernel accepted the supplied approval/);
  assert.match(approved.output, /PASS VERIFIED  the resulting decision receipt re-derived successfully/);
  assert.match(approved.output, /Verify later with: /);
  assert.doesNotMatch(approved.output, /Commitment digest/);
  assert.doesNotMatch(approved.output, /\b(?:EXECUTED|demo server|once)\b/i, "demo output must not imply an executed call or one-use grant");

  const help = runCommand([], cache, dataHome);
  assert.equal(help.code, 0, help.output);
  assert.match(help.output, /seal demo             block, show the exact effect, approve, and verify a receipt/);
  assert.doesNotMatch(help.output, /\b(?:EXECUTED|demo server|once)\b/i, "help output must not imply an executed call or one-use grant");

  const detailed = runCommand(["demo", "--details"], cache, dataHome, "y\n");
  assert.equal(detailed.code, 0, detailed.output);
  assert.match(detailed.output, /Commitment digest  [0-9a-f]{64}/);

  const declined = runDemo("N\n", cache, dataHome);
  assert.equal(declined.code, 0);
  assert.match(declined.output, /Demo stopped safely; no downstream tool was contacted\./);

  const eof = runDemo("", cache, dataHome);
  assert.notEqual(eof.code, 0);
  assert.match(eof.output, /No approval response received \(EOF\); no downstream tool was contacted\./);
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
