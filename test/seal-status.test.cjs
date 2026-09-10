const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

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
    `Sealed MCP route db: PENDING RESTART (${statePath})\n` +
    "\n" +
    "Gated through this route:\n" +
    "  write\n" +
    "\n" +
    "Not controlled:\n" +
    "  Bash and subprocesses outside this MCP route\n" +
    "  direct resource access outside this MCP route\n" +
    "  other clients\n" +
    "  other MCP servers not routed through this Seal wrapper\n" +
    "  other uncontrolled routes can also exist\n" +
    "Next:\n" +
    "  1. Restart Claude Code in this project.\n" +
    "  2. Run `seal status`.\n" +
    "  3. Expect ACTIVE while Claude Code runs this project's wrapper; STALE after the session exits.\n" +
    "Undo:\n" +
    "  To clear protection for every guarded tool on server db, including guarded tools: write, stop Claude Code, then run `seal unprotect db`.\n";
}

function brokenStatusWithReceipt(detail, receiptDir, statePath) {
  return `Runtime: present seal-assurance-kit@${manifest.commit}\n` +
    `Sealed MCP route db: PENDING RESTART (${statePath})\n` +
    "\n" +
    "Gated through this route:\n" +
    "  unknown: stored protection state has no protected tool list\n" +
    "\n" +
    "Not controlled:\n" +
    "  Bash and subprocesses outside this MCP route\n" +
    "  direct resource access outside this MCP route\n" +
    "  other clients\n" +
    "  other MCP servers not routed through this Seal wrapper\n" +
    "  other uncontrolled routes can also exist\n" +
    `Protection detail: ${detail}\n` +
    `Receipts: 1 receipt files observed in ${receiptDir}; run \`seal receipts ${receiptDir}\` to inspect sequence gaps; completeness UNKNOWN (receipt filenames are not signed)\n` +
    "Most recent (by write time): APPROVE at receipt time 1786896000 (receipt-1786896000000-123-0001-APPROVE.json)\n";
}

test("status finds the shipped kernel runtime with an empty cache", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-shipped-runtime-"));
  const result = run(["status"], root);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, new RegExp(`^Runtime: present seal-assurance-kit@${manifest.commit}$`, "m"));
  assert.ok(!fs.existsSync(path.join(root, ".cache", "seal", "runtime")), "status must not create a cache as a side effect");
});

test("status reports ACTIVE and STALE from observable lease facts", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-lease-states-"));
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
  assert.match(result.out, /^Sealed MCP route db: ACTIVE /m);
  assert.match(result.out, /^  write$/m);
  assert.match(result.out, /^Not controlled:$/m);
  assert.match(result.out, /^Protection lease: pid \d+ generation 3$/m);

  writeOwnedState(root, project, statePath, { state: "ACTIVE", guardTool: "write", receiptsDir: path.dirname(statePath), lease: { pid: 999999, startWitness: "dead", generation: 4 } });
  result = run(["status"], root, "", project);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /^Sealed MCP route db: STALE /m);

});

test("status refuses an unsupported host before a null-witness lease liveness comparison", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-non-linux-"));
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
  assert.doesNotMatch(result.out, /^Sealed MCP route .*: (?:ACTIVE|STALE) /m);
  assert.doesNotMatch(result.out, /^Protection lease:/m);
});

test("status reads the protected project's recorded receipt directory", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-project-receipts-"));
  const project = path.join(root, "project");
  const dataHome = path.join(root, ".local", "share");
  const receiptDir = path.join(dataHome, "seal", "projects", "recorded-project", "receipts");
  const { statePathFor } = require("../spine/protection.cjs");
  fs.mkdirSync(project);
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(path.join(receiptDir, "receipt-1786896000000-123-0001-APPROVE.json"), JSON.stringify({ seal_receipt: "v2", action: "APPROVE", verdict: "ALLOW", now: 1786896000 }));
  const statePath = statePathFor(project, { XDG_DATA_HOME: dataHome });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  writeOwnedState(root, project, statePath, {
    state: "PENDING RESTART", guardTool: "write", receiptsDir: receiptDir,
  });

  const result = run(["status"], root, "", project);
  assert.equal(result.code, 0, result.out);
  assert.equal(result.out, protectedStatusPrefix(statePath) +
    `Receipts: 1 receipt files observed in ${receiptDir}; run \`seal receipts ${receiptDir}\` to inspect sequence gaps; completeness UNKNOWN (receipt filenames are not signed)\n` +
    "Most recent (by write time): APPROVE at receipt time 1786896000 (receipt-1786896000000-123-0001-APPROVE.json)\n");
});

