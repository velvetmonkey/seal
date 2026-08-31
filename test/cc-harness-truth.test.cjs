// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");
const { createHash } = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const HARNESS = path.join(ROOT, "harness", "claude-code", "cc-harness.cjs");
const SYNTHETIC_CLIENT = path.join(ROOT, "harness", "claude-code", "synthetic-client.cjs");

function buildArtifact(workspace) {
  const out = path.join(workspace, "dist");
  const built = spawnSync(process.execPath, [path.join(ROOT, "scripts", "build-dist.cjs"), "--out", out], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr || built.stdout);
  const metaPath = fs.readdirSync(out).filter((name) => name.endsWith(".meta.json")).map((name) => path.join(out, name))[0];
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  return { path: path.join(out, meta.artifact), sha256: meta.sha256, bytes: String(meta.bytes) };
}

let sharedArtifact = null;
function artifactFixture() {
  if (!sharedArtifact) {
    sharedArtifact = buildArtifact(testTmpdir(
      path.join(os.tmpdir(), "seal-cc-harness-artifact-"),
      { keep: true },
    ));
  }
  return sharedArtifact;
}

function initWithPathClient(workspace, clientBytes) {
  const stubBin = path.join(workspace, "stub-bin");
  fs.mkdirSync(stubBin);
  const client = path.join(stubBin, "claude");
  fs.writeFileSync(client, clientBytes, { mode: 0o755 });
  const artifact = path.join(workspace, "artifact");
  const artifactBytes = Buffer.from("#!/bin/sh\nexit 0\n", "utf8");
  fs.writeFileSync(artifact, artifactBytes, { mode: 0o755 });
  return spawnSync(process.execPath, [HARNESS, "init",
    "--artifact", artifact,
    "--sha256", createHash("sha256").update(artifactBytes).digest("hex"),
    "--bytes", String(artifactBytes.length),
    "--run-dir", path.join(workspace, "run"),
    "--stub-bin", stubBin,
  ], { encoding: "utf8", env: { ...process.env, PATH: `${stubBin}${path.delimiter}/usr/bin${path.delimiter}/bin` } });
}

function initWithStandInClient(workspace, client) {
  const artifact = artifactFixture();
  const stubBin = path.join(workspace, "stub-bin");
  fs.mkdirSync(stubBin);
  fs.copyFileSync(SYNTHETIC_CLIENT, path.join(stubBin, "claude"));
  fs.chmodSync(path.join(stubBin, "claude"), 0o755);
  return spawnSync(process.execPath, [HARNESS, "init",
    "--artifact", artifact.path,
    "--sha256", artifact.sha256,
    "--bytes", artifact.bytes,
    "--run-dir", path.join(workspace, "run"),
    "--stub-bin", stubBin,
    "--synthetic-client",
    "--client-command", client,
  ], { encoding: "utf8" });
}

function syntheticSetup(workspace) {
  const stubBin = path.join(workspace, "stub-bin");
  fs.mkdirSync(stubBin);
  const client = path.join(stubBin, "claude");
  fs.copyFileSync(SYNTHETIC_CLIENT, client);
  fs.chmodSync(client, 0o755);
  return { stubBin, client };
}

function buildClaude(workspace, name, version, versionExit = 0) {
  const source = path.join(workspace, `${name}.c`);
  const executable = path.join(workspace, name);
  fs.writeFileSync(source, [
    "#include <stdio.h>",
    "#include <string.h>",
    `int main(int argc, char **argv) { if (argc == 2 && strcmp(argv[1], \"--version\") == 0) { puts(\"${version}\"); return ${versionExit}; } return 0; }`,
    "",
  ].join("\n"));
  const built = spawnSync("cc", [source, "-o", executable], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr || built.stdout);
  return executable;
}

function pathEnv(...directories) {
  return { ...process.env, PATH: directories.join(path.delimiter) };
}

function initSyntheticRun(workspace) {
  const runDir = path.join(workspace, "run");
  const { stubBin, client } = syntheticSetup(workspace);
  const artifact = artifactFixture();
  const harness = require(HARNESS);
  harness.init([
    "--artifact", artifact.path,
    "--sha256", artifact.sha256,
    "--bytes", artifact.bytes,
    "--run-dir", runDir,
    "--stub-bin", stubBin,
    "--synthetic-client",
    "--client-command", client,
  ]);
  return { harness, runDir };
}

function runSyntheticStep(harness, runDir, scenario, note) {
  process.env.SEAL_CC_SYNTHETIC_CASE = scenario;
  process.env.SEAL_CC_SYNTHETIC_NOTE = note;
  harness.next(harness.loadState(runDir));
}

function completeSyntheticRun(harness, runDir) {
  runSyntheticStep(harness, runDir, "activation", "");
  runSyntheticStep(harness, runDir, "decline", harness.NOTES.decline);
  runSyntheticStep(harness, runDir, "accept", harness.NOTES.accept);
  runSyntheticStep(harness, runDir, "missing_launcher", harness.NOTES.fallback);
  runSyntheticStep(harness, runDir, "none", "");
}

