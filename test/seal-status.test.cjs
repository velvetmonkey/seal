const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const CLI = path.join(__dirname, "../bin/seal");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../runtime-manifest.json"), "utf8"));
function run(args, root, input = "", cwd = process.cwd()) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, HOME: root, XDG_DATA_HOME: path.join(root, ".local", "share"), SEAL_CACHE_DIR: path.join(root, ".cache", "seal") },
      input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }) };
  } catch (error) { return { code: error.status, out: `${error.stdout || ""}${error.stderr || ""}` }; }
}

test("status finds the shipped kernel runtime with an empty cache", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-shipped-runtime-"));
  const result = run(["status"], root);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, new RegExp(`^Runtime: present seal-assurance-kit@${manifest.commit}$`, "m"));
  assert.ok(!fs.existsSync(path.join(root, ".cache", "seal", "runtime")), "status must not create a cache as a side effect");
});

test("status reads the protected project's recorded receipt directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-project-receipts-"));
  const project = path.join(root, "project");
  const dataHome = path.join(root, ".local", "share");
  const receiptDir = path.join(dataHome, "seal", "projects", "recorded-project", "receipts");
  const { statePathFor } = require("../spine/protection.cjs");
  fs.mkdirSync(project);
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(path.join(receiptDir, "approved.json"), JSON.stringify({ decision: "APPROVE", at: "2026-08-16T12:00:00.000Z" }));
  const statePath = statePathFor(project, { XDG_DATA_HOME: dataHome });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({
    schema: "seal.protect/v1", sealVersion: require("../spine/version.cjs").requireMatchingVersion(),
    state: "PENDING RESTART", serverName: "db", guardTool: "write", receiptsDir: receiptDir,
  }));

  const result = run(["status"], root, "", project);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, new RegExp(`^Receipts: 1 stored in ${receiptDir}$`, "m"));
  assert.match(result.out, /^Most recent \(by write time\): APPROVE at receipt time 2026-08-16T12:00:00\.000Z \(approved\.json\)$/m);
});

test("status names a missing receipt directory as no receipt yet", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-empty-"));
  const project = path.join(root, "project");
  const dataHome = path.join(root, ".local", "share");
  const receiptDir = path.join(dataHome, "seal", "projects", "missing-receipts", "receipts");
  const { statePathFor } = require("../spine/protection.cjs");
  fs.mkdirSync(project);
  const statePath = statePathFor(project, { XDG_DATA_HOME: dataHome });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({
    schema: "seal.protect/v1", sealVersion: require("../spine/version.cjs").requireMatchingVersion(),
    state: "PENDING RESTART", serverName: "db", guardTool: "write", receiptsDir: receiptDir,
  }));
  const result = run(["status"], root, "", project);
  assert.equal(result.code, 0);
  assert.match(result.out, /^Runtime: present /m);
  assert.match(result.out, /^Receipts: 0 stored in .* \(directory does not exist\)$/m);
  assert.match(result.out, /^Most recent: no receipt yet \(receipt directory is missing\)$/m);
});

test("status names an unreadable receipt directory and its permission action", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-unreadable-dir-"));
  const project = path.join(root, "project");
  const dataHome = path.join(root, ".local", "share");
  const receiptDir = path.join(dataHome, "seal", "projects", "unreadable-receipts", "receipts");
  const { statePathFor } = require("../spine/protection.cjs");
  fs.mkdirSync(project);
  fs.mkdirSync(receiptDir, { recursive: true });
  const statePath = statePathFor(project, { XDG_DATA_HOME: dataHome });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({
    schema: "seal.protect/v1", sealVersion: require("../spine/version.cjs").requireMatchingVersion(),
    state: "PENDING RESTART", serverName: "db", guardTool: "write", receiptsDir: receiptDir,
  }));
  fs.chmodSync(receiptDir, 0o000);
  const result = run(["status"], root, "", project);
  assert.equal(result.code, 0);
  assert.match(result.out, /^Receipts: unavailable in .* \(directory cannot be read\)$/m);
  assert.match(result.out, /^Most recent: receipts may exist, but the receipt directory cannot be read; check its permissions$/m);
  fs.chmodSync(receiptDir, 0o700);
});

test("status names receipt files when none can be parsed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-no-parseable-"));
  const project = path.join(root, "project");
  const dataHome = path.join(root, ".local", "share");
  const receiptDir = path.join(dataHome, "seal", "projects", "unparseable-receipts", "receipts");
  const { statePathFor } = require("../spine/protection.cjs");
  fs.mkdirSync(project);
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(path.join(receiptDir, "not-a-receipt.json"), "not json\n");
  const statePath = statePathFor(project, { XDG_DATA_HOME: dataHome });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({
    schema: "seal.protect/v1", sealVersion: require("../spine/version.cjs").requireMatchingVersion(),
    state: "PENDING RESTART", serverName: "db", guardTool: "write", receiptsDir: receiptDir,
  }));
  const result = run(["status"], root, "", project);
  assert.equal(result.code, 0);
  assert.match(result.out, /^Receipt unreadable: not-a-receipt\.json \(Unexpected token/m);
  assert.match(result.out, /^Most recent: receipt files exist, but none could be read as a receipt$/m);
});

test("status prefers the verified shipped runtime over a corrupt cache", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-hash-mismatch-"));
  const staged = path.join(root, ".cache", "seal", "runtime", manifest.commit, "kernel", "wasm", "seal.js");
  fs.mkdirSync(path.dirname(staged), { recursive: true });
  fs.writeFileSync(staged, "one corrupt staged byte\n");
  const result = run(["status"], root);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, new RegExp(`^Runtime: present seal-assurance-kit@${manifest.commit}$`, "m"));
  assert.doesNotMatch(result.out, /^Runtime: integrity check failed /m);
});

const { writeKernelReceipt } = require("../test-support/kernel-receipt.cjs");

// Demo receipts are deliberately self-contained: they are fabricated and the
// signing key is temporary. Status must therefore continue to report the
// user's durable store as empty after a demo run.
test("END TO END: seal demo leaves status's durable receipt store untouched", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-e2e-"));
  const demo = run(["demo"], root, "y\n");
  assert.equal(demo.code, 0, demo.out);

  const receiptPaths = [...demo.out.matchAll(/^receipt written: (.+)$/gm)].map((m) => m[1]);
  assert.equal(receiptPaths.length, 3, demo.out);
  for (const receiptPath of receiptPaths) assert.match(receiptPath, /\/seal-demo-[^/]+\/receipts\//);

  const receiptDir = path.join(root, ".local", "share", "seal", "receipts");
  assert.ok(!fs.existsSync(receiptDir), `demo must not create ${receiptDir}`);

  const result = run(["status"], root);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /^Receipts: unavailable outside a protected project$/m);
  assert.match(result.out, /^Most recent: no project receipt directory is recorded$/m);
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
