const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const CLI = path.join(__dirname, "../bin/seal");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../runtime-manifest.json"), "utf8"));
function run(args, root, input = "") {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], {
      env: { ...process.env, HOME: root, XDG_DATA_HOME: path.join(root, ".local", "share"), SEAL_CACHE_DIR: path.join(root, ".cache", "seal") },
      input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }) };
  } catch (error) { return { code: error.status, out: `${error.stdout || ""}${error.stderr || ""}` }; }
}

test("status names a missing receipt directory as no receipt yet", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-empty-"));
  const result = run(["status"], root);
  assert.equal(result.code, 0);
  assert.match(result.out, /^Runtime: absent /m);
  assert.match(result.out, /^Receipts: 0 stored in .* \(directory does not exist\)$/m);
  assert.match(result.out, /^Most recent: no receipt yet \(receipt directory is missing\)$/m);
});

test("status names an unreadable receipt directory and its permission action", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-unreadable-dir-"));
  const receiptDir = path.join(root, ".local", "share", "seal", "receipts");
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.chmodSync(receiptDir, 0o000);
  const result = run(["status"], root);
  assert.equal(result.code, 0);
  assert.match(result.out, /^Receipts: unavailable in .* \(directory cannot be read\)$/m);
  assert.match(result.out, /^Most recent: receipts may exist, but the receipt directory cannot be read; check its permissions$/m);
  fs.chmodSync(receiptDir, 0o700);
});

test("status names receipt files when none can be parsed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-no-parseable-"));
  const receiptDir = path.join(root, ".local", "share", "seal", "receipts");
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(path.join(receiptDir, "not-a-receipt.json"), "not json\n");
  const result = run(["status"], root);
  assert.equal(result.code, 0);
  assert.match(result.out, /^Receipt unreadable: not-a-receipt\.json \(Unexpected token/m);
  assert.match(result.out, /^Most recent: receipt files exist, but none could be read as a receipt$/m);
});

test("status names cached runtime hash mismatch as an integrity failure", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-hash-mismatch-"));
  const staged = path.join(root, ".cache", "seal", "runtime", manifest.commit, "kernel", "wasm", "seal.js");
  fs.mkdirSync(path.dirname(staged), { recursive: true });
  fs.writeFileSync(staged, "one corrupt staged byte\n");
  const result = run(["status"], root);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, new RegExp(`^Runtime: integrity check failed seal-assurance-kit@${manifest.commit} \\(kernel/wasm/seal\\.js hash mismatch; cached bytes do not match the published runtime\\)$`, "m"));
  assert.doesNotMatch(result.out, /^Runtime: absent /m);
});

const { writeKernelReceipt } = require("./helpers/kernel-receipt.cjs");

// Produce receipts the way a USER does: run the demo. A test that hand-builds
// its input is testing its own imagination — the previous version of this
// test built kernel-schema receipts (verdict/now) the product never writes,
// so it stayed green while `seal status` could not read a single real receipt.
function runDemoReceipts() {
  const demoDir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-demo-src-"));
  execFileSync(process.execPath, [CLI, "demo", "--dir", demoDir], { input: "y\n", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  return path.join(demoDir, "receipts");
}

test("status reads the receipts the product actually writes, and names corruption", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-real-"));
  const receiptDir = path.join(root, ".local", "share", "seal", "receipts");
  fs.mkdirSync(receiptDir, { recursive: true });
  const produced = runDemoReceipts();
  const names = fs.readdirSync(produced);
  assert.equal(names.length, 3, `demo should write 3 receipts, wrote ${names.length}`);
  for (const name of names) fs.copyFileSync(path.join(produced, name), path.join(receiptDir, name));
  fs.writeFileSync(path.join(receiptDir, "corrupt.json"), "not json\n");

  const result = run(["status"], root);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /^Receipts: 4 stored in /m);
  // Only the corrupt file is unreadable; every real product receipt is read.
  assert.match(result.out, /^Receipt unreadable: corrupt\.json \(Unexpected token/m);
  assert.doesNotMatch(result.out, /^Receipt unreadable: receipt-.*\(missing/m);
  // Most recent names a real spine decision at a real receipt time.
  assert.match(result.out, /^Most recent: (ALLOW|BLOCK|INPUT_REQUIRED) at receipt time \d+ \(receipt-/m);
});

test("status reports the kernel runtime as present when it is cached", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-runtime-"));
  // The helper's job here is only to POPULATE the assurance-kit runtime cache;
  // the kernel receipt it also writes is removed so this test asserts the
  // runtime line, not receipt reading (that is the demo-driven test above).
  const receipt = await writeKernelReceipt(path.join(root, ".cache", "seal"), path.join(root, ".local", "share"));
  fs.rmSync(receipt);
  const result = run(["status"], root);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /^Runtime: present seal-assurance-kit@/m);
});