test("a hand-written dialog cast is not evidence from the recorded session", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-forged-cast-"));
  const { harness, runDir } = initSyntheticRun(workspace);

  process.env.SEAL_CC_SYNTHETIC_CASE = "activation";
  process.env.SEAL_CC_SYNTHETIC_NOTE = "";
  harness.next(harness.loadState(runDir));
  process.env.SEAL_CC_SYNTHETIC_CASE = "decline";
  process.env.SEAL_CC_SYNTHETIC_NOTE = "seal-declined-note";
  harness.next(harness.loadState(runDir));

  // Keep the proxy's genuine correlated receipt pair, but replace the cast
  // with a hand-written asciicast containing the expected dialog words.
  const state = harness.loadState(runDir);
  state.step_index = 1;
  state.steps.decline.attempted = true;
  fs.writeFileSync(path.join(runDir, "harness-state.json"), `${JSON.stringify(state, null, 2)}\n`);
  const castPath = path.join(runDir, "logs", "decline.cast");
  const copiedDialogText = fs.readFileSync(castPath, "utf8").trimEnd().split("\n").slice(1)
    .map((line) => JSON.parse(line))
    .filter((event) => Array.isArray(event) && event[1] === "o")
    .map((event) => event[2])
    .join("");
  fs.writeFileSync(castPath, [
    JSON.stringify({ version: 2, width: 80, height: 24, timestamp: 1, env: { TERM: "xterm-256color", SHELL: "/bin/bash" } }),
    JSON.stringify([0.1, "o", copiedDialogText]),
    "",
  ].join("\n"));

  assert.throws(
    () => harness.next(harness.loadState(runDir)),
    (error) => error instanceof harness.HarnessError && error.code === "step_cannot_certify" &&
      /CANNOT CERTIFY decline; decline: decline\.cast must correspond to the recorder output/.test(error.message),
  );
  assert.equal(harness.loadState(runDir).step_index, 1);
});

test("finish refuses before writing when any declared case lacks positive evidence", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-finish-absence-"));
  const { harness, runDir } = initSyntheticRun(workspace);
  const out = path.join(workspace, "out");

  assert.throws(
    () => harness.finish(harness.loadState(runDir), { out }),
    (error) => error instanceof harness.HarnessError && error.code === "finish_cannot_certify" &&
      /CANNOT CERTIFY evidence pack; missing cases: activation/.test(error.message),
  );
  assert.equal(fs.existsSync(out), false, "finish must not write pack bytes before certification");
});

test("decline refuses and does not advance when the human does nothing", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-harness-truth-"));
  const runDir = path.join(workspace, "run");
  const { stubBin, client } = syntheticSetup(workspace);
  const artifact = artifactFixture();
  const harness = require(HARNESS);

  harness.init([
    "--artifact", artifact.path,
    "--sha256", artifact.sha256,
    "--bytes", artifact.bytes,
    "--run-dir", runDir,
    "--stub-bin", stubBin,
    "--synthetic-client",
    "--client-command", client,
  ]);

  process.env.SEAL_CC_SYNTHETIC_CASE = "activation";
  process.env.SEAL_CC_SYNTHETIC_NOTE = "";
  harness.next(harness.loadState(runDir));
  assert.equal(harness.loadState(runDir).step_index, 1);

  // The decline session starts and exits without issuing the protected call.
  // Zero child calls is silence, not evidence that a dialog was refused.
  assert.throws(
    () => harness.next(harness.loadState(runDir)),
    (error) => error instanceof harness.HarnessError && error.code === "step_cannot_certify" &&
      /CANNOT CERTIFY decline; decline: the exact-call INPUT_REQUIRED\/BLOCK receipt pair must be present/.test(error.message),
  );
  assert.equal(harness.loadState(runDir).step_index, 1);
  assert.match(fs.readFileSync(path.join(runDir, "CURRENT-STEP.txt"), "utf8"), /STEP 2 of 6[\s\S]*seal-declined-note/);
  harness.show(harness.loadState(runDir));
  assert.equal(harness.loadState(runDir).step_index, 1);
});

test("activation refuses when the local notes override was not selected or connected", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-activation-silent-"));
  const runDir = path.join(workspace, "run");
  const { stubBin, client } = syntheticSetup(workspace);
  const artifact = artifactFixture();
  const harness = require(HARNESS);
  harness.init([
    "--artifact", artifact.path, "--sha256", artifact.sha256, "--bytes", artifact.bytes,
    "--run-dir", runDir, "--stub-bin", stubBin, "--synthetic-client", "--client-command", client,
  ]);
  const state = harness.loadState(runDir);
  const configPath = path.join(state.paths.home, ".claude.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  delete config.projects[state.paths.project].mcpServers.notes;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  assert.throws(
    () => harness.next(harness.loadState(runDir)),
    (error) => error instanceof harness.HarnessError && error.code === "step_cannot_certify" && /CANNOT CERTIFY activation/.test(error.message),
  );
  assert.equal(harness.loadState(runDir).step_index, 0);
});