test("status latest receipt uses the counted validated filename population", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-latest-population-"));
  const project = path.join(root, "project");
  const dataHome = path.join(root, ".local", "share");
  const receiptDir = path.join(root, "receipts");
  const { statePathFor } = require("../spine/protection.cjs");
  fs.mkdirSync(project);
  fs.mkdirSync(receiptDir);
  const statePath = statePathFor(project, { XDG_DATA_HOME: dataHome });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  writeOwnedState(root, project, statePath, {
    state: "PENDING RESTART", guardTool: "write", receiptsDir: receiptDir,
  });
  const name = "receipt-1786896000000-123-0001-BLOCK.json";
  fs.writeFileSync(path.join(receiptDir, name), JSON.stringify({ seal_receipt: "v2", verdict: "BLOCK", now: 200 }));
  fs.utimesSync(path.join(receiptDir, name), 100, 100);
  for (const ignored of ["backup.json", "receipt-01-123-0002-ALLOW.json", "receipt-9007199254740992-123-0003-ALLOW.json"]) {
    fs.writeFileSync(path.join(receiptDir, ignored), JSON.stringify({ seal_receipt: "v2", verdict: "ALLOW", now: 100 }));
    fs.utimesSync(path.join(receiptDir, ignored), 200, 200);
    const result = run(["status"], root, "", project);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /^Receipts: 1 receipt files observed /m);
    assert.match(result.out, /^Most recent \(by write time\): BLOCK at receipt time 200 \(receipt-1786896000000-123-0001-BLOCK.json\)$/m);
    assert.doesNotMatch(result.out, /^Receipt unreadable:/m);
    const census = run(["receipts", receiptDir], root, "", project);
    assert.match(census.out, /^Receipt files observed: 1 /m);
  }
});

for (const kind of ["symlink", "unreadable", "invalid JSON"]) {
  test(`status accounts for a ${kind} receipt in its validated population`, (t) => {
    const root = testTmpdir(path.join(os.tmpdir(), "seal-status-edge-"));
    const project = path.join(root, "project");
    const dataHome = path.join(root, ".local", "share");
    const receiptDir = path.join(root, "receipts");
    const { statePathFor } = require("../spine/protection.cjs");
    fs.mkdirSync(project);
    fs.mkdirSync(receiptDir);
    const statePath = statePathFor(project, { XDG_DATA_HOME: dataHome });
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    writeOwnedState(root, project, statePath, {
      state: "PENDING RESTART", guardTool: "write", receiptsDir: receiptDir,
    });
    const name = "receipt-1786896000000-123-0001-BLOCK.json";
    const target = path.join(receiptDir, name);
    const bytes = JSON.stringify({ seal_receipt: "v2", verdict: "BLOCK", now: 200 });
    if (kind === "symlink") {
      fs.writeFileSync(path.join(root, "linked.json"), bytes);
      fs.symlinkSync(path.join(root, "linked.json"), target);
    } else {
      fs.writeFileSync(target, kind === "invalid JSON" ? "{" : bytes);
      if (kind === "unreadable") fs.chmodSync(target, 0o000);
    }
    try {
      const result = run(["status"], root, "", project);
      assert.equal(result.code, 0, result.out);
      assert.match(result.out, /^Receipts: 1 receipt files observed /m);
      assert.match(run(["receipts", receiptDir], root, "", project).out, /^Receipt files observed: 1 /m);
      if (kind === "symlink") {
        assert.match(result.out, /^Most recent \(by write time\): BLOCK at receipt time 200 /m);
        assert.doesNotMatch(result.out, /^Receipt unreadable:/m);
      } else {
        assert.match(result.out, /^Receipt unreadable: receipt-1786896000000-123-0001-BLOCK.json /m);
        assert.match(result.out, /^Most recent: receipt files exist, but none could be read as a receipt$/m);
        if (kind === "unreadable") assert.match(result.out, /EACCES|unreadable/);
      }
      for (const line of result.out.split("\n").filter((line) => /^(Receipt|Most recent)/.test(line))) t.diagnostic(`${kind}: ${line}`);
    } finally {
      if (kind === "unreadable") fs.chmodSync(target, 0o600);
    }
  });
}

