// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
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
  if (!sharedArtifact) sharedArtifact = buildArtifact(fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-harness-artifact-")));
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
  ], { encoding: "utf8", env: { ...process.env, PATH: `${stubBin}${path.delimiter}${process.env.PATH || ""}` } });
}

function syntheticSetup(workspace) {
  const stubBin = path.join(workspace, "stub-bin");
  fs.mkdirSync(stubBin);
  const client = path.join(stubBin, "claude");
  fs.copyFileSync(SYNTHETIC_CLIENT, client);
  fs.chmodSync(client, 0o755);
  return { stubBin, client };
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
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-forged-cast-"));
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
      /CANNOT CERTIFY decline; decline: decline\.cast does not correspond to the recorder output/.test(error.message),
  );
  assert.equal(harness.loadState(runDir).step_index, 1);
});

test("finish refuses before writing when any declared case lacks positive evidence", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-finish-absence-"));
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
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-harness-truth-"));
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
      /CANNOT CERTIFY decline; decline: the exact-call BLOCK\/declined receipt pair is absent/.test(error.message),
  );
  assert.equal(harness.loadState(runDir).step_index, 1);
  assert.match(fs.readFileSync(path.join(runDir, "CURRENT-STEP.txt"), "utf8"), /STEP 2 of 6[\s\S]*seal-declined-note/);
  harness.show(harness.loadState(runDir));
  assert.equal(harness.loadState(runDir).step_index, 1);
});

test("activation refuses when the local notes override was not selected or connected", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-activation-silent-"));
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

test("missing_launcher refuses when the recorded session supplies no no-fallback evidence", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-missing-launcher-absence-"));
  const { harness, runDir } = initSyntheticRun(workspace);
  runSyntheticStep(harness, runDir, "activation", "");
  runSyntheticStep(harness, runDir, "decline", harness.NOTES.decline);
  runSyntheticStep(harness, runDir, "accept", harness.NOTES.accept);
  const noOp = path.join(workspace, "no-op-client");
  fs.writeFileSync(noOp, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const state = harness.loadState(runDir);
  state.claude.command = noOp;
  harness.saveState(state);
  assert.throws(
    () => harness.next(harness.loadState(runDir)),
    (error) => error instanceof harness.HarnessError && error.code === "step_cannot_certify" &&
      /CANNOT CERTIFY missing_launcher; missing_launcher: the recorded session never says the local override command was missing/.test(error.message),
  );
  assert.equal(harness.loadState(runDir).step_index, 3);
});

test("unprotect refuses when its successful removal command is absent", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-unprotect-absence-"));
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
      /CANNOT CERTIFY unprotect; unprotect: seal unprotect notes did not succeed \(exit 1\)/.test(error.message),
  );
  assert.equal(harness.loadState(runDir).step_index, 4);
});

test("a self-consistent recorder-bundle rewrite passes only with the bookkeeping boundary label", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-bundle-rewrite-"));
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
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-pe-client-"));
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
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-script-client-"));
  const result = initWithPathClient(workspace, Buffer.from("#!/bin/sh\nprintf '9.9.9\\n'\n", "utf8"));
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /^REFUSE client_not_linux_x64: .* has observed header bytes 23 21 2F 62 69 6E 2F 73 68 0A/m, output);
});

test("the client format check accepts the Node Linux x86-64 ELF", () => {
  const harness = require(HARNESS);
  assert.equal(harness.clientExecutableFormat(process.execPath), "elf64-x86-64");
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
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-not-executable-"));
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
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-install-error-"));
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
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-unclean-"));
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