test("activation refuses when recorded local_override.entry disagrees with recomputed evidence", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-stale-activation-entry-"));
  const { harness, runDir } = initSyntheticRun(workspace);
  runSyntheticStep(harness, runDir, "activation", "");
  const endPath = path.join(runDir, "snapshots", "activation.end.json");
  const end = JSON.parse(fs.readFileSync(endPath, "utf8"));
  assert.notEqual(end.local_override.entry, null);
  end.local_override.entry = null;
  fs.writeFileSync(endPath, `${JSON.stringify(end, null, 2)}\n`);
  const state = harness.loadState(runDir);
  state.step_index = 0;
  state.steps.activation.attempted = true;
  harness.saveState(state);

  assert.throws(
    () => harness.next(harness.loadState(runDir)),
    (error) => error instanceof harness.HarnessError && error.code === "step_cannot_certify" &&
      /recorded derived field local_override\.entry disagrees with recomputed evidence/.test(error.message),
  );
  assert.equal(harness.loadState(runDir).step_index, 0);
});

test("activation refuses when recorded protection_state.state disagrees with joined raw evidence", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-frozen-activation-state-"));
  const { harness, runDir } = initSyntheticRun(workspace);
  runSyntheticStep(harness, runDir, "activation", "");
  const state = harness.loadState(runDir);
  const endPath = path.join(runDir, "snapshots", "activation.end.json");
  const end = JSON.parse(fs.readFileSync(endPath, "utf8"));
  const changed = JSON.parse(fs.readFileSync(state.paths.protectState, "utf8"));
  changed.state = "IDLE";
  const changedBytes = Buffer.from(`${JSON.stringify(changed, null, 2)}\n`);
  fs.writeFileSync(state.paths.protectState, changedBytes);
  const joined = { present: true, sha256: createHash("sha256").update(changedBytes).digest("hex"), bytes: changedBytes.length };
  end.local_override.protect_state = { ...joined };
  end.protection_state = { ...end.protection_state, ...joined };
  fs.writeFileSync(endPath, `${JSON.stringify(end, null, 2)}\n`);
  state.step_index = 0;
  state.steps.activation.attempted = true;
  harness.saveState(state);

  assert.throws(
    () => harness.next(harness.loadState(runDir)),
    (error) => error instanceof harness.HarnessError && error.code === "step_cannot_certify" &&
      /recorded derived field protection_state\.state disagrees with recomputed evidence/.test(error.message),
  );
  assert.equal(harness.loadState(runDir).step_index, 0);
});

test("A8, A11, and A14 refuse a frozen ACTIVE protection state", () => {
  for (const attack of ["A8", "A11", "A14"]) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `seal-cc-${attack.toLowerCase()}-`));
    const { harness, runDir } = initSyntheticRun(workspace);
    runSyntheticStep(harness, runDir, "activation", "");
    const state = harness.loadState(runDir);
    const endPath = path.join(runDir, "snapshots", "activation.end.json");
    const end = JSON.parse(fs.readFileSync(endPath, "utf8"));
    const original = fs.readFileSync(state.paths.protectState, "utf8");
    const idle = attack === "A11"
      ? original.replace(/"state"\s*:\s*"ACTIVE"/, '"state":"ACTIVE","state":"IDLE"')
      : original.replace(/"state"\s*:\s*"ACTIVE"/, '"state":"IDLE"');
    assert.notEqual(idle, original, `${attack} must change the protected raw bytes`);
    const idleBytes = Buffer.from(idle);
    fs.writeFileSync(state.paths.protectState, idleBytes);
    const joined = { present: true, sha256: createHash("sha256").update(idleBytes).digest("hex"), bytes: idleBytes.length };
    if (attack !== "A14") end.local_override.protect_state = { ...joined };
    if (attack !== "A8") end.protection_state = { ...end.protection_state, ...joined };
    fs.writeFileSync(endPath, `${JSON.stringify(end, null, 2)}\n`);
    state.step_index = 0;
    state.steps.activation.attempted = true;
    harness.saveState(state);

    assert.throws(
      () => harness.next(harness.loadState(runDir)),
      (error) => error instanceof harness.HarnessError && error.code === "step_cannot_certify",
      attack,
    );
    assert.equal(harness.loadState(runDir).step_index, 0, attack);
    assert.equal(JSON.parse(idle).state, "IDLE", `${attack} uses the JSON parser value that its digest covers`);
  }
});