test("status reads a recorded receipt directory when the protection state has no protected tool list", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-broken-tools-readable-receipts-"));
  const project = path.join(root, "project");
  const dataHome = path.join(root, ".local", "share");
  const receiptDir = path.join(dataHome, "seal", "projects", "broken-tools", "receipts");
  const { statePathFor } = require("../spine/protection.cjs");
  fs.mkdirSync(project);
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(path.join(receiptDir, "receipt-1786896000000-123-0001-APPROVE.json"), JSON.stringify({ seal_receipt: "v2", action: "APPROVE", verdict: "ALLOW", now: 1786896000 }));
  const statePath = statePathFor(project, { XDG_DATA_HOME: dataHome });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  writeOwnedState(root, project, statePath, {
    state: "PENDING RESTART", receiptsDir: receiptDir,
  });

  const result = run(["status"], root, "", project);
  assert.equal(result.code, 1, result.out);
  assert.equal(result.out, brokenStatusWithReceipt("stored protection state has no protected tool list", receiptDir, statePath));
});

test("status does not count files from a receipt directory named by refused protection state", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-refused-readable-receipts-"));
  const project = path.join(root, "project");
  const dataHome = path.join(root, ".local", "share");
  const receiptDir = path.join(dataHome, "seal", "projects", "refused-state", "receipts");
  const { statePathFor } = require("../spine/protection.cjs");
  fs.mkdirSync(project);
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(path.join(receiptDir, "operator-notes.txt"), "not a receipt\n");
  fs.writeFileSync(path.join(receiptDir, "staging-payload.dat"), "not a receipt either\n");
  const statePath = statePathFor(project, { XDG_DATA_HOME: dataHome });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  writeOwnedState(root, project, statePath, {
    schema: "seal.protect/v0-not-this",
    state: "PENDING RESTART",
    guardTool: "write",
    receiptsDir: receiptDir,
  });

  const result = run(["status"], root, "", project);
  assert.equal(result.code, 1, result.out);
  assert.doesNotMatch(result.out, new RegExp(`^Receipts: 2 stored in ${receiptDir}$`, "m"));
  assert.match(result.out, /^Receipts: unavailable \(receipt directory could not be resolved from broken protection state\)$/m);
});

test("status does not invent a receipt directory when protection state is unreadable", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-unreadable-state-"));
  const project = path.join(root, "project");
  const dataHome = path.join(root, ".local", "share");
  const { statePathFor } = require("../spine/protection.cjs");
  fs.mkdirSync(project);
  const statePath = statePathFor(project, { XDG_DATA_HOME: dataHome });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, "garbage{");

  const result = run(["status"], root, "", project);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /^Stored protection state: could not be read$/m);
  assert.match(result.out, /^Protection detail: stored protection state is unreadable:/m);
  assert.match(result.out, /^Receipts: unavailable \(receipt directory could not be resolved from broken protection state\)$/m);
  assert.match(result.out, /^Most recent: unavailable because the project receipt directory could not be resolved$/m);
  assert.doesNotMatch(result.out, /undefined|check its permissions/);
});

test("status says an existing empty receipt directory has no recorded decision", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-existing-empty-"));
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
    "Receipts: no receipt files observed (receipt directory has no receipt-shaped files)\n" +
    "Receipt completeness: UNKNOWN (receipt filenames are not signed; deleted receipts can be renumbered)\n" +
    "Most recent: no receipt yet (receipt directory has no receipt-shaped files; no decision has been recorded)\n");
});

