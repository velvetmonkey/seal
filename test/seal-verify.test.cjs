const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const CLI = path.join(__dirname, "../bin/seal");
const env = (cache, dataHome) => ({ ...process.env, SEAL_CACHE_DIR: cache, XDG_DATA_HOME: dataHome });
function run(args, cache, dataHome, input = "") {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { env: env(cache, dataHome), input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }) };
  } catch (error) { return { code: error.status, out: `${error.stdout}${error.stderr}` }; }
}

const { writeKernelReceipt } = require("./helpers/kernel-receipt.cjs");

test("seal verify accepts a receipt copied away from all generating state", async () => {
  const genCache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-portable-gen-cache-"));
  const genData = fs.mkdtempSync(path.join(os.tmpdir(), "seal-portable-gen-data-"));
  const original = await writeKernelReceipt(genCache, genData);
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "seal-portable-copy-"));
  const copied = path.join(fresh, "carried-receipt.json");
  fs.copyFileSync(original, copied);
  fs.rmSync(genCache, { recursive: true, force: true });
  fs.rmSync(genData, { recursive: true, force: true });
  const verifyCache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-portable-verify-cache-"));
  const verifyData = fs.mkdtempSync(path.join(os.tmpdir(), "seal-portable-verify-data-"));
  const result = run(["verify", copied], verifyCache, verifyData);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /RE-DERIVED  this binary re-derived the approved decision from the saved receipt/);
});

test("verify re-derives a saved kernel receipt in place", async () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-context-cache-"));
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-context-data-"));
  const receipt = await writeKernelReceipt(cache, dataHome);
  const verified = run(["verify", receipt], cache, dataHome);
  assert.equal(verified.code, 0, verified.out);
  assert.match(verified.out, /RE-DERIVED  this binary re-derived the approved decision from the saved receipt/);
});

test("verify distinguishes an uninspectable path from unreadable receipt contents", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-inputs-"));
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-cache-"));
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-data-"));
  const absent = path.join(root, "absent.json");
  const result = run(["verify", absent], cache, dataHome);
  assert.notEqual(result.code, 0, result.out);
  assert.match(result.out, new RegExp(`seal: cannot inspect receipt path: ${absent}`));
  const unreadableContents = run(["verify", "/proc/1/mem"], cache, dataHome);
  assert.notEqual(unreadableContents.code, 0, unreadableContents.out);
  assert.match(unreadableContents.out, /seal: cannot read receipt contents: \/proc\/1\/mem/);
});

test("verify distinguishes a non-file path from denied receipt permissions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-file-kind-"));
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-file-cache-"));
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-file-data-"));
  const directory = path.join(root, "directory");
  fs.mkdirSync(directory);
  const nonFile = run(["verify", directory], cache, dataHome);
  assert.notEqual(nonFile.code, 0, nonFile.out);
  assert.match(nonFile.out, new RegExp(`seal: receipt path is not a regular file: ${directory}`));
  const unreadable = path.join(root, "unreadable.json");
  fs.writeFileSync(unreadable, "{}\n");
  fs.chmodSync(unreadable, 0o000);
  const denied = run(["verify", unreadable], cache, dataHome);
  assert.notEqual(denied.code, 0, denied.out);
  assert.match(denied.out, new RegExp(`seal: receipt file permissions deny reading: ${unreadable}`));
});

test("verify refuses empty, malformed, and non-receipt JSON paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-invalid-"));
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-invalid-cache-"));
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-invalid-data-"));
  for (const [name, pattern] of [["empty.json", /receipt is empty/], ["bad.json", /not valid JSON/], ["not-a-receipt.json", /receipt verification failed|not a valid receipt|schema valid/]]) {
    const target = path.join(root, name);
    if (name === "empty.json") fs.writeFileSync(target, "");
    else if (name === "bad.json") fs.writeFileSync(target, "{");
    else fs.writeFileSync(target, "{}\n");
    const result = run(["verify", target], cache, dataHome);
    assert.notEqual(result.code, 0, `${name} unexpectedly passed: ${result.out}`);
    assert.match(result.out, pattern);
  }
});