test("activation binds every recorded Claude MCP and child-log value before certification", () => {
  const attacks = [
    ["mcp-wholly-invented", (end) => { end.claude_mcp_get = { code: 0, stdout: "  Scope: Local config (private to you in this project)\\n", stderr: "" }; }],
    ["mcp-real-altered", (end) => { end.claude_mcp_get.stdout += "altered\\n"; }],
    ["mcp-duplicated-scope", (end) => { end.claude_mcp_get.stdout += end.claude_mcp_get.stdout; }],
    ["mcp-nonzero-success", (end) => { end.claude_mcp_get.code = 23; }],
    ["child-appended-fake-start", (end) => { end.child_log.records.push({ kind: "start", ancestry: [] }); end.child_log.lines += 1; }],
    ["child-altered-clientInfo-name", (end) => { end.child_log.records[0].clientInfo = { name: "forged" }; }],
    ["child-duplicated-real-record", (end) => { end.child_log.records.push(structuredClone(end.child_log.records[0])); end.child_log.lines += 1; }],
    ["child-outside-window", (end) => { end.child_log.records.unshift({ kind: "start", ancestry: [] }); end.child_log.lines += 1; }],
  ];
  for (const [name, tamper] of attacks) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `seal-cc-${name}-`));
    const { harness, runDir } = initSyntheticRun(workspace);
    runSyntheticStep(harness, runDir, "activation", "");
    const state = harness.loadState(runDir);
    const endPath = path.join(runDir, "snapshots", "activation.end.json");
    const end = JSON.parse(fs.readFileSync(endPath, "utf8"));
    tamper(end);
    fs.writeFileSync(endPath, `${JSON.stringify(end, null, 2)}\n`);
    state.step_index = 0;
    state.steps.activation.attempted = true;
    harness.saveState(state);
    assert.throws(
      () => harness.next(harness.loadState(runDir)),
      (error) => error instanceof harness.HarnessError && error.code === "step_cannot_certify" &&
        /recorded (Claude MCP result|child log evidence) changed after the snapshot/.test(error.message),
      name,
    );
    assert.equal(harness.loadState(runDir).step_index, 0, name);
  }
});

test("activation refuses when the recorded protection-state raw input changes", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-protect-state-join-"));
  const { harness, runDir } = initSyntheticRun(workspace);
  runSyntheticStep(harness, runDir, "activation", "");
  const state = harness.loadState(runDir);
  const protection = JSON.parse(fs.readFileSync(state.paths.protectState, "utf8"));
  protection.localOverride.claudeProjectRoot = "/changed/project";
  fs.writeFileSync(state.paths.protectState, `${JSON.stringify(protection, null, 2)}\n`);
  state.step_index = 0;
  state.steps.activation.attempted = true;
  harness.saveState(state);

  assert.throws(
    () => harness.next(harness.loadState(runDir)),
    (error) => error instanceof harness.HarnessError && error.code === "step_cannot_certify" && /recorded local override raw input changed/.test(error.message),
  );
  assert.equal(harness.loadState(runDir).step_index, 0);
});

test("local override hashes the one config buffer that it parses", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-one-read-"));
  const home = path.join(workspace, "home");
  const protectState = path.join(workspace, "protect.json");
  const configPath = path.join(home, ".claude.json");
  fs.mkdirSync(home, { recursive: true });
  const expected = { type: "stdio", command: "/installed/seal", args: [], env: {} };
  const falseEntry = { type: "stdio", command: "/false-seal-binary", args: [], env: {} };
  const originalConfig = Buffer.from(JSON.stringify({ projects: { "/recorded/project": { mcpServers: { notes: expected } } } }));
  const falseConfig = Buffer.from(JSON.stringify({ projects: { "/recorded/project": { mcpServers: { notes: falseEntry } } } }));
  const harness = require(HARNESS);
  fs.writeFileSync(configPath, originalConfig);
  fs.writeFileSync(protectState, JSON.stringify({ localOverride: { claudeProjectRoot: "/recorded/project", definition: falseEntry } }));
  const originalRead = fs.readFileSync;
  let configReads = 0;
  fs.readFileSync = function patchedRead(filePath, ...args) {
    if (filePath === configPath) {
      configReads += 1;
      return configReads === 1 ? Buffer.from(falseConfig) : Buffer.from(originalConfig);
    }
    return originalRead.call(this, filePath, ...args);
  };
  try {
    const resolved = harness.readLocalOverride({ paths: { home, project: "/recorded/project", protectState } });
    assert.equal(configReads, 1);
    assert.equal(resolved.entry.command, "/false-seal-binary");
    assert.equal(resolved.sha256, createHash("sha256").update(falseConfig).digest("hex"));
  } finally {
    fs.readFileSync = originalRead;
  }
});

test("missing_launcher certifies recorder facts without stand-in screen text", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-missing-launcher-absence-"));
  const { harness, runDir } = initSyntheticRun(workspace);
  runSyntheticStep(harness, runDir, "activation", "");
  runSyntheticStep(harness, runDir, "decline", harness.NOTES.decline);
  runSyntheticStep(harness, runDir, "accept", harness.NOTES.accept);
  const noOp = path.join(workspace, "no-op-client");
  fs.writeFileSync(noOp, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const state = harness.loadState(runDir);
  state.claude.command = noOp;
  harness.saveState(state);
  harness.next(harness.loadState(runDir));
  assert.equal(harness.loadState(runDir).step_index, 4);
});

