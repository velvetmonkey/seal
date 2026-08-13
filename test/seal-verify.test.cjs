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

test("seal verify accepts a receipt copied away from all demo state", () => {
  const demoCache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-portable-demo-cache-"));
  const demoData = fs.mkdtempSync(path.join(os.tmpdir(), "seal-portable-demo-data-"));
  const demo = run(["demo"], demoCache, demoData, "y\n");
  assert.equal(demo.code, 0, demo.out);
  const original = demo.out.match(/^RECEIPT\s+(.+)$/m)?.[1];
  assert.ok(original, demo.out);
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "seal-portable-copy-"));
  const copied = path.join(fresh, "carried-receipt.json");
  fs.copyFileSync(original, copied);
  fs.rmSync(demoCache, { recursive: true, force: true });
  fs.rmSync(demoData, { recursive: true, force: true });
  const verifyCache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-portable-verify-cache-"));
  const verifyData = fs.mkdtempSync(path.join(os.tmpdir(), "seal-portable-verify-data-"));
  const result = run(["verify", copied], verifyCache, verifyData);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /PASS VERIFIED  the receipt re-derived the approved decision/);
});

test("verify refuses absent, empty, unreadable, directory, and non-receipt JSON paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-inputs-"));
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-cache-"));
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-data-"));
  for (const [name, pattern] of [["absent.json", /cannot read receipt/], ["empty.json", /receipt is empty/], ["bad.json", /not valid JSON/], ["directory", /not a readable file/], ["unreadable.json", /not a readable file/], ["not-a-receipt.json", /receipt verification failed|not a valid receipt|schema valid/]]) {
    const target = path.join(root, name);
    if (name === "empty.json") fs.writeFileSync(target, "");
    else if (name === "bad.json") fs.writeFileSync(target, "{");
    else if (name === "not-a-receipt.json") fs.writeFileSync(target, "{}\n");
    else if (name === "directory") fs.mkdirSync(target);
    else if (name === "unreadable.json") { fs.writeFileSync(target, "{}"); fs.chmodSync(target, 0o000); }
    const result = run(["verify", target], cache, dataHome);
    assert.notEqual(result.code, 0, `${name} unexpectedly passed: ${result.out}`);
    assert.match(result.out, pattern);
  }
});
