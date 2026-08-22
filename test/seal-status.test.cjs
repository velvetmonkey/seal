const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const CLI = path.join(__dirname, "../bin/seal");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../runtime-manifest.json"), "utf8"));
const { processStartWitness, projectId } = require("../spine/protection.cjs");
const { requireMatchingVersion } = require("../spine/version.cjs");

function writeOwnedState(root, project, statePath, fields) {
  const projectRoot = fs.realpathSync(project);
  const definition = { type: "stdio", command: "/seal", args: ["__proxy", "--protect-state", statePath], env: {} };
  fs.writeFileSync(path.join(root, ".claude.json"), JSON.stringify({
    projects: { [projectRoot]: { mcpServers: { db: definition } } },
  }, null, 2) + "\n");
  fs.writeFileSync(statePath, JSON.stringify({
    schema: "seal.protect/v1",
    sealVersion: requireMatchingVersion(),
    projectRoot,
    projectId: projectId(projectRoot),
    serverName: "db",
    localOverride: {
      installed: true,
      scope: "local",
      serverName: "db",
      projectRoot,
      projectId: projectId(projectRoot),
      definition,
    },
    ...fields,
  }));
}

function run(args, root, input = "", cwd = process.cwd(), extraEnv = {}) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, HOME: root, XDG_DATA_HOME: path.join(root, ".local", "share"), SEAL_CACHE_DIR: path.join(root, ".cache", "seal"), ...extraEnv },
      input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }) };
  } catch (error) { return { code: error.status, out: `${error.stdout || ""}${error.stderr || ""}` }; }
}

function protectedStatusPrefix(statePath) {
  return `Runtime: present seal-assurance-kit@${manifest.commit}\n` +
    `Protection: PENDING RESTART db.write (${statePath})\n` +
    "Next:\n" +
    "  1. Restart Claude Code in this project.\n" +
    "  2. Run `seal status`.\n" +
    "  3. Look for `Protection: ACTIVE`.\n" +
    "Undo:\n" +
    "  Stop Claude Code, then run `seal unprotect db`.\n";
}

test("status finds the shipped kernel runtime with an empty cache", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-shipped-runtime-"));
  const result = run(["status"], root);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, new RegExp(`^Runtime: present seal-assurance-kit@${manifest.commit}$`, "m"));
  assert.ok(!fs.existsSync(path.join(root, ".cache", "seal", "runtime")), "status must not create a cache as a side effect");
});

test("status reports ACTIVE and STALE from observable lease facts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-lease-states-"));
  const project = path.join(root, "project");
  const dataHome = path.join(root, ".local", "share");
  const { statePathFor } = require("../spine/protection.cjs");
  fs.mkdirSync(project);
  const statePath = statePathFor(project, { XDG_DATA_HOME: dataHome });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const liveLease = { pid: process.pid, startWitness: processStartWitness(process.pid), generation: 3 };

  writeOwnedState(root, project, statePath, { state: "ACTIVE", guardTool: "write", receiptsDir: path.dirname(statePath), lease: liveLease });
  let result = run(["status"], root, "", project);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /^Protection: ACTIVE db\.write /m);
  assert.match(result.out, /^Protection lease: pid \d+ generation 3$/m);

  writeOwnedState(root, project, statePath, { state: "ACTIVE", guardTool: "write", receiptsDir: path.dirname(statePath), lease: { pid: 999999, startWitness: "dead", generation: 4 } });
  result = run(["status"], root, "", project);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /^Protection: STALE db\.write /m);

});

test("status refuses an unsupported host before a null-witness lease liveness comparison", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-non-linux-"));
  const project = path.join(root, "project");
  const dataHome = path.join(root, ".local", "share");
  const { statePathFor } = require("../spine/protection.cjs");
  fs.mkdirSync(project);
  const statePath = statePathFor(project, { XDG_DATA_HOME: dataHome });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  writeOwnedState(root, project, statePath, {
    state: "ACTIVE",
    guardTool: "write",
    receiptsDir: path.dirname(statePath),
    // On the simulated host processStartWitness returns null. Without bin/seal's
    // status gate, this live PID and null === null would be reported ACTIVE.
    lease: { pid: process.pid, startWitness: null, generation: 5 },
  });

  const result = run(["status"], root, "", project, {
    SEAL_SPINE_PLATFORM: "plan9",
    SEAL_SPINE_ARCH: "mips",
  });
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /^UNSUPPORTED PLATFORM$/m);
  assert.match(result.out, /^REFUSE unsupported_platform: this is plan9-mips$/m);
  assert.doesNotMatch(result.out, /^Protection: (?:ACTIVE|STALE) /m);
  assert.doesNotMatch(result.out, /^Protection lease:/m);
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
  writeOwnedState(root, project, statePath, {
    state: "PENDING RESTART", guardTool: "write", receiptsDir: receiptDir,
  });

  const result = run(["status"], root, "", project);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, new RegExp(`^Receipts: 1 stored in ${receiptDir}$`, "m"));
  assert.match(result.out, /^Most recent \(by write time\): APPROVE at receipt time 2026-08-16T12:00:00\.000Z \(approved\.json\)$/m);
});

