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

function withoutReachabilityObservation(output) {
  return output.replace(/^Observation project:[\s\S]*?^Boundary: shell and network routes are outside this Seal MCP wrapper; their effective reachability is UNKNOWN\.\n/m, "");
}

function protectedStatusPrefix(statePath) {
  return `Runtime at status check: kernel payload bytes matched runtime-manifest.json for seal-assurance-kit@${manifest.commit}; per-authorization installed-tree and Node-floor judgments have not yet been observed.\n` +
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
  return `Runtime at status check: kernel payload bytes matched runtime-manifest.json for seal-assurance-kit@${manifest.commit}; per-authorization installed-tree and Node-floor judgments have not yet been observed.\n` +
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
  assert.match(result.out, new RegExp(`^Runtime at status check: kernel payload bytes matched runtime-manifest.json for seal-assurance-kit@${manifest.commit}; per-authorization installed-tree and Node-floor judgments have not yet been observed.$`, "m"));
  assert.ok(!fs.existsSync(path.join(root, ".cache", "seal", "runtime")), "status must not create a cache as a side effect");
});

test("status always labels observed scope context and incomplete boundaries", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-observation-"));
  const result = run(["status"], root);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /^Observation client: Claude Code static configuration; effective client route UNKNOWN$/m);
  assert.match(result.out, /^Scopes inspected: user, local, project .*not a complete active inventory\)$/m);
  assert.match(result.out, /^UNKNOWN — Client route completeness has not been established: Seal cannot confirm this session's effective MCP, shell or network access\.$/m);
  assert.match(result.out, /^Boundary: shell and network routes are outside this Seal MCP wrapper; their effective reachability is UNKNOWN\.$/m);
});