test("status names a missing receipt directory as no receipt yet", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-empty-"));
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
    `Receipts: no receipt files observed in ${receiptDir} (directory does not exist)\n` +
    "Most recent: no receipt yet (receipt directory is missing)\n");
});

test("status names an unreadable receipt directory and its permission action", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-unreadable-dir-"));
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
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-receipts-file-"));
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
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-no-parseable-"));
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
    "Receipts: no receipt files observed (1 non-receipt files ignored)\n" +
    "Receipt completeness: UNKNOWN (receipt filenames are not signed; deleted receipts can be renumbered)\n" +
    "Most recent: no receipt yet (receipt directory has no receipt-shaped files; no decision has been recorded)\n");
});

test("receipt reader exposes a removed middle receipt as a sequence gap", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-receipt-gap-"));
  const receipts = path.join(root, "receipts");
  fs.mkdirSync(receipts);
  for (const sequence of [1, 2, 3]) fs.writeFileSync(path.join(receipts, `receipt-1000-77-${String(sequence).padStart(4, "0")}-INDEPENDENT_CASE.json`), "{}\n");
  const original = path.join(receipts, "receipt-1000-77-0002-INDEPENDENT_CASE.json");
  const quarantined = path.join(root, "removed-receipt.json");
  fs.renameSync(original, quarantined);
  let result;
  try { result = execFileSync(process.execPath, [CLI, "receipts", receipts], { encoding: "utf8" }); }
  catch (error) { result = `${error.stdout || ""}${error.stderr || ""}`; }
  assert.match(result, /Receipt gap: pid 77 missing sequences 2 through 2/);
  fs.renameSync(quarantined, original);
  assert.doesNotMatch(execFileSync(process.execPath, [CLI, "receipts", receipts], { encoding: "utf8" }), /Receipt gap:/);
});

test("receipt reader reports multiple gaps in pid and sequence order", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-receipt-multi-gap-"));
  const receipts = path.join(root, "receipts");
  fs.mkdirSync(receipts);
  for (const sequence of [1, 3, 5]) fs.writeFileSync(path.join(receipts, `receipt-1000-77-${String(sequence).padStart(4, "0")}-INDEPENDENT_CASE.json`), "{}\n");
  let result;
  try { result = execFileSync(process.execPath, [CLI, "receipts", receipts], { encoding: "utf8" }); }
  catch (error) { result = `${error.stdout || ""}${error.stderr || ""}`; }
  assert.match(result, /Receipt gap: pid 77 missing sequences 2 through 2\nReceipt gap: pid 77 missing sequences 4 through 4/);
});

test("receipt reader rejects unsafe and non-canonical filename numbers visibly", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-receipt-rejected-numbers-"));
  const receipts = path.join(root, "receipts");
  fs.mkdirSync(receipts);
  const names = [
    "receipt-1.5-77-0001-A.json",
    "receipt-1-77--1-A.json",
    "receipt-1-77-001-A.json",
    "receipt-01-77-0001-A.json",
    "receipt-9007199254740992-77-0001-A.json",
    `receipt-${"9".repeat(100)}-77-0001-A.json`,
  ];
  for (const name of names) fs.writeFileSync(path.join(receipts, name), "{}\n");
  let result;
  try { result = execFileSync(process.execPath, [CLI, "receipts", receipts], { encoding: "utf8" }); }
  catch (error) { result = `${error.stdout || ""}${error.stderr || ""}`; }
  assert.match(result, /Receipt files rejected: 6/);
  for (const name of names) assert.match(result, new RegExp(`Receipt file rejected: ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("status prefers the verified shipped runtime over a corrupt cache", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-hash-mismatch-"));
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
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-e2e-"));
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
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-runtime-"));
  // The helper's job here is only to POPULATE the assurance-kit runtime cache;
  // the kernel receipt it also writes is removed so this test asserts the
  // runtime line, not receipt reading (that is the demo-driven test above).
  const receipt = await writeKernelReceipt(path.join(root, ".cache", "seal"), path.join(root, ".local", "share"));
  fs.rmSync(receipt);
  const result = run(["status"], root);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /^Runtime: present seal-assurance-kit@/m);
});
