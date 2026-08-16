const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFile, execFileSync } = require("node:child_process");
const { promisify } = require("node:util");
const test = require("node:test");

const CLI = path.join(__dirname, "../bin/seal");
const execFileAsync = promisify(execFile);
const env = (cache, dataHome) => ({ ...process.env, SEAL_CACHE_DIR: cache, XDG_DATA_HOME: dataHome });
function run(args, cache, dataHome, input = "") {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { env: env(cache, dataHome), input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }) };
  } catch (error) { return { code: error.status, out: `${error.stdout}${error.stderr}` }; }
}

async function runAsync(args, cache, dataHome, extraEnv = {}) {
  try {
    const result = await execFileAsync(process.execPath, [CLI, ...args], {
      env: { ...env(cache, dataHome), ...extraEnv }, encoding: "utf8",
    });
    return { code: 0, out: `${result.stdout}${result.stderr}` };
  } catch (error) { return { code: error.code, out: `${error.stdout}${error.stderr}` }; }
}

async function refusingRuntimeServer(statusCode) {
  const server = http.createServer((request, response) => {
    response.writeHead(statusCode, { "content-type": "text/plain" });
    response.end("absent\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { base: `http://127.0.0.1:${address.port}/runtime`, close: () => new Promise((resolve) => server.close(resolve)) };
}

const { ensureRuntime, writeKernelReceipt } = require("../test-support/kernel-receipt.cjs");

function runtimeRefusalContext() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-runtime-refusal-"));
  const cache = path.join(root, "cache");
  const dataHome = path.join(root, "data");
  const receipt = path.join(root, "receipt.json");
  fs.writeFileSync(receipt, "{}\n");
  const runtime = path.join(cache, "runtime", require("../runtime-manifest.json").commit, "kernel/wasm/seal.js");
  return { cache, dataHome, receipt, runtime };
}

test("verify names a pinned runtime unavailable without a network", async () => {
  const { cache, dataHome, receipt, runtime } = runtimeRefusalContext();

  const unavailable = await runAsync(["verify", receipt], cache, dataHome, { SEAL_RUNTIME_BASE_URL: "http://127.0.0.1:9/runtime" });
  assert.equal(unavailable.code, 1);
  assert.equal(unavailable.out, `seal: runtime_download_no_network: Seal needed the pinned runtime file at ${runtime}; it could not reach http://127.0.0.1:9/runtime/kernel/wasm/seal.js because this machine has no network connection. Connect this machine to the network, then run \`seal verify ${receipt}\`. Seal did not inspect the receipt or write this runtime file.\n`);
});

test("verify names a pinned runtime absent from its source", async (t) => {
  const { cache, dataHome, receipt, runtime } = runtimeRefusalContext();
  const remote = await refusingRuntimeServer(404);
  t.after(remote.close);
  const absent = await runAsync(["verify", receipt], cache, dataHome, { SEAL_RUNTIME_BASE_URL: remote.base });
  assert.equal(absent.code, 1);
  assert.equal(absent.out, `seal: runtime_download_not_found: Seal needed the pinned runtime file at ${runtime}; it was not found at ${remote.base}/kernel/wasm/seal.js (HTTP 404). Check that the pinned runtime revision is published, then run \`seal verify ${receipt}\`. Seal did not inspect the receipt or write this runtime file.\n`);
});

test("verify names an unreadable pinned runtime cache path", async () => {
  const { cache, dataHome, receipt, runtime } = runtimeRefusalContext();
  fs.mkdirSync(runtime, { recursive: true });
  const unreadable = await runAsync(["verify", receipt], cache, dataHome);
  assert.equal(unreadable.code, 1);
  assert.equal(unreadable.out, `seal: runtime_cache_unreadable: Seal needed the pinned runtime file at ${runtime}; it could not read the cached file. Make that cache path readable, then run \`seal verify ${receipt}\`. Seal did not inspect the receipt or replace this runtime file.\n`);
});

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
  await ensureRuntime(verifyCache);
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

test("verify refuses empty, malformed, and non-receipt JSON paths", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-invalid-"));
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-invalid-cache-"));
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-invalid-data-"));
  await ensureRuntime(cache);
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

test("seal verify recognizes a self-contained real spine receipt and routes to the separate checker", () => {
  // A spine receipt produced the way a user produces one: run the demo. The
  // demo's fabricated, temporarily-signed receipts live beside its key, not
  // in the durable data store supplied to this process.
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-spine-cache-"));
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "seal-verify-spine-data-"));
  const demo = run(["demo"], cache, dataHome, "y\n");
  assert.equal(demo.code, 0, demo.out);
  const receiptPaths = [...demo.out.matchAll(/^receipt written: (.+)$/gm)].map((match) => match[1]);
  const spine = receiptPaths.find((receiptPath) => receiptPath.includes("-ALLOW.json"));
  assert.ok(spine, demo.out);
  assert.ok(!fs.existsSync(path.join(dataHome, "seal", "receipts")), "demo must not use the durable receipt store");

  const result = run(["verify", spine], cache, dataHome);
  // Recognized coherently, not crashed as an unknown schema.
  assert.notEqual(result.code, 0, result.out);
  assert.match(result.out, /spine_receipt_use_separate_checker/);
  assert.match(result.out, /shipped in this artifact/);
  assert.match(result.out, /cannot protect against a replaced artifact/);
  assert.match(result.out, /seal-receipt-check\.mjs/);
  // The old bug: verify treated a real product receipt as an unrecognized kernel receipt.
  assert.doesNotMatch(result.out, /unrecognized|no recognized version discriminator|verdict: undefined/);
});