test("missing_launcher ignores harness probe lifecycle records but names a fallback child call", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-missing-launcher-lifecycle-"));
  const { harness, runDir } = initSyntheticRun(workspace);
  runSyntheticStep(harness, runDir, "activation", "");
  runSyntheticStep(harness, runDir, "decline", harness.NOTES.decline);
  runSyntheticStep(harness, runDir, "accept", harness.NOTES.accept);
  const noOp = path.join(workspace, "no-op-client");
  fs.writeFileSync(noOp, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const state = harness.loadState(runDir);
  state.claude.command = noOp;
  harness.saveState(state);
  harness.next(harness.loadState(runDir));

  const endPath = path.join(runDir, "snapshots", "missing_launcher.end.json");
  const end = JSON.parse(fs.readFileSync(endPath, "utf8"));
  const installedSeal = path.join(state.paths.store, "bin", "seal");
  const installedSealDigest = createHash("sha256").update(fs.readFileSync(installedSeal)).digest("hex");
  const probeRecords = [
    { kind: "start", argv: ["claude", "mcp", "get", "notes"], ancestry: [
      {
        argv: [process.execPath, installedSeal, "__proxy", "--protect-state", state.paths.protectState],
        script: { path: installedSeal, sha256: installedSealDigest },
        argv_files: [{ path: installedSeal, sha256: installedSealDigest }],
      },
    ] },
    { kind: "frame", frame: "initialize" },
    { kind: "frame", frame: "tools/list" },
    { kind: "frame", frame: "tools/call" },
    { kind: "exit", code: 0 },
  ];
  end.child_log.records.push(...probeRecords);
  end.child_log.lines += probeRecords.length;
  fs.writeFileSync(endPath, `${JSON.stringify(end, null, 2)}\n`);

  let outcome = harness.observeAll(harness.loadState(runDir)).find((entry) => entry.case === "missing_launcher");
  assert.equal(outcome.result, "OBSERVED", JSON.stringify(outcome.facts));
  assert.equal(outcome.facts.child_call_records_added, 0);
  assert.equal(outcome.facts.lifecycle_records_added, 5);
  assert.equal(outcome.facts.records_added_total, 5);
  assert.deepEqual(outcome.facts.offending_child_call_records, []);

  const mcpJsonSha256 = end.mcp_json.sha256;
  end.mcp_json.sha256 = "mcp-json-changed";
  fs.writeFileSync(endPath, `${JSON.stringify(end, null, 2)}\n`);
  outcome = harness.observeAll(harness.loadState(runDir)).find((entry) => entry.case === "missing_launcher");
  assert.equal(outcome.result, "NOT OBSERVED", JSON.stringify(outcome.facts));
  end.mcp_json.sha256 = mcpJsonSha256;
  fs.writeFileSync(endPath, `${JSON.stringify(end, null, 2)}\n`);

  const launcherPresent = harness.loadState(runDir);
  launcherPresent.steps.missing_launcher.launcher_absent_during_window = false;
  harness.saveState(launcherPresent);
  outcome = harness.observeAll(harness.loadState(runDir)).find((entry) => entry.case === "missing_launcher");
  assert.equal(outcome.result, "NOT OBSERVED", JSON.stringify(outcome.facts));
  launcherPresent.steps.missing_launcher.launcher_absent_during_window = true;
  harness.saveState(launcherPresent);

  const fallback = { kind: "child-call", tool: "append_note", arguments: { note: "fallback leaked" }, argv: ["append_note", "fallback leaked"] };
  end.child_log.records.push(fallback);
  end.child_log.lines += 1;
  end.child_log.guarded_calls += 1;
  fs.writeFileSync(endPath, `${JSON.stringify(end, null, 2)}\n`);
  outcome = harness.observeAll(harness.loadState(runDir)).find((entry) => entry.case === "missing_launcher");
  assert.equal(outcome.result, "NOT OBSERVED", JSON.stringify(outcome.facts));
  assert.deepEqual(outcome.facts.offending_child_call_records, [fallback]);

  const retry = harness.loadState(runDir);
  retry.step_index = 3;
  retry.steps.missing_launcher.attempted = true;
  harness.saveState(retry);
  assert.throws(
    () => harness.next(harness.loadState(runDir)),
    (error) => error instanceof harness.HarnessError && error.code === "step_cannot_certify" &&
      /missing_launcher: child_call_records_added must equal 0 \(observed 1\); offending child-call records:.*fallback leaked/.test(error.message),
  );
  assert.equal(harness.loadState(runDir).step_index, 3);
});

test("unprotect refuses when its successful removal command is absent", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-unprotect-absence-"));
  const { harness, runDir } = initSyntheticRun(workspace);
  completeSyntheticRun(harness, runDir);
  const state = harness.loadState(runDir);
  assert.equal(state.step_index, 5);
  state.step_index = 4;
  state.steps.unprotect = { ...state.steps.unprotect, attempted: true, code: 1, output: "No MCP server named notes in local scope" };
  harness.saveState(state);
  assert.throws(
    () => harness.next(harness.loadState(runDir)),
    (error) => error instanceof harness.HarnessError && error.code === "step_cannot_certify" &&
      /CANNOT CERTIFY unprotect; unprotect: seal unprotect notes exit must be 0 \(observed 1\)/.test(error.message),
  );
  assert.equal(harness.loadState(runDir).step_index, 4);
});