test("status exposes duplicate MCP definitions without choosing a winner", (t) => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-duplicates-"));
  const project = path.join(root, "project");
  fs.mkdirSync(project);
  execFileSync("git", ["init", "--quiet", project]);
  const projectRoot = fs.realpathSync(project);
  const projectFile = path.join(project, ".mcp.json");
  const userFile = path.join(root, ".claude.json");
  const cleanProject = '{"mcpServers":{"same":{"command":"first"}}}';
  const cleanUser = JSON.stringify({ mcpServers: {}, projects: { [projectRoot]: { mcpServers: {} } } });
  const observe = (label) => {
    const result = run(["status"], root, "", project, { CLAUDE_CONFIG_DIR: root });
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /^UNKNOWN — Client route completeness has not been established:/m);
    assert.match(result.out, /^Scopes inspected: user, local, project /m);
    t.diagnostic(`${label}: exit ${result.code}\n${result.out}`);
    return result.out;
  };
  const reset = () => { fs.writeFileSync(userFile, cleanUser); fs.writeFileSync(projectFile, cleanProject); };
  const ambiguous = (label, file, text, scope, key) => {
    reset();
    fs.writeFileSync(file, text);
    const out = observe(label);
    assert.ok(out.includes(`UNKNOWN — ${scope} MCP configuration source has ambiguous definitions of duplicate keys ${JSON.stringify(key)}; client selection is UNKNOWN: ${file}`), out);
    assert.doesNotMatch(out, new RegExp(`Inspected ${scope} MCP entry`));
    return out;
  };
  ambiguous("pair", projectFile, '{"mcpServers":{"same":{"command":"first"},"same":{"command":"second"}}}', "project", "same");
  ambiguous("triple", projectFile, '{"mcpServers":{"same":1,"same":2,"same":3}}', "project", "same");
  ambiguous("identical", projectFile, '{"mcpServers":{"same":{"command":"first"},"same":{"command":"first"}}}', "project", "same");
  ambiguous("user", userFile, '{"mcpServers":{"same":1,"same":2}}', "user", "same");
  ambiguous("local", userFile, `{"projects":{${JSON.stringify(projectRoot)}:{"mcpServers":{"same":1,"same":2}}}}`, "local", "same");
  ambiguous("escaped key", projectFile, '{"mcpServers":{"same":1,"s\\u0061me":2}}', "project", "same");
  ambiguous("duplicate container", projectFile, '{"mcpServers":{},"mcpServers":{"same":2}}', "project", "mcpServers");
  ambiguous("duplicate definition field", projectFile, '{"mcpServers":{"same":{"command":"first","command":"second"}}}', "project", "command");
  ambiguous("duplicate project selector", userFile, `{"projects":{${JSON.stringify(projectRoot)}:{},${JSON.stringify(projectRoot)}:{"mcpServers":{"same":2}}}}`, "local", projectRoot);
  ambiguous("duplicate projects container", userFile, '{"projects":{},"projects":{}}', "local", "projects");
  reset();
  const clean = observe("clean after repair");
  assert.doesNotMatch(clean, /ambiguous/);
  assert.match(clean, /UNBROKERED — Inspected project MCP entry "same"/);
  for (const value of ["null", "[]", "42", '"text"', "true"]) {
    fs.writeFileSync(projectFile, value);
    assert.match(observe(`non-object ${value}`), /top-level value is not an object/);
  }
  reset();
  fs.writeFileSync(projectFile, '{"metadata":{"same":1,"same":2,"mcpServers":{"x":1,"x":2}},"mcpServers":{"same":{"command":"first"}}}');
  assert.equal(observe("unrelated duplicates").replace(/^Observation time:.*$/m, ""), clean.replace(/^Observation time:.*$/m, ""));
  fs.writeFileSync(userFile, '{"projects":{"other":{"mcpServers":{"x":1,"x":2}}},"mcpServers":{}}');
  assert.doesNotMatch(observe("other project duplicates"), /ambiguous/);
  reset();
  const large = '{"metadata":"' + "x".repeat(8 * 1024 * 1024) + '","deep":' + "[".repeat(20000) + "0" + "]".repeat(20000) + ',"mcpServers":{"same":1,"same":2}}';
  const start = performance.now();
  ambiguous("large and deep", projectFile, large, "project", "same");
  t.diagnostic(`large bytes ${Buffer.byteLength(large)}, elapsed ms ${performance.now() - start}`);
  reset();
  fs.unlinkSync(projectFile);
  assert.match(observe("missing"), /project MCP configuration source is missing/);
  fs.writeFileSync(projectFile, "{");
  assert.match(observe("malformed"), /project MCP configuration source cannot be read or is malformed/);
  fs.writeFileSync(projectFile, cleanProject);
  fs.chmodSync(projectFile, 0);
  try { assert.match(observe("unreadable"), /EACCES/); }
  finally { fs.chmodSync(projectFile, 0o600); }
  const { statePathFor } = require("../spine/protection.cjs");
  const statePath = statePathFor(project, { XDG_DATA_HOME: path.join(root, ".local", "share") });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  writeOwnedState(root, project, statePath, { state: "PENDING RESTART", guardTool: "write", receiptsDir: path.dirname(statePath) });
  const owned = fs.readFileSync(userFile, "utf8");
  fs.writeFileSync(userFile, owned.replace('"mcpServers": {', '"mcpServers": {}, "mcpServers": {'));
  assert.match(observe("owned ambiguous"), /source has ambiguous definitions/);
  fs.writeFileSync(userFile, owned);
  const repaired = observe("owned repaired");
  assert.doesNotMatch(repaired, /ambiguous/);
  assert.match(repaired, /BROKERED — Local MCP entry "db" matches Seal's installed wrapper; this wrapper gates write\./);
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
  assert.match(result.out, /^Sealed MCP route db: LEASE ACTIVE /m);
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
  assert.doesNotMatch(result.out, /^Sealed MCP route .*: (?:(?:LEASE )?ACTIVE|STALE) /m);
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
  assert.equal(withoutReachabilityObservation(result.out), protectedStatusPrefix(statePath) +
    `Receipts: 1 receipt files observed in ${receiptDir}; run \`seal receipts ${receiptDir}\` to inspect sequence gaps; completeness UNKNOWN (receipt filenames are not signed)\n` +
    "Most recent (by write time): APPROVE at receipt time 1786896000 (receipt-1786896000000-123-0001-APPROVE.json)\n");
});

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
  assert.equal(withoutReachabilityObservation(result.out), brokenStatusWithReceipt("stored protection state has no protected tool list", receiptDir, statePath));
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
  assert.equal(withoutReachabilityObservation(result.out), protectedStatusPrefix(statePath) +
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
  assert.equal(withoutReachabilityObservation(result.out), protectedStatusPrefix(statePath) +
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
  assert.equal(withoutReachabilityObservation(result.out), protectedStatusPrefix(statePath) +
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
  assert.equal(withoutReachabilityObservation(result.out), protectedStatusPrefix(statePath) +
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
  assert.equal(withoutReachabilityObservation(result.out), protectedStatusPrefix(statePath) +
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
  assert.match(result.out, new RegExp(`^Runtime at status check: kernel payload bytes matched runtime-manifest.json for seal-assurance-kit@${manifest.commit}; per-authorization installed-tree and Node-floor judgments have not yet been observed.$`, "m"));
  assert.doesNotMatch(result.out, /^Runtime at status check FAIL: integrity check failed /m);
});

const { writeKernelReceipt } = require("../test-support/kernel-receipt.cjs");

// Demo receipts are deliberately self-contained: they are fabricated and the
// signing key is temporary. Status must therefore continue to report the
// user's durable store as empty after a demo run.
test("END TO END: seal demo leaves status's durable receipt store untouched", () => {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-e2e-"));
  const demo = run(["demo", "--dir", path.join(root, "seal-demo-status")], root, "y\n");
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
  assert.match(result.out, /^Runtime at status check: kernel payload bytes matched runtime-manifest.json for seal-assurance-kit@/m);
});

function scopeOwnershipCase() {
  const root = testTmpdir(path.join(os.tmpdir(), "seal-status-scope-ownership-"));
  const project = path.join(root, "project");
  fs.mkdirSync(project);
  execFileSync("git", ["init", "--quiet", project]);
  const child = path.join(project, "src");
  const outside = path.join(root, "outside");
  const linked = path.join(root, "linked");
  fs.mkdirSync(child);
  fs.mkdirSync(outside);
  fs.symlinkSync(project, linked, "dir");
  const env = { XDG_DATA_HOME: path.join(root, ".local", "share"), CLAUDE_CONFIG_DIR: root };
  const statePath = require("../spine/protection.cjs").statePathFor(project, env, "db");
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  writeOwnedState(root, project, statePath, { state: "PENDING RESTART", guardTool: "write" });
  const configPath = path.join(root, ".claude.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const definition = config.projects[fs.realpathSync(project)].mcpServers.db;
  const save = () => fs.writeFileSync(configPath, JSON.stringify(config));
  const observe = (t, label, cwd = project) => {
    const result = run(["status"], root, "", cwd, env);
    t.diagnostic(`${label}: exit ${result.code}\n${result.out}`);
    return result.out;
  };
  return { root, project, child, outside, linked, statePath, config, definition, save, observe };
}

test("status resolves wrapper ownership from every project directory", (t) => {
  const c = scopeOwnershipCase();
  for (const [label, cwd] of [["root", c.project], ["child", c.child], ["symlink", c.linked]]) {
    assert.match(c.observe(t, label, cwd), /  BROKERED — Local MCP entry "db" matches Seal's installed wrapper/);
  }
  fs.writeFileSync(path.join(c.outside, ".mcp.json"), JSON.stringify({ mcpServers: { plain: { command: "ordinary-server" } } }));
  assert.match(c.observe(t, "outside", c.outside), /  UNBROKERED — Inspected project MCP entry "plain" is configured without Seal/);
});

test("status compares object keys canonically in ownership and scope conflicts", (t) => {
  const c = scopeOwnershipCase();
  c.config.projects[fs.realpathSync(c.project)].mcpServers.db = {
    env: c.definition.env, args: c.definition.args, command: c.definition.command, type: c.definition.type,
  };
  c.save();
  fs.writeFileSync(path.join(c.project, ".mcp.json"), JSON.stringify({ mcpServers: { db: c.definition } }));
  const reordered = c.observe(t, "keys reordered");
  assert.match(reordered, /  BROKERED — Local MCP entry "db" matches Seal's installed wrapper/);
  assert.doesNotMatch(reordered, /has conflicting definitions/);
  c.config.projects[fs.realpathSync(c.project)].mcpServers.db.args = [...c.definition.args].reverse();
  c.save();
  const array = c.observe(t, "array reordered");
  assert.match(array, /has conflicting definitions/);
  assert.match(array, /UNKNOWN — installed wrapper "db".*local definition does not match the installed wrapper/);
  assert.doesNotMatch(array, /  BROKERED —/);
});


test("status refuses uncertain ownership and different wrappers", (t) => {
  const c = scopeOwnershipCase();
  const original = fs.readFileSync(c.statePath, "utf8");
  const uncertain = (label, pattern) => {
    const output = c.observe(t, label, c.child);
    assert.match(output, pattern);
    assert.doesNotMatch(output, /  (?:UNBROKERED|BROKERED) —/);
  };
  c.definition.command = "/different/seal";
  c.save();
  uncertain("different wrapper", /UNKNOWN — installed wrapper "db".*local definition does not match the installed wrapper/);
  c.definition.command = "/seal";
  c.save();
  fs.renameSync(c.statePath, `${c.statePath}.saved`);
  uncertain("missing record", /UNKNOWN — installed wrapper "db".*protection record is unavailable/);
  fs.writeFileSync(c.statePath, "{");
  uncertain("unreadable record", /UNKNOWN — installed wrapper "db".*stored protection state is unreadable/);
  const state = JSON.parse(original);
  state.localOverride.installed = false;
  fs.writeFileSync(c.statePath, JSON.stringify(state));
  uncertain("ownership not installed", /UNKNOWN — installed wrapper "db"/);
  state.localOverride.installed = true;
  state.projectRoot = c.outside;
  fs.writeFileSync(c.statePath, JSON.stringify(state));
  uncertain("wrong project scope", /UNKNOWN — installed wrapper "db".*project scope does not match/);
  fs.writeFileSync(c.statePath, original);
  c.config.projects[fs.realpathSync(c.project)].mcpServers.plain = { command: "ordinary-server", args: [] };
  c.save();
  const restored = c.observe(t, "restored and truly unowned");
  assert.match(restored, /  BROKERED — Local MCP entry "db"/);
  assert.match(restored, /  UNBROKERED — Inspected local MCP entry "plain"/);
});

test("status follows a wrapper installed from a child into its Claude project scope", (t) => {
  const c = scopeOwnershipCase();
  const state = JSON.parse(fs.readFileSync(c.statePath, "utf8"));
  const childState = require("../spine/protection.cjs").statePathFor(c.child, { XDG_DATA_HOME: path.join(c.root, ".local", "share") }, "db");
  state.projectRoot = c.child;
  state.projectId = projectId(c.child);
  Object.assign(state.localOverride, { projectRoot: c.child, projectId: projectId(c.child), claudeProjectRoot: c.project });
  state.localOverride.definition.args[2] = childState;
  c.definition.args[2] = childState;
  c.save();
  fs.mkdirSync(path.dirname(childState), { recursive: true });
  fs.writeFileSync(childState, JSON.stringify(state));
  fs.unlinkSync(c.statePath);
  for (const [label, cwd] of [["child installation from root", c.project], ["child installation from child", c.child], ["child installation from symlink", c.linked]]) {
    assert.match(c.observe(t, label, cwd), /  BROKERED — Local MCP entry "db"/);
  }
});
