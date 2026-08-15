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

// The END-TO-END path a user takes: run `seal demo`, then `seal status`, and
// see the receipts. No --dir, no hand-built fixture, no copying — the demo
// writes where a real run writes and status reads where it reads. This single
// assertion catches BOTH defects at once: the wrong schema (status could not
// parse a spine receipt) and the wrong place (the demo wrote to a temp dir
// status never looks in). A test that builds its own input, or hands status a
// receipt directly, would have caught neither.
test("END TO END: seal demo then seal status shows the receipts, and names corruption", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-e2e-"));
  const demo = run(["demo"], root, "y\n");
  assert.equal(demo.code, 0, demo.out);

  // The demo wrote its receipts to the store status reads — plant a corrupt
  // file there too, then run status once.
  const receiptDir = path.join(root, ".local", "share", "seal", "receipts");
  fs.writeFileSync(path.join(receiptDir, "corrupt.json"), "not json\n");

  const result = run(["status"], root);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /^Receipts: 4 stored in /m);
  assert.match(result.out, /^Receipt unreadable: corrupt\.json \(Unexpected token/m);
  assert.doesNotMatch(result.out, /^Receipt unreadable: receipt-.*\(missing/m);
  assert.match(result.out, /^Most recent \(by write time\): (ALLOW|BLOCK|INPUT_REQUIRED) at receipt time \d+ \(receipt-/m);
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