test("a self-consistent recorder-bundle rewrite passes only with the bookkeeping boundary label", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-bundle-rewrite-"));
  const { harness, runDir } = initSyntheticRun(workspace);
  completeSyntheticRun(harness, runDir);
  const state = harness.loadState(runDir);
  const outPath = path.join(runDir, "logs", "decline.typescript");
  const timingPath = path.join(runDir, "logs", "decline.timing");
  const castPath = path.join(runDir, "logs", "decline.cast");
  const added = Buffer.from("FORGED\n", "utf8");
  fs.appendFileSync(outPath, added);
  fs.appendFileSync(timingPath, `O 0.000000 ${added.length}\n`);
  fs.writeFileSync(castPath, harness.castFromScript(outPath, timingPath, state.recordings.decline.conversion));
  const digestOf = (file) => {
    const bytes = fs.readFileSync(file);
    return { present: true, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
  };
  state.recordings.decline.typescript = digestOf(outPath);
  state.recordings.decline.timing = digestOf(timingPath);
  state.recordings.decline.cast = digestOf(castPath);
  harness.saveState(state);
  assert.equal(harness.observeAll(harness.loadState(runDir)).find((entry) => entry.case === "decline").result, "OBSERVED");
  const out = path.join(workspace, "out");
  harness.finish(harness.loadState(runDir), { out });
  const manifestPath = fs.readdirSync(path.join(out, "evidence", "claude-code")).flatMap((client) =>
    fs.readdirSync(path.join(out, "evidence", "claude-code", client, "linux-x64")).map((artifact) =>
      path.join(out, "evidence", "claude-code", client, "linux-x64", artifact, "manifest.json")))[0];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.match(manifest.limitations.join("\n"), /Binding is bookkeeping, not a control/);
  assert.match(fs.readFileSync(path.join(ROOT, "docs", "assurance", "claude-code-evidence.md"), "utf8"), /Binding is bookkeeping, not a control/);
});

test("init refuses a PE client by its resolved-path header bytes", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-pe-client-"));
  const clientBytes = Buffer.alloc(20);
  clientBytes[0] = 0x4d;
  clientBytes[1] = 0x5a;
  const result = initWithPathClient(workspace, clientBytes);
  const output = `${result.stdout}${result.stderr}`;
  const client = path.join(workspace, "stub-bin", "claude");
  assert.equal(result.status, 1, output);
  assert.match(output, new RegExp(`^REFUSE client_not_linux_x64: client executable ${JSON.stringify(client).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} has observed header bytes 4D 5A(?: 00){18};`, "m"), output);
});

test("init refuses a shell-script client because the resolved client is not ELF", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-script-client-"));
  const result = initWithPathClient(workspace, Buffer.from("#!/bin/sh\nprintf '9.9.9\\n'\n", "utf8"));
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /^REFUSE client_not_linux_x64: .* has observed header bytes 23 21 2F 62 69 6E 2F 73 68 0A/m, output);
});

test("the client format check accepts the Node Linux x86-64 ELF", () => {
  const harness = require(HARNESS);
  assert.equal(harness.clientExecutableFormat(process.execPath), "elf64-x86-64");
});

test("two distinct claude executables on PATH refuse with both resolved paths and digests", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-client-ambiguous-"));
  const first = buildClaude(workspace, "claude-one", "1.2.3");
  const second = buildClaude(workspace, "claude-two", "4.5.6");
  const firstBin = path.join(workspace, "first-bin");
  const secondBin = path.join(workspace, "second-bin");
  fs.mkdirSync(firstBin);
  fs.mkdirSync(secondBin);
  fs.symlinkSync(first, path.join(firstBin, "claude"));
  fs.symlinkSync(second, path.join(secondBin, "claude"));
  const harness = require(HARNESS);
  assert.throws(
    () => harness.clientIdentity(pathEnv(firstBin, secondBin)),
    (error) => error instanceof harness.HarnessError && error.code === "client_ambiguous" &&
      error.message.includes(first) && error.message.includes(second) &&
      error.message.includes(createHash("sha256").update(fs.readFileSync(first)).digest("hex")) &&
      error.message.includes(createHash("sha256").update(fs.readFileSync(second)).digest("hex")) &&
      error.message.includes("Pass --client PATH"),
  );
});

test("one claude executable auto-resolves and records its full candidate list", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-client-auto-"));
  const client = buildClaude(workspace, "claude", "1.2.3");
  const harness = require(HARNESS);
  const identity = harness.clientIdentity(pathEnv(workspace));
  assert.equal(identity.selection_method, "auto");
  assert.deepEqual(identity.candidates, [{ executable: client, ...harness.digestOf(client) }]);
});

test("two PATH entries that resolve to one claude executable do not refuse", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-client-symlink-"));
  const client = buildClaude(workspace, "client", "1.2.3");
  const firstBin = path.join(workspace, "first-bin");
  const secondBin = path.join(workspace, "second-bin");
  fs.mkdirSync(firstBin);
  fs.mkdirSync(secondBin);
  fs.symlinkSync(client, path.join(firstBin, "claude"));
  fs.symlinkSync(client, path.join(secondBin, "claude"));
  const identity = require(HARNESS).clientIdentity(pathEnv(firstBin, secondBin));
  assert.equal(identity.selection_method, "auto");
  assert.equal(identity.candidates.length, 1);
  assert.equal(identity.executable, client);
});

test("an explicit client ignores a different claude executable on PATH", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-client-explicit-"));
  const explicit = buildClaude(workspace, "explicit", "1.2.3");
  const other = buildClaude(workspace, "other", "4.5.6");
  const bin = path.join(workspace, "bin");
  fs.mkdirSync(bin);
  fs.symlinkSync(other, path.join(bin, "claude"));
  const identity = require(HARNESS).clientIdentity(pathEnv(bin), explicit);
  assert.equal(identity.selection_method, "explicit");
  assert.equal(identity.executable, explicit);
  assert.equal(identity.sha256, createHash("sha256").update(fs.readFileSync(explicit)).digest("hex"));
  assert.equal(identity.candidates, undefined);
});