test("status says an existing empty receipt directory has no recorded decision", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-existing-empty-"));
  const project = path.join(root, "project");
  const dataHome = path.join(root, ".local", "share");
  const receiptDir = path.join(dataHome, "seal", "projects", "empty-receipts", "receipts");
  const { statePathFor } = require("../spine/protection.cjs");
  fs.mkdirSync(project);
  fs.mkdirSync(receiptDir, { recursive: true });
  const statePath = statePathFor(project, { XDG_DATA_HOME: dataHome });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  writeOwnedState(root, project, statePath, {
    state: "PENDING RESTART", guardTool: "write", receiptsDir: receiptDir,
  });

  const result = run(["status"], root, "", project);
  assert.equal(result.code, 0, result.out);
  assert.equal(result.out, protectedStatusPrefix(statePath) +
    `Receipts: 0 stored in ${receiptDir}\n` +
    "Most recent: no receipt yet (receipt directory has no files; no decision has been recorded)\n");
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
  writeOwnedState(root, project, statePath, {
    state: "PENDING RESTART", guardTool: "write", receiptsDir: receiptDir,
  });
  const result = run(["status"], root, "", project);
  assert.equal(result.code, 0, result.out);
  assert.equal(result.out, protectedStatusPrefix(statePath) +
    `Receipts: 0 stored in ${receiptDir} (directory does not exist)\n` +
    "Most recent: no receipt yet (receipt directory is missing)\n");
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
  writeOwnedState(root, project, statePath, {
    state: "PENDING RESTART", guardTool: "write", receiptsDir: receiptDir,
  });
  fs.chmodSync(receiptDir, 0o000);
  const result = run(["status"], root, "", project);
  fs.chmodSync(receiptDir, 0o700);
  assert.equal(result.code, 0, result.out);
  assert.equal(result.out, protectedStatusPrefix(statePath) +
    `Receipts: unavailable in ${receiptDir} (directory cannot be read)\n` +
    "Most recent: receipts may exist, but the receipt directory cannot be read; check its permissions\n");
});

test("status names a receipt path that is not a directory as misconfigured", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-receipts-file-"));
  const project = path.join(root, "project");
  const dataHome = path.join(root, ".local", "share");
  const receiptDir = path.join(dataHome, "seal", "projects", "receipts-file", "receipts");
  const { statePathFor } = require("../spine/protection.cjs");
  fs.mkdirSync(project);
  fs.mkdirSync(path.dirname(receiptDir), { recursive: true });
  fs.writeFileSync(receiptDir, "not a directory\n");
  const statePath = statePathFor(project, { XDG_DATA_HOME: dataHome });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  writeOwnedState(root, project, statePath, {
    state: "PENDING RESTART", guardTool: "write", receiptsDir: receiptDir,
  });

  const result = run(["status"], root, "", project);
  assert.equal(result.code, 0, result.out);
  assert.equal(result.out, protectedStatusPrefix(statePath) +
    `Receipts: unavailable in ${receiptDir} (path is not a directory)\n` +
    "Most recent: receipts cannot be stored because the receipt path is not a directory; check its configuration\n");
});

test("status names receipt files when none can be parsed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-status-no-parseable-"));
  const project = path.join(root, "project");
  const dataHome = path.join(root, ".local", "share");
  const receiptDir = path.join(dataHome, "seal", "projects", "unparseable-receipts", "receipts");
  const { statePathFor } = require("../spine/protection.cjs");
  fs.mkdirSync(project);
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(path.join(receiptDir, "not-a-receipt.json"), "{}\n");
  const statePath = statePathFor(project, { XDG_DATA_HOME: dataHome });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  writeOwnedState(root, project, statePath, {
    state: "PENDING RESTART", guardTool: "write", receiptsDir: receiptDir,
  });
  const result = run(["status"], root, "", project);
  assert.equal(result.code, 0, result.out);
  assert.equal(result.out, protectedStatusPrefix(statePath) +
    `Receipts: 1 stored in ${receiptDir}\n` +
    "Receipt unreadable: not-a-receipt.json (missing decision or receipt time)\n" +
    "Most recent: receipt files exist, but none could be read as a receipt\n");
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