test("an explicit client path that does not exist refuses instead of throwing", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-client-missing-"));
  const client = path.join(workspace, "client-that-does-not-exist");
  const harness = require(HARNESS);
  assert.throws(
    () => harness.clientIdentity(pathEnv(workspace), client),
    (error) => error instanceof harness.HarnessError && error.code === "client_unreadable" &&
      error.message.includes(JSON.stringify(client)) && error.message.includes("ENOENT"),
  );
});

test("a relative explicit client refusal quotes the path supplied to --client", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-client-relative-"));
  const artifact = artifactFixture();
  const result = spawnSync(process.execPath, [HARNESS, "init",
    "--artifact", artifact.path,
    "--sha256", artifact.sha256,
    "--bytes", artifact.bytes,
    "--run-dir", path.join(workspace, "run"),
    "--client", "./no-such-client",
  ], { cwd: workspace, encoding: "utf8" });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /^REFUSE client_unreadable: client executable "\.\/no-such-client" cannot be resolved: ENOENT$/m, output);
});

test("a missing stand-in client path refuses instead of throwing", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-stand-in-missing-"));
  const client = path.join(workspace, "client-that-does-not-exist");
  const result = initWithStandInClient(workspace, client);
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, new RegExp(`^REFUSE client_unreadable: client executable ${JSON.stringify(client).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} cannot be resolved: ENOENT$`, "m"), output);
});

test("a stand-in client directory refuses as client_unreadable", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-stand-in-directory-"));
  const result = initWithStandInClient(workspace, workspace);
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, new RegExp(`^REFUSE client_unreadable: client executable ${JSON.stringify(workspace).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} cannot supply readable bytes for its sha256: EISDIR$`, "m"), output);
});

test("a stand-in client without execute permission remains valid", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-stand-in-no-execute-"));
  const client = path.join(workspace, "client");
  fs.copyFileSync(SYNTHETIC_CLIENT, client);
  fs.chmodSync(client, 0o644);
  const result = initWithStandInClient(workspace, client);
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, output);
  const state = JSON.parse(fs.readFileSync(path.join(workspace, "run", "harness-state.json"), "utf8"));
  assert.equal(state.claude.name, "claude-code-stand-in");
  assert.equal(state.claude.version, "0.0.0-synthetic-stand-in");
  assert.equal(state.claude.version_output, require(HARNESS).SYNTHETIC_BANNER);
});

test("an explicit client directory refuses as client_unreadable", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-client-directory-"));
  const harness = require(HARNESS);
  assert.throws(
    () => harness.clientIdentity(pathEnv(workspace), workspace),
    (error) => error instanceof harness.HarnessError && error.code === "client_unreadable" &&
      error.message.includes(JSON.stringify(workspace)) && error.message.includes("EISDIR"),
  );
});

test("an explicit client without execute permission refuses with a token", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-client-no-execute-"));
  const client = buildClaude(workspace, "client", "1.2.3");
  fs.chmodSync(client, 0o644);
  const harness = require(HARNESS);
  assert.throws(
    () => harness.clientIdentity(pathEnv(workspace), client),
    (error) => error instanceof harness.HarnessError && error.code === "client_unreadable" &&
      error.message === `client executable ${JSON.stringify(client)} could not be executed: error code "EACCES"`,
  );
});

test("an explicit client that runs and exits non-zero reports its real version exit status", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-client-version-exit-"));
  const client = buildClaude(workspace, "client", "1.2.3", 23);
  const harness = require(HARNESS);
  assert.throws(
    () => harness.clientIdentity(pathEnv(workspace), client),
    (error) => error instanceof harness.HarnessError && error.code === "client_version_unavailable" &&
      error.message === "`claude --version` exited 23",
  );
});

test("an explicit non-ELF client retains the client_not_linux_x64 refusal", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-client-explicit-non-elf-"));
  const client = path.join(workspace, "client");
  fs.writeFileSync(client, "#!/bin/sh\nprintf 'not claude'\n", { mode: 0o755 });
  const harness = require(HARNESS);
  assert.throws(
    () => harness.clientIdentity(pathEnv(workspace), client),
    (error) => error instanceof harness.HarnessError && error.code === "client_not_linux_x64",
  );
});

test("an empty client read refuses as client_unreadable", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-client-empty-"));
  const client = path.join(workspace, "client");
  fs.writeFileSync(client, "", { mode: 0o755 });
  const harness = require(HARNESS);
  assert.deepEqual(harness.digestOf(client), {
    present: true,
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    bytes: 0,
  });
  assert.throws(
    () => harness.clientIdentity(pathEnv(workspace), client),
    (error) => error instanceof harness.HarnessError && error.code === "client_unreadable" && /<empty>/.test(error.message),
  );
});

test("a short client read refuses as client_unreadable", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-client-short-"));
  const client = path.join(workspace, "client");
  fs.writeFileSync(client, Buffer.from([0x7f, 0x45, 0x4c]), { mode: 0o755 });
  const harness = require(HARNESS);
  assert.throws(
    () => harness.clientIdentity(pathEnv(workspace), client),
    (error) => error instanceof harness.HarnessError && error.code === "client_unreadable" &&
      /observed header bytes 7F 45 4C; expected 20 readable header bytes/.test(error.message),
  );
});

test("no claude executable retains the client_absent refusal bytes", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-client-absent-"));
  const harness = require(HARNESS);
  assert.throws(
    () => harness.clientIdentity(pathEnv(workspace)),
    (error) => error instanceof harness.HarnessError && error.code === "client_absent" &&
      error.message === "no `claude` command is on PATH; the acceptance run needs the real client",
  );
});

test("waitForEnter retries EAGAIN and returns only after ENTER", () => {
  const script = [
    `const fs = require("node:fs");`,
    `const harness = require(${JSON.stringify(HARNESS)});`,
    `Object.defineProperty(process.stdin, "isTTY", { value: true });`,
    `let reads = 0;`,
    `fs.readSync = (_fd, byte) => { reads += 1; if (reads < 3) { const error = new Error("try again"); error.code = reads === 1 ? "EAGAIN" : "EWOULDBLOCK"; throw error; } byte[0] = 0x0a; return 1; };`,
    `harness.waitForEnter({ synthetic: false });`,
    `process.stdout.write("READS=" + reads + "\\n");`,
  ].join("\n");
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /READS=3/);
});

test("waitForEnter refuses closed stdin without retrying forever", () => {
  const script = [
    `const fs = require("node:fs");`,
    `const harness = require(${JSON.stringify(HARNESS)});`,
    `Object.defineProperty(process.stdin, "isTTY", { value: true });`,
    `fs.readSync = () => 0;`,
    `try { harness.waitForEnter({ synthetic: false }); } catch (error) { process.stderr.write(error.code + ": " + error.message + "\\n"); process.exit(error.code === "operator_enter_absent" ? 0 : 2); }`,
    `process.exit(3);`,
  ].join("\n");
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 1000 });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /^operator_enter_absent: stdin closed before the human pressed ENTER; the client was not launched$/m);
});

test("waitForEnter keeps the non-TTY refusal", () => {
  const script = [
    `const harness = require(${JSON.stringify(HARNESS)});`,
    `try { harness.waitForEnter({ synthetic: false }); } catch (error) { process.stderr.write(error.code + ": " + error.message + "\\n"); process.exit(error.code === "operator_input_not_tty" ? 0 : 2); }`,
    `process.exit(3);`,
  ].join("\n");
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", input: "" });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /^operator_input_not_tty: the acceptance client cannot launch because ENTER must come from a human at a terminal$/m);
});

test("init names a missing executable bit", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-not-executable-"));
  const artifact = path.join(workspace, "seal-artifact");
  fs.writeFileSync(artifact, "not executable\n", { mode: 0o644 });
  const bytes = fs.readFileSync(artifact);
  const result = spawnSync(process.execPath, [HARNESS, "init",
    "--artifact", artifact,
    "--sha256", createHash("sha256").update(bytes).digest("hex"),
    "--bytes", String(bytes.length),
    "--run-dir", path.join(workspace, "run"),
  ], { encoding: "utf8" });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /^REFUSE artifact_not_executable: .* is not executable;/m);
  assert.match(output, /chmod u\+x --/);
});

test("init surfaces an exec error and gives immutable-store recovery", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-install-error-"));
  const artifact = path.join(workspace, "seal-artifact");
  fs.writeFileSync(artifact, "#!/definitely/absent/seal-interpreter\n", { mode: 0o755 });
  const bytes = fs.readFileSync(artifact);
  const runDir = path.join(workspace, "run");
  const result = spawnSync(process.execPath, [HARNESS, "init",
    "--artifact", artifact,
    "--sha256", createHash("sha256").update(bytes).digest("hex"),
    "--bytes", String(bytes.length),
    "--run-dir", runDir,
    "--synthetic-client", "--client-command", SYNTHETIC_CLIENT,
  ], { encoding: "utf8" });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /^REFUSE install_failed: installing the pinned artifact failed: .*ENOENT/m);
  assert.match(output, /Recover this run directory with: chmod -R u\+w -- .* && rm -rf --/);
});

test("an unclean immutable run names the chmod command before rm", () => {
  const workspace = testTmpdir(path.join(os.tmpdir(), "seal-cc-unclean-"));
  const runDir = path.join(workspace, "run");
  const store = path.join(runDir, "home", ".local", "lib", "seal", "store", "tree");
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, "installed"), "bytes\n");
  fs.chmodSync(store, 0o555);
  const result = spawnSync(process.execPath, [HARNESS, "init",
    "--artifact", path.join(workspace, "unused"), "--sha256", "0".repeat(64), "--bytes", "1", "--run-dir", runDir,
  ], { encoding: "utf8" });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /^REFUSE run_dir_not_clean:/m);
  assert.match(output, /chmod -R u\+w -- .* && rm -rf --/);
  assert.equal(fs.statSync(store).mode & 0o777, 0o555);
});
