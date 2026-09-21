const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn, spawnSync } = require("node:child_process");
const readline = require("node:readline");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const SEAL = path.join(__dirname, "../bin/seal");
const { processStartWitness, statePathFor, readState } = require("../spine/protection.cjs");


function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function writeProject(project, server) {
  const body = JSON.stringify({ mcpServers: { db: server } }, null, 2) + "\n";
  fs.writeFileSync(path.join(project, ".mcp.json"), body);
  return body;
}

function fakeClaudeBin(root) {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const script = path.join(bin, "claude");
  fs.writeFileSync(script, `#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const cwd = process.cwd();
const home = process.env.HOME || cwd;
const args = process.argv.slice(2);
function configPath() { return path.join(process.env.CLAUDE_CONFIG_DIR || home, ".claude.json"); }
function readConfig() { try { return JSON.parse(fs.readFileSync(configPath(), "utf8")); } catch { return {}; } }
function writeConfig(config) { fs.mkdirSync(path.dirname(configPath()), { recursive: true }); fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\\n"); }
function localServer(name) { return readConfig().projects?.[cwd]?.mcpServers?.[name]; }
function projectHas(name) {
  try { return !!JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8")).mcpServers[name]; } catch { return false; }
}

if (args[0] !== "mcp") process.exit(2);
if (args[1] === "get") {
  const name = args[2];
  if (localServer(name)) {
    console.log(name + ":\\n  Scope: Local config (private to you in this project)\\n  Type: stdio");
    process.exit(0);
  }
  if (projectHas(name)) {
    console.log(name + ":\\n  Scope: Project config (shared via .mcp.json)\\n  Type: stdio");
    process.exit(0);
  }
  console.error('No MCP server named "' + name + '".');
  process.exit(1);
}
if (args[1] === "add") {
  const name = args[4];
  if (process.env.SEAL_TEST_CLAUDE_ADD_FAIL === "1") {
    console.error("stub add failed: simulated write failure");
    process.exit(23);
  }
  const split = args.indexOf("--");
  const config = readConfig();
  config.projects ||= {};
  config.projects[cwd] ||= {};
  config.projects[cwd].mcpServers ||= {};
  config.projects[cwd].mcpServers[name] = { type: "stdio", command: args[split + 1], args: args.slice(split + 2), env: {} };
  writeConfig(config);
  if (process.env.SEAL_TEST_CLAUDE_PARTIAL === "1") process.exit(23);
  console.log("Added stdio MCP server " + name + " to local config");
  process.exit(0);
}
if (args[1] === "remove") {
  const name = args[4];
  const config = readConfig();
  if (!config.projects?.[cwd]?.mcpServers?.[name]) {
    console.error('No MCP server named "' + name + '" in local scope');
    process.exit(1);
  }
  delete config.projects[cwd].mcpServers[name];
  writeConfig(config);
  console.log("Removed MCP server " + name + " from local config");
  process.exit(0);
}
process.exit(2);
`);
  fs.chmodSync(script, 0o755);
  return bin;
}

function withoutObservationTime(output) {
  return output.replace(/^Observation time: .*$/m, "Observation time: <measured>");
}

function fakeLocalOverridePath(root) {
  return path.join(root, "home", ".claude.json");
}

function run(project, home, args, extraEnv = {}) {
  try {
    return { code: 0, out: execFileSync(SEAL, args, {
      cwd: project,
      env: { ...process.env, ...extraEnv, HOME: home, XDG_DATA_HOME: path.join(home, ".local", "share") },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }) };
  } catch (error) {
    return { code: error.status, out: `${error.stdout || ""}${error.stderr || ""}` };
  }
}

async function waitForState(filePath, state, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (readState(filePath).state === state) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(readState(filePath).state, state);
}

async function waitForFile(filePath, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.existsSync(filePath), true);
}

// Protected Accept requires an installer-produced anchor, even in tests.
// Build/install a separate payload; never fabricate a source-checkout record.
let installedProxy;
function installedProxyPath() {
  if (installedProxy) return installedProxy;
  const out = testTmpdir("seal-proxy-runtime-install-");
  const built = spawnSync(process.execPath, [path.join(__dirname, "../scripts/build-dist.cjs"), "--out", out], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const [digest, bytes, name] = fs.readFileSync(path.join(out, "SHA256SUMS"), "utf8").trim().split(/\s+/);
  const prefix = path.join(out, "prefix");
  const installed = spawnSync(path.join(out, name), ["--sha256", digest, "--bytes", bytes, "--prefix", prefix], { encoding: "utf8" });
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  const record = JSON.parse(fs.readFileSync(path.join(prefix, "lib/seal/install.json"), "utf8"));
  installedProxy = path.join(prefix, record.store, "bin/seal");
  return installedProxy;
}

test("relative protected command activates from project, nested and unrelated directories", () => {
  const root = testTmpdir("seal-relative-activation-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  const nested = path.join(project, "nested");
  const unrelated = path.join(root, "unrelated");
  for (const dir of [project, home, nested, unrelated]) fs.mkdirSync(dir);
  const fakeBin = fakeClaudeBin(root);
  const serverPath = path.join(project, "server");
  fs.symlinkSync(process.execPath, serverPath);
  writeProject(project, { command: "./server", args: [SEAL, "__demo-server", path.join(root, "data.txt")] });
  const env = { ...process.env, HOME: home, XDG_DATA_HOME: path.join(home, ".local", "share"), PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  const protectedRun = run(project, home, ["protect", "db", "demo.mutate"], env);
  assert.equal(protectedRun.code, 0, protectedRun.out);
  const file = statePathFor(project, env);
  assert.equal(readState(file).state, "PENDING RESTART");
  assert.equal(readState(file).projectRoot, fs.realpathSync(project));
  for (const cwd of [nested, unrelated, project]) {
    assert.equal(fs.existsSync(serverPath), true);
    const activated = run(cwd, home, ["__proxy", "--protect-state", file], env);
    assert.equal(activated.code, 0, `${cwd}: ${activated.out}`);
    assert.equal(readState(file).state, "ACTIVE");
  }
  // A caller-local executable must not hide a missing saved-project command.
  fs.unlinkSync(serverPath);
  fs.symlinkSync(process.execPath, path.join(unrelated, "server"));
  const refused = run(unrelated, home, ["__proxy", "--protect-state", file], env);
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /protected_server_missing/);
});

test("protect and unprotect leave project .mcp.json byte-identical by hash", () => {
  const root = testTmpdir("seal-protect3b-hash-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const beforeBytes = writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "data.txt")] });
  const beforeHash = sha256(beforeBytes);
  const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };

  const protectedRun = run(project, home, ["protect", "db", "demo.mutate"], env);
  assert.equal(protectedRun.code, 0, protectedRun.out);
  assert.match(protectedRun.out, new RegExp(`Project \\.mcp\\.json hash before protect: ${beforeHash}`));
  assert.equal(sha256(fs.readFileSync(path.join(project, ".mcp.json"))), beforeHash);
  const state = readState(statePathFor(project, { XDG_DATA_HOME: path.join(home, ".local", "share") }));
  assert.equal(state.state, "PENDING RESTART");

  const unprotectedRun = run(project, home, ["unprotect", "db"], env);
  assert.equal(unprotectedRun.code, 0, unprotectedRun.out);
  assert.match(unprotectedRun.out, new RegExp(`Project \\.mcp\\.json hash before unprotect: ${beforeHash}`));
  assert.match(unprotectedRun.out, new RegExp(`Project \\.mcp\\.json hash after unprotect: ${beforeHash}`));
  assert.equal(fs.readFileSync(path.join(project, ".mcp.json"), "utf8"), beforeBytes);
});

test("protect, unprotect, recover, status and coverage share the git root from nested and symlinked directories", () => {
  const root = testTmpdir("seal-protect3b-status-root-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  const nested = path.join(project, "src", "nested");
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(home);
  execFileSync("git", ["init", "--quiet", project]);
  const linked = path.join(root, "linked");
  fs.symlinkSync(nested, linked, "dir");
  const fakeBin = fakeClaudeBin(root);
  const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, CLAUDE_CONFIG_DIR: home };
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "data.txt")] });
  const rootConfigPath = path.join(project, ".mcp.json");
  const rootConfig = JSON.parse(fs.readFileSync(rootConfigPath, "utf8"));
  rootConfig.mcpServers.cache = { command: "root-cache-server" };
  fs.writeFileSync(rootConfigPath, JSON.stringify(rootConfig));
  const protectedRun = run(project, home, ["protect", "db", "demo.mutate"], env);
  assert.equal(protectedRun.code, 0, protectedRun.out);
  const baseline = run(project, home, ["status"], env);
  assert.equal(baseline.code, 0, baseline.out);
  const coverage = run(project, home, ["coverage"], env);
  assert.equal(coverage.code, 0, coverage.out);
  for (const cwd of [project, nested, linked]) {
    const status = run(cwd, home, ["status"], env);
    assert.equal(status.code, 0, status.out);
    assert.match(status.out, /Sealed MCP route db: PENDING RESTART/);
    assert.equal(withoutObservationTime(status.out), withoutObservationTime(baseline.out));
    const observed = run(cwd, home, ["coverage"], env);
    assert.equal(observed.code, 0, observed.out);
    assert.match(observed.out, /selected MCP tools on db: demo.mutate — protection state is PENDING RESTART/);
    assert.equal(observed.out, coverage.out);
  }
  const sourceBefore = fs.readFileSync(path.join(project, ".mcp.json"), "utf8");
  const nestedSource = writeProject(nested, { command: "nested-server-must-not-run" });
  const stateEnv = { XDG_DATA_HOME: path.join(home, ".local", "share") };
  const file = statePathFor(project, stateEnv, "db");
  for (const cwd of [nested, linked]) {
    const unprotected = run(cwd, home, ["unprotect", "db"], env);
    assert.equal(unprotected.code, 0, unprotected.out);
    assert.ok(unprotected.out.includes(file), unprotected.out);
    assert.ok(unprotected.out.includes(`Project .mcp.json hash before unprotect: ${sha256(sourceBefore)}`), unprotected.out);
    assert.equal(readState(file).state, "UNPROTECTED");
    const protectedAgain = run(cwd, home, ["protect", "db", "demo.mutate"], env);
    assert.equal(protectedAgain.code, 0, protectedAgain.out);
    assert.ok(protectedAgain.out.includes(file), protectedAgain.out);
    assert.match(protectedAgain.out, /configured MCP servers not routed through this Seal wrapper: cache/);
    assert.equal(readState(file).projectRoot, project);
    assert.equal(fs.existsSync(statePathFor(nested, stateEnv, "db")), false);
    const status = run(cwd, home, ["status"], env);
    assert.equal(status.code, 0, status.out);
    assert.ok(status.out.includes(file), status.out);
    assert.match(status.out, /Sealed MCP route db: PENDING RESTART/);
    const incompatible = JSON.stringify({ ...readState(file), schema: "seal.protect/v99" });
    fs.writeFileSync(file, incompatible);
    const recoveryArgs = cwd === nested ? ["recover", "--archive", "db"] : ["recover", "--archive"];
    const recovered = run(cwd, home, recoveryArgs, env);
    assert.equal(recovered.code, 0, recovered.out);
    const archive = recovered.out.match(/^Archived incompatible protection state: (.+)$/m)?.[1];
    assert.ok(archive?.startsWith(`${file}.recovered-`), recovered.out);
    assert.equal(fs.readFileSync(archive, "utf8"), incompatible);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.readFileSync(path.join(project, ".mcp.json"), "utf8"), sourceBefore);
    assert.equal(fs.readFileSync(path.join(nested, ".mcp.json"), "utf8"), nestedSource);
    const outside = run(cwd, home, ["status"], env);
    assert.equal(outside.code, 0, outside.out);
    assert.match(outside.out, /Sealed MCP route: - outside Seal/);
    assert.equal(run(cwd, home, ["protect", "db", "demo.mutate"], env).code, 0);
  }

});

test("unprotect refuses a developer-replaced local override and preserves it byte-identically", () => {
  const root = testTmpdir("seal-protect3b-owned-override-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "owned-data.txt")] });
  const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };

  const protectedRun = run(project, home, ["protect", "db", "demo.mutate"], env);
  assert.equal(protectedRun.code, 0, protectedRun.out);
  const overridePath = fakeLocalOverridePath(root);
  assert.equal(fs.existsSync(overridePath), true, "protect must install the local override");

  const developerBytes = Buffer.from(JSON.stringify({
    projects: { [project]: { mcpServers: { db: {
      type: "stdio", command: "developer-command", args: ["--developer-owned"], env: {},
    } } } },
  }, null, 2) + "\n");
  fs.writeFileSync(overridePath, developerBytes);
  const beforeHash = sha256(fs.readFileSync(overridePath));
  const statusRun = run(project, home, ["status"], env);
  assert.notEqual(statusRun.code, 0, statusRun.out);
  assert.match(statusRun.out, /^REFUSED local_override_drifted$/m);
  assert.equal(sha256(fs.readFileSync(overridePath)), beforeHash, "status must not alter the developer's override");
  const unprotectedRun = run(project, home, ["unprotect", "db"], env);

  assert.notEqual(unprotectedRun.code, 0, unprotectedRun.out);
  assert.match(unprotectedRun.out, /^REFUSED local_override_drifted$/m);
  assert.match(unprotectedRun.out, /^The current local override is not the one Seal installed\.$/m);
  assert.match(unprotectedRun.out, /^No configuration was changed\.$/m);
  assert.match(unprotectedRun.out, /^Next:\n  Restore the local Claude Code MCP override Seal installed, or leave it in place; Seal changed nothing\.$/m);
  assert.equal(fs.existsSync(overridePath), true, "the developer's override must remain present");
  assert.equal(sha256(fs.readFileSync(overridePath)), beforeHash, "the developer's override must remain byte-identical");
});

test("status distinguishes unreadable local configuration from a drifted override", (t) => {
  const root = testTmpdir("seal-protect3b-override-read-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "override-read-data.txt")] });
  const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };

  assert.equal(run(project, home, ["protect", "db", "demo.mutate"], env).code, 0);
  const overridePath = fakeLocalOverridePath(root);
  const installedBytes = fs.readFileSync(overridePath);
  t.after(() => {
    try {
      const stat = fs.lstatSync(overridePath);
      if (stat.isDirectory()) fs.rmdirSync(overridePath);
      else fs.chmodSync(overridePath, 0o600);
    } catch {}
  });

  fs.writeFileSync(overridePath, '{"projects":');
  const truncated = run(project, home, ["status"], env);
  assert.notEqual(truncated.code, 0, truncated.out);
  assert.match(truncated.out, /^REFUSED local_override_unreadable$/m);
  assert.match(truncated.out, /^The local Claude Code configuration could not be read: SyntaxError: /m);
  assert.doesNotMatch(truncated.out, /The current local override is not the one Seal installed/);

  fs.writeFileSync(overridePath, installedBytes, { mode: 0o600 });
  fs.chmodSync(overridePath, 0o000);
  const mode000 = run(project, home, ["status"], env);
  fs.chmodSync(overridePath, 0o600);
  assert.notEqual(mode000.code, 0, mode000.out);
  assert.match(mode000.out, /^REFUSED local_override_unreadable$/m);
  assert.match(mode000.out, /EACCES/);

  fs.unlinkSync(overridePath);
  fs.mkdirSync(overridePath);
  const directory = run(project, home, ["status"], env);
  fs.rmdirSync(overridePath);
  assert.notEqual(directory.code, 0, directory.out);
  assert.match(directory.out, /^REFUSED local_override_unreadable$/m);
  assert.match(directory.out, /EISDIR/);

  const developerBytes = Buffer.from(JSON.stringify({
    projects: { [project]: { mcpServers: { db: {
      type: "stdio", command: "developer-command", args: ["--developer-owned"], env: {},
    } } } },
  }, null, 2) + "\n");
  fs.writeFileSync(overridePath, developerBytes, { mode: 0o600 });
  const drifted = run(project, home, ["status"], env);
  assert.notEqual(drifted.code, 0, drifted.out);
  assert.match(drifted.out, /^REFUSED local_override_drifted$/m);
  assert.match(drifted.out, /^The current local override is not the one Seal installed\.$/m);
  assert.match(drifted.out, /^No configuration was changed\.$/m);
});

test("unprotect treats a missing local configuration as absent", () => {
  const root = testTmpdir("seal-protect3b-config-absent-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "config-absent-data.txt")] });
  assert.equal(run(project, home, ["protect", "db", "demo.mutate"], env).code, 0);

  fs.unlinkSync(fakeLocalOverridePath(root));
  const unprotected = run(project, home, ["unprotect", "db"], env);
  assert.equal(unprotected.code, 0, unprotected.out);
  assert.doesNotMatch(unprotected.out, /^REFUSED /m);
});

test("protect names install-time refusals", () => {
  const root = testTmpdir("seal-protect3b-refusals-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };

  let result = run(project, home, ["protect", "db", "demo.mutate"], env);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /project_server_absent/);
  assert.match(result.out, /^Next:\n  Fix this project's \.mcp\.json so the named server is a stdio MCP server, then retry protect\.$/m);

  fs.writeFileSync(path.join(project, ".mcp.json"), "{not-json\n");
  result = run(project, home, ["protect", "db", "demo.mutate"], env);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /project_server_invalid/);
  assert.match(result.out, /^Next:\n  Fix this project's \.mcp\.json so the named server is a stdio MCP server, then retry protect\.$/m);

  writeProject(project, { type: "http", url: "https://example.invalid/mcp" });
  result = run(project, home, ["protect", "db", "demo.mutate"], env);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /project_server_non_stdio/);
  assert.match(result.out, /^Next:\n  Fix this project's \.mcp\.json so the named server is a stdio MCP server, then retry protect\.$/m);

  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "override-data.txt")] });
  execFileSync("claude", ["mcp", "add", "--scope", "local", "db", "--", "node", "-e", "process.exit(0)"], {
    cwd: project,
    env: { ...process.env, ...env, HOME: home },
  });
  result = run(project, home, ["protect", "db", "demo.mutate"], env);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /local_override_exists/);
  assert.match(result.out, /^Next:\n  Remove or rename the existing local Claude Code MCP override for this server only if you want Seal to own it, then retry protect\.$/m);

  const incompatibleProject = path.join(root, "incompatible-project");
  fs.mkdirSync(incompatibleProject);
  writeProject(incompatibleProject, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "incompatible-data.txt")] });
  const incompatibleState = statePathFor(incompatibleProject, { XDG_DATA_HOME: path.join(home, ".local", "share") });
  fs.mkdirSync(path.dirname(incompatibleState), { recursive: true });
  fs.writeFileSync(incompatibleState, JSON.stringify({ schema: "seal.protect/v99", sealVersion: "0.0.0", state: "PENDING RESTART" }));
  result = run(incompatibleProject, home, ["protect", "db", "demo.mutate"], env);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /incompatible_state/);
});

test("explicit recovery archives incompatible bytes, preserves evidence, and permits fresh protect", () => {
  for (const mismatch of ["seal.protect/v99", "seal.protect/v0"]) {
    const root = testTmpdir(`seal-recover-${mismatch.split("/").pop()}-`);
    const project = path.join(root, "project");
    const home = path.join(root, "home");
    fs.mkdirSync(project);
    fs.mkdirSync(home);
    const env = { PATH: `${fakeClaudeBin(root)}${path.delimiter}${process.env.PATH}` };
    const projectBytes = writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "data.txt")] });
    assert.equal(run(project, home, ["protect", "db", "demo.mutate"], env).code, 0);
    const file = statePathFor(project, { XDG_DATA_HOME: path.join(home, ".local", "share") });
    const healthy = fs.readFileSync(file);
    const config = fs.readFileSync(path.join(home, ".claude.json"));
    const entries = fs.readdirSync(path.dirname(file));
    const refused = run(project, home, ["recover", "--archive"], env);
    assert.notEqual(refused.code, 0, refused.out);
    assert.match(refused.out, /recovery_not_needed/);
    assert.deepEqual(fs.readFileSync(file), healthy);
    assert.deepEqual(fs.readFileSync(path.join(home, ".claude.json")), config);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), entries);
    const old = { ...JSON.parse(healthy), schema: mismatch };
    const bytes = JSON.stringify(old, null, 2) + "\n";
    fs.writeFileSync(file, bytes);
    for (const args of [["status"], ["protect", "db", "demo.mutate"], ["unprotect", "db"]]) {
      assert.match(run(project, home, args, env).out, /seal recover --archive/);
    }
    const implicit = run(project, home, ["recover"], env);
    assert.notEqual(implicit.code, 0, implicit.out);
    assert.equal(fs.readFileSync(file, "utf8"), bytes);
    const journal = fs.readFileSync(old.storePath);
    const receipts = fs.readdirSync(old.receiptsDir);
    const recovered = run(project, home, ["recover", "--archive"], env);
    assert.equal(recovered.code, 0, recovered.out);
    const archive = recovered.out.match(/^Archived incompatible protection state: (.+)$/m)?.[1];
    assert.ok(archive, recovered.out);
    assert.equal(fs.readFileSync(archive, "utf8"), bytes);
    assert.equal(fs.statSync(archive).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(file), false);
    assert.deepEqual(fs.readFileSync(old.storePath), journal);
    assert.deepEqual(fs.readdirSync(old.receiptsDir), receipts);
    assert.equal(fs.readFileSync(path.join(project, ".mcp.json"), "utf8"), projectBytes);
    assert.match(run(project, home, ["status"], env).out, /outside Seal/);
    assert.equal(run(project, home, ["protect", "db", "demo.mutate"], env).code, 0);
    assert.equal(run(project, home, ["unprotect", "db"], env).code, 0);
    assert.equal(fs.readFileSync(archive, "utf8"), bytes);
    const unprotected = { ...JSON.parse(fs.readFileSync(file)), schema: "seal.protect/v99" };
    fs.writeFileSync(file, JSON.stringify(unprotected));
    const absentOverride = run(project, home, ["recover", "--archive"], env);
    assert.equal(absentOverride.code, 0, absentOverride.out);
    const absentState = run(project, home, ["recover", "--archive"], env);
    assert.notEqual(absentState.code, 0, absentState.out);
    assert.match(absentState.out, /recovery_not_needed/);
  }
});

test("recovery refuses live leases and replaced overrides without archiving or changing state", () => {
  const root = testTmpdir("seal-recover-refusals-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const env = { PATH: `${fakeClaudeBin(root)}${path.delimiter}${process.env.PATH}` };
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "data.txt")] });
  assert.equal(run(project, home, ["protect", "db", "demo.mutate"], env).code, 0);
  const file = statePathFor(project, { XDG_DATA_HOME: path.join(home, ".local", "share") });
  const old = { ...JSON.parse(fs.readFileSync(file)), schema: "seal.protect/v99" };
  const configPath = path.join(home, ".claude.json");
  for (const reason of ["active_claude_session", "local_override_drifted"]) {
    const state = reason === "active_claude_session"
      ? { ...old, lease: { pid: process.pid, startWitness: processStartWitness(process.pid) } } : old;
    fs.writeFileSync(file, JSON.stringify(state));
    if (reason === "local_override_drifted") {
      const config = JSON.parse(fs.readFileSync(configPath));
      config.projects[project].mcpServers.db.command = "developer-replacement";
      fs.writeFileSync(configPath, JSON.stringify(config));
    }
    const bytes = fs.readFileSync(file), configBytes = fs.readFileSync(configPath);
    const entries = fs.readdirSync(path.dirname(file));
    const result = run(project, home, ["recover", "--archive"], env);
    assert.notEqual(result.code, 0, result.out);
    assert.match(result.out, new RegExp(reason));
    assert.deepEqual(fs.readFileSync(file), bytes);
    assert.deepEqual(fs.readFileSync(configPath), configBytes);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), entries);
  }
});

test("recovery retains incompatible state and its archive if Claude removal fails, then retries", () => {
  const root = testTmpdir("seal-recover-remove-failure-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const env = { PATH: `${fakeClaudeBin(root)}${path.delimiter}${process.env.PATH}` };
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "data.txt")] });
  assert.equal(run(project, home, ["protect", "db", "demo.mutate"], env).code, 0);
  const file = statePathFor(project, { XDG_DATA_HOME: path.join(home, ".local", "share") });
  const bytes = JSON.stringify({ ...JSON.parse(fs.readFileSync(file)), schema: "seal.protect/v99" });
  fs.writeFileSync(file, bytes);
  const config = fs.readFileSync(path.join(home, ".claude.json"));
  const refused = run(project, home, ["recover", "--archive"], { PATH: path.dirname(process.execPath) });
  assert.notEqual(refused.code, 0, refused.out);
  assert.match(refused.out, /claude_remove_failed/);
  assert.equal(fs.readFileSync(file, "utf8"), bytes);
  assert.deepEqual(fs.readFileSync(path.join(home, ".claude.json")), config);
  const archives = fs.readdirSync(path.dirname(file)).filter((name) => name.startsWith("state.json.recovered-"));
  assert.equal(archives.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(file), archives[0]), "utf8"), bytes);
  const retried = run(project, home, ["recover", "--archive"], env);
  assert.equal(retried.code, 0, retried.out);
  assert.equal(fs.readdirSync(path.dirname(file)).filter((name) => name.startsWith("state.json.recovered-")).length, 2);
});

test("proxy activation promotes pending, and live project drift refuses before child delivery", async () => {
  const root = testTmpdir("seal-protect3b-drift-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, HOME: home, XDG_DATA_HOME: path.join(home, ".local", "share") };
  const dataFile = path.join(root, "data.txt");
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", dataFile] });

  const protectedRun = run(project, home, ["protect", "db", "demo.mutate"], { PATH: env.PATH });
  assert.equal(protectedRun.code, 0, protectedRun.out);
  const statePath = statePathFor(project, env);
  const proxy = spawn(installedProxyPath(), ["__proxy", "--protect-state", statePath], { cwd: project, env, stdio: ["pipe", "pipe", "pipe"] });
  try {
    const lines = readline.createInterface({ input: proxy.stdout, terminal: false });
    const nextLine = () => new Promise((resolve) => lines.once("line", (line) => resolve(JSON.parse(line))));

    await waitForState(statePath, "ACTIVE");
    proxy.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: 90, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: { elicitation: {} } },
    }) + "\n");
    await nextLine();
    proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "demo.mutate", arguments: { line: "held" } } }) + "\n");
    const elicitation = await nextLine();
    assert.equal(elicitation.method, "elicitation/create");

    writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", dataFile, "--drifted"] });
    proxy.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: elicitation.id,
      result: { action: "accept", content: { approve: true } },
    }) + "\n");
    const refused = await nextLine();
    assert.match(refused.result.content[0].text, /project_server_drifted/);
    await waitForFile(`${dataFile}.count`);
    assert.equal(fs.readFileSync(`${dataFile}.count`, "utf8"), "0\n");
    assert.equal(readState(statePath).state, "DRIFTED");
  } finally {
    proxy.stdin.end();
    await new Promise((resolve) => proxy.once("close", resolve));
  }
});

test("unprotect refuses while an activation lease pid is live", () => {
  const root = testTmpdir("seal-protect3b-active-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "active-data.txt")] });
  assert.equal(run(project, home, ["protect", "db", "demo.mutate"], env).code, 0);
  const statePath = statePathFor(project, { XDG_DATA_HOME: path.join(home, ".local", "share") });
  const state = readState(statePath);
  fs.writeFileSync(statePath, JSON.stringify({ ...state, state: "ACTIVE", lease: { pid: process.pid, startWitness: processStartWitness(process.pid) } }, null, 2));

  const result = run(project, home, ["unprotect", "db"], env);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /active_claude_session/);
  assert.match(result.out, /^Next:\n  Stop the Claude Code session using this server, then retry unprotect\.$/m);
});

test("unprotect recovers a live recycled PID whose witness does not match", () => {
  const root = testTmpdir("seal-protect3b-recycled-pid-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "recycled-data.txt")] });
  assert.equal(run(project, home, ["protect", "db", "demo.mutate"], env).code, 0);
  const statePath = statePathFor(project, { XDG_DATA_HOME: path.join(home, ".local", "share") });
  const state = readState(statePath);
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    fs.writeFileSync(statePath, JSON.stringify({
      ...state,
      state: "ACTIVE",
      lease: { pid: unrelated.pid, startWitness: "witness-from-the-recycled-process", generation: 9 },
    }, null, 2));
    const result = run(project, home, ["unprotect", "db"], env);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /outside Seal/);
  } finally {
    unrelated.kill("SIGKILL");
  }
});

test("unprotect refuses without installed ownership proof", () => {
  const root = testTmpdir("seal-protect3b-unwedge-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "unwedge-data.txt")] });

  const failedProtect = run(project, home, ["protect", "db", "demo.mutate"], { ...env, SEAL_TEST_CLAUDE_ADD_FAIL: "1" });
  assert.notEqual(failedProtect.code, 0);
  assert.match(failedProtect.out, /claude_install_failed/);
  const statePath = statePathFor(project, { XDG_DATA_HOME: path.join(home, ".local", "share") });
  assert.equal(readState(statePath).state, "BROKEN");

  assert.equal(readState(statePath).localOverride.installed, false);
  const refused = run(project, home, ["unprotect", "db"], env);
  assert.notEqual(refused.code, 0, refused.out);
  assert.match(refused.out, /^REFUSED no_seal_owned_override$/m);
  assert.match(refused.out, /^Next:\n  Inspect the local Claude Code MCP override for this server; Seal changed nothing\.$/m);
});

test("unprotect unwinds an absent override only when state proves Seal installed it", () => {
  const root = testTmpdir("seal-protect3b-owned-absent-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "absent-data.txt")] });
  assert.equal(run(project, home, ["protect", "db", "demo.mutate"], env).code, 0);
  const statePath = statePathFor(project, { XDG_DATA_HOME: path.join(home, ".local", "share") });
  assert.equal(readState(statePath).localOverride.installed, true);

  const configPath = fakeLocalOverridePath(root);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  delete config.projects[project].mcpServers.db;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  const unprotected = run(project, home, ["unprotect", "db"], env);
  assert.equal(unprotected.code, 0, unprotected.out);
  assert.equal(readState(statePath).state, "UNPROTECTED");
});

test("unprotect refuses when no Seal state exists", () => {
  const root = testTmpdir("seal-protect3b-no-owned-state-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "no-state-data.txt")] });
  execFileSync("claude", ["mcp", "add", "--scope", "local", "db", "--", "developer-command", "--owned-by-developer"], {
    cwd: project,
    env: { ...process.env, ...env, HOME: home },
  });
  const configPath = fakeLocalOverridePath(root);
  const beforeHash = sha256(fs.readFileSync(configPath));
  const result = run(project, home, ["unprotect", "db"], env);
  assert.notEqual(result.code, 0, result.out);
  assert.match(result.out, /^REFUSED no_seal_owned_override$/m);
  assert.match(result.out, /^Next:\n  Inspect the local Claude Code MCP override for this server; Seal changed nothing\.$/m);
  assert.equal(sha256(fs.readFileSync(configPath)), beforeHash, "an override without Seal state must remain byte-identical");
});

test("unprotect still refuses when the Claude command is unavailable during remove", () => {
  const root = testTmpdir("seal-protect3b-remove-failure-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "remove-data.txt")] });
  assert.equal(run(project, home, ["protect", "db", "demo.mutate"], env).code, 0);

  const refused = run(project, home, ["unprotect", "db"], { PATH: path.dirname(process.execPath) });
  assert.notEqual(refused.code, 0);
  assert.match(refused.out, /claude_remove_failed/);
  assert.match(refused.out, /ENOENT/);
  assert.match(refused.out, /^Next:\n  Make Claude Code's claude command available and able to remove the local override, then retry unprotect\.$/m);
});

test("status guides an absent Seal-owned local override in a pending project", () => {
  const root = testTmpdir("seal-protect3b-status-absent-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "status-absent-data.txt")] });
  assert.equal(run(project, home, ["protect", "db", "demo.mutate"], env).code, 0);

  const configPath = fakeLocalOverridePath(root);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  delete config.projects[project].mcpServers.db;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

  const result = run(project, home, ["status"], env);
  assert.notEqual(result.code, 0, result.out);
  assert.match(result.out, /^REFUSED local_override_drifted$/m);
  assert.match(result.out, /^The current local override is not the one Seal installed\.$/m);
  assert.match(result.out, /^No configuration was changed\.$/m);
  assert.match(result.out, /^Next:\n  Restore the local Claude Code MCP override Seal installed; status cannot report protection from a replaced override\.$/m);
});

test("status and doctor use outside-Seal and assumption/refusal language", () => {
  const root = testTmpdir("seal-protect3b-doctor-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);

  const status = run(project, home, ["status"]);
  assert.equal(status.code, 0);
  assert.match(status.out, /^Sealed MCP route: - outside Seal$/m);
  assert.doesNotMatch(status.out, /unprotected/i);

  const doctor = run(project, home, ["doctor"]);
  assert.equal(doctor.code, 0);
  assert.match(doctor.out, /^ASSUMPTION$/m);
  assert.match(doctor.out, /Seal has not established whether this Claude Code configuration can\n  automatically answer elicitation requests/);
  assert.doesNotMatch(doctor.out, /✓/);

  fs.mkdirSync(path.join(home, ".claude"));
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({
    hooks: {
      Elicitation: [{ hooks: [{ type: "command", command: "true" }] }],
      ElicitationResult: [{ hooks: [{ type: "command", command: "true" }] }],
    },
  }) + "\n");
  const hookFileRefused = run(project, home, ["doctor"]);
  assert.notEqual(hookFileRefused.code, 0);
  assert.match(hookFileRefused.out, /elicitation_hook_configured/);

  const refused = run(project, home, ["doctor"], { SEAL_ELICITATION_AUTO_RESPONSE: "accept" });
  assert.notEqual(refused.code, 0);
  assert.match(refused.out, /^REFUSED$/m);
  assert.match(refused.out, /Human approval origin cannot be assumed/);
});

test("protect refuses both auto-response hooks before creating protection state", () => {
  for (const variable of ["SEAL_ELICITATION_AUTO_RESPONSE", "CLAUDE_ELICITATION_AUTO_RESPONSE"]) {
    const root = testTmpdir(`seal-protect3b-doctor-gate-${variable.toLowerCase()}-`);
    const project = path.join(root, "project");
    const home = path.join(root, "home");
    fs.mkdirSync(project);
    fs.mkdirSync(home);
    const fakeBin = fakeClaudeBin(root);
    const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, [variable]: "accept" };
    writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "doctor-gate-data.txt")] });

    const result = run(project, home, ["protect", "db", "demo.mutate"], env);
    assert.notEqual(result.code, 0, result.out);
    assert.match(result.out, /^seal: REFUSE elicitation_hook_configured: an auto-response hook is set; human approval origin cannot be assumed$/m);
    assert.doesNotMatch(result.out, /^Sealed MCP route .*: (?:PENDING RESTART|(?:LEASE )?ACTIVE) /m);
    assert.equal(fs.existsSync(statePathFor(project, { XDG_DATA_HOME: path.join(home, ".local", "share") })), false);
    assert.equal(fs.existsSync(fakeLocalOverridePath(root)), false);
  }
});

test("status renders a dead activation lease as STALE, not active", () => {
  const root = testTmpdir("seal-protect3b-dead-lease-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "dead-lease-data.txt")] });
  assert.equal(run(project, home, ["protect", "db", "demo.mutate"], env).code, 0);
  const statePath = statePathFor(project, { XDG_DATA_HOME: path.join(home, ".local", "share") });
  const state = readState(statePath);
  fs.writeFileSync(statePath, JSON.stringify({ ...state, state: "ACTIVE", lease: { pid: 999999 } }, null, 2));

  const status = run(project, home, ["status"], env);
  assert.equal(status.code, 0, status.out);
  assert.match(status.out, /^Sealed MCP route db: STALE /m);
  assert.match(status.out, /^  demo\.mutate$/m);
  assert.match(status.out, /previous wrapper lease is not live/);
  assert.doesNotMatch(status.out, /^Sealed MCP route .*: (?:LEASE )?ACTIVE /m);
});

test("status downgrades to STALE after a REAL wrapper lease exits naturally", () => {
  // Route B (the real-world case): a genuine `seal __proxy --protect-state`
  // wrapper activates the lease, then exits as any Claude session does. The
  // stored state stays ACTIVE with the now-dead wrapper pid; status must
  // observe the dead lease and report PENDING RESTART, never ACTIVE.
  const root = testTmpdir("seal-protect3b-realexit-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = {
    HOME: home,
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
  };
  // A real MCP project server that stays alive so activation genuinely validates and promotes.
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "real-exit-data.txt")] });
  assert.equal(run(project, home, ["protect", "db", "demo.mutate"], { PATH: env.PATH }).code, 0);

  const statePath = statePathFor(project, { XDG_DATA_HOME: env.XDG_DATA_HOME });

  // Run the genuine wrapper to completion: empty stdin closes, the proxy
  // activates the lease with ITS OWN pid, then exits. No hand-written pid.
  execFileSync(SEAL, ["__proxy", "--protect-state", statePath], {
    cwd: project, env: { ...process.env, ...env }, input: "", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });

  // The stored state proves the wrapper really activated: ACTIVE with a real
  // pid that is now dead (the wrapper's own, and the wrapper has exited).
  const stored = readState(statePath);
  assert.equal(stored.state, "ACTIVE", "the wrapper must have genuinely promoted to ACTIVE");
  assert.ok(Number.isInteger(stored.lease.pid) && stored.lease.pid !== 999999, "a real wrapper pid, not a hand-written sentinel");
  let leaseAlive = true;
  try { process.kill(stored.lease.pid, 0); } catch { leaseAlive = false; }
  assert.equal(leaseAlive, false, "the wrapper has exited; its lease pid must be dead");

  const status = run(project, home, ["status"], { PATH: env.PATH });
  assert.equal(status.code, 0, status.out);
  assert.match(status.out, /^Sealed MCP route db: STALE /m);
  assert.match(status.out, /^  demo\.mutate$/m);
  assert.doesNotMatch(status.out, /^Sealed MCP route .*: (?:LEASE )?ACTIVE /m);
});

test("status reports refused state without inventing absent tools or unrouted servers", () => {
  const root = testTmpdir("seal-status-refusal-truth-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const env = { PATH: `${fakeClaudeBin(root)}${path.delimiter}${process.env.PATH}` };
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "data.txt")] });
  const protectedRun = run(project, home, ["protect", "db", "demo.mutate"], env);
  assert.equal(protectedRun.code, 0, protectedRun.out);
  const file = statePathFor(project, { XDG_DATA_HOME: path.join(home, ".local", "share") });
  const healthy = fs.readFileSync(file, "utf8");
  const override = fs.readFileSync(fakeLocalOverridePath(root), "utf8");
  const before = run(project, home, ["status"], env);
  assert.equal(before.code, 0, before.out);
  assert.match(before.out, /^Sealed MCP route db: PENDING RESTART /m);

  for (const fields of [{ schema: "seal.protect/v99" }, { schema: "seal.protect/v0" }, null]) {
    const bytes = fields ? JSON.stringify({ ...JSON.parse(healthy), ...fields }) : "garbage{";
    fs.writeFileSync(file, bytes);
    let refusal;
    assert.throws(() => readState(file), (error) => { refusal = error; return true; });
    if (fields) {
      assert.deepEqual(JSON.parse(bytes).guardTools, ["demo.mutate"]);
      assert.equal(JSON.parse(bytes).localOverride.installed, true);
    }
    const result = run(project, home, ["status"], env);
    assert.equal(result.code, 1, result.out);
    assert.match(result.out, /^Stored protection state: could not be read$/m);
    assert.ok(result.out.includes(`Protection detail: ${refusal.message}\n`), result.out);
    if (fields) assert.match(result.out, /seal recover --archive/);
    else assert.doesNotMatch(result.out, /seal recover --archive/);
    assert.match(result.out, /^Protected tool list: unreadable because the stored protection state could not be read$/m);
    assert.match(result.out, /^MCP routing: unknown because the stored protection state could not be read$/m);
    assert.doesNotMatch(result.out, /stored protection state has no protected tool list/);
    assert.doesNotMatch(result.out, /configured MCP servers not routed through this Seal wrapper/);
    assert.doesNotMatch(result.out, /^Sealed MCP route|^Gated through this route:|^Not controlled:/m);
    assert.equal(fs.readFileSync(file, "utf8"), bytes);
    assert.equal(fs.readFileSync(fakeLocalOverridePath(root), "utf8"), override);
  }
  fs.writeFileSync(file, healthy);
  const restored = run(project, home, ["status"], env);
  assert.deepEqual({ ...restored, out: withoutObservationTime(restored.out) }, { ...before, out: withoutObservationTime(before.out) });
});

test("status preserves known route facts across seven damaged state shapes and offers actionable recovery", () => {
  const root = testTmpdir("seal-status-seven-states-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const env = { PATH: `${fakeClaudeBin(root)}${path.delimiter}${process.env.PATH}`, GIT_CEILING_DIRECTORIES: root };
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "data.txt")] });
  const configPath = path.join(project, ".mcp.json");
  const config = JSON.parse(fs.readFileSync(configPath));
  config.mcpServers.cache = { command: "cache-server" };
  fs.writeFileSync(configPath, JSON.stringify(config));
  assert.equal(run(project, home, ["protect", "db", "demo.mutate"], env).code, 0);
  const file = statePathFor(project, { XDG_DATA_HOME: path.join(home, ".local", "share") });
  const healthy = fs.readFileSync(file, "utf8");
  const override = fs.readFileSync(fakeLocalOverridePath(root), "utf8");
  const missingTools = JSON.parse(healthy);
  delete missingTools.guardTools;
  delete missingTools.guardTool;
  const cases = [
    ["incompatible-schema", JSON.stringify({ ...JSON.parse(healthy), schema: "seal.protect/v99" })],
    ["malformed", "garbage{"],
    ["empty", ""],
    ["truncated", healthy.slice(0, -5)],
    ["missing-tools", JSON.stringify(missingTools)],
    ["mode-000", healthy],
    ["wrong-schema", JSON.stringify({ ...JSON.parse(healthy), schema: "seal.protect/v0" })],
  ];
  function recorded(name, args) {
    const result = run(project, home, args, env);
    fs.writeFileSync(path.join(root, `${name}.out`), result.out);
    fs.writeFileSync(path.join(root, `${name}.exit`), `${result.code}\n`);
    return {
      code: Number(fs.readFileSync(path.join(root, `${name}.exit`), "utf8")),
      out: fs.readFileSync(path.join(root, `${name}.out`), "utf8"),
    };
  }
  for (const [name, bytes] of cases) {
    fs.writeFileSync(file, bytes);
    if (name === "mode-000") fs.chmodSync(file, 0o000);
    let result;
    try { result = recorded(name, ["status"]); }
    finally { fs.chmodSync(file, 0o600); }
    assert.equal(result.code, 1, result.out);
    if (name === "missing-tools") {
      assert.ok(result.out.includes(`Sealed MCP route db: PENDING RESTART (${file})\n`), result.out);
      assert.match(result.out, /^  unknown: stored protection state has no protected tool list$/m);
      assert.match(result.out, /^  configured MCP servers not routed through this Seal wrapper: cache$/m);
      assert.match(result.out, /^Protection detail: stored protection state has no protected tool list$/m);
      assert.doesNotMatch(result.out, /BROKEN|cache, db/);
    } else {
      assert.match(result.out, /^Stored protection state: could not be read$/m);
      assert.match(result.out, /^Protected tool list: unreadable because the stored protection state could not be read$/m);
      assert.match(result.out, /^MCP routing: unknown because the stored protection state could not be read$/m);
      assert.doesNotMatch(result.out, /^Sealed MCP route|^Gated through this route:|^Not controlled:/m);
    }
    if (name === "incompatible-schema" || name === "wrong-schema") assert.match(result.out, /seal recover --archive/);
    else assert.doesNotMatch(result.out, /seal recover --archive/);
    assert.equal(fs.readFileSync(file, "utf8"), bytes);
    assert.equal(fs.readFileSync(fakeLocalOverridePath(root), "utf8"), override);
  }
  fs.writeFileSync(file, "garbage{");
  const malformed = recorded("recover-malformed", ["recover", "--archive"]);
  assert.equal(malformed.code, 1, malformed.out);
  assert.match(malformed.out, /state_broken/);
  assert.equal(fs.readFileSync(file, "utf8"), "garbage{");
  assert.equal(fs.readFileSync(fakeLocalOverridePath(root), "utf8"), override);
  const incompatible = cases[0][1];
  fs.writeFileSync(file, incompatible);
  const recovered = recorded("recover-incompatible-schema", ["recover", "--archive"]);
  assert.equal(recovered.code, 0, recovered.out);
  const archive = recovered.out.match(/^Archived incompatible protection state: (.+)$/m)?.[1];
  assert.ok(archive, recovered.out);
  assert.equal(fs.readFileSync(archive, "utf8"), incompatible);
  assert.equal(fs.existsSync(file), false);
  assert.equal(JSON.parse(fs.readFileSync(fakeLocalOverridePath(root))).projects[project].mcpServers.db, undefined);
  console.log(`Seven-state evidence: ${root}`);
});

function multiServerProject() {
  const root = testTmpdir("seal-multiserver-");
  const project = path.join(root, "project"), home = path.join(root, "home");
  fs.mkdirSync(project); fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = { ...process.env, HOME: home, XDG_DATA_HOME: path.join(home, ".local", "share"), PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  const servers = Object.fromEntries(["alpha", "beta"].map((name) => [name, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, `${name}.txt`)] }]));
  fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: servers }) + "\n");
  return { root, project, home, env };
}

async function multiServerProxy(ctx, name) {
  const file = statePathFor(ctx.project, ctx.env, name);
  const child = spawn(SEAL, ["__proxy", "--protect-state", file], { cwd: ctx.project, env: ctx.env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = ""; child.stderr.on("data", (bytes) => { stderr += bytes; });
  const messages = [], waiting = [];
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => { const value = JSON.parse(line); if (waiting.length) waiting.shift()(value); else messages.push(value); });
  const next = () => messages.length ? Promise.resolve(messages.shift()) : new Promise((resolve) => waiting.push(resolve));
  const send = (message) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  const closed = new Promise((resolve) => child.once("close", resolve));
  await waitForState(file, "ACTIVE", 5000);
  send({ id: 90, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { elicitation: {} } } });
  assert.equal((await next()).id, 90);
  return {
    async gatedCall() {
      const state = readState(file), before = fs.readdirSync(state.receiptsDir);
      send({ id: 1, method: "tools/call", params: { name: "demo.mutate", arguments: { line: "must not run" } } });
      const request = await next();
      assert.equal(request.method, "elicitation/create");
      assert.equal(request.params.message.split("\n")[4], `Route (configured, not authenticated): ${name}`);
      assert.equal(request.params.message.split("\n")[0], 'Tool: demo.mutate; Approval required');
      assert.equal(request.params.message.split("\n")[1], '  line: "must not run"');
      assert.equal(request.params.message.split("\n")[2], "Scope: this parsed call (key order, 1/1.0 match); at most one run; 2 min.");
      const { displayWidth, WIDTH_MARGIN } = require("../contract/renderer.cjs");
      for (const line of request.params.message.split("\n")) assert.ok(displayWidth(line) <= 80 - WIDTH_MARGIN);
      send({ id: request.id, result: { action: "decline" } });
      const result = await next();
      assert.equal(result.id, 1); assert.equal(result.result.isError, true);
      assert.match(result.result.content[0].text, /declined/);
      const receipts = fs.readdirSync(state.receiptsDir).filter((name) => !before.includes(name));
      assert.ok(receipts.length > 0, stderr);
      for (const receipt of receipts) assert.equal(JSON.parse(fs.readFileSync(path.join(state.receiptsDir, receipt))).verdict, "BLOCK");
      assert.equal(fs.readFileSync(path.join(ctx.root, `${name}.txt.count`), "utf8"), "0\n");
    },
    async close() { child.stdin.end(); assert.equal(await closed, 0, stderr); },
  };
}

test("multiple servers have independent state, simultaneous live gates and receipts; removing one preserves the other", async () => {
  const ctx = multiServerProject();
  const before = fs.readFileSync(path.join(ctx.project, ".mcp.json"));
  assert.equal(run(ctx.project, ctx.home, ["protect", "alpha", "demo.mutate"], ctx.env).code, 0);
  const firstFile = statePathFor(ctx.project, ctx.env, "alpha");
  const firstBytes = fs.readFileSync(firstFile);
  assert.match(firstFile, /\/servers\/alpha\/state.json$/);
  const single = run(ctx.project, ctx.home, ["status"], ctx.env);
  assert.match(single.out, /configured MCP servers not routed through this Seal wrapper: beta/);
  assert.equal(run(ctx.project, ctx.home, ["protect", "beta", "demo.mutate"], ctx.env).code, 0);
  assert.deepEqual(fs.readFileSync(firstFile), firstBytes);
  const secondFile = statePathFor(ctx.project, ctx.env, "beta");
  assert.notEqual(readState(firstFile).storePath, readState(secondFile).storePath);
  assert.notEqual(readState(firstFile).receiptsDir, readState(secondFile).receiptsDir);
  const duplicate = run(ctx.project, ctx.home, ["protect", "beta", "demo.erase"], ctx.env);
  assert.equal(duplicate.code, 1); assert.match(duplicate.out, /server "beta" is already PENDING RESTART/);
  const alpha = await multiServerProxy(ctx, "alpha");
  const beta = await multiServerProxy(ctx, "beta");
  try {
    const status = run(ctx.project, ctx.home, ["status"], ctx.env);
    assert.equal(status.code, 0, status.out);
    assert.match(status.out, /Sealed MCP route alpha: LEASE ACTIVE/);
    assert.match(status.out, /Sealed MCP route beta: LEASE ACTIVE/);
    await Promise.all([alpha.gatedCall(), beta.gatedCall()]);
    await alpha.close();
    assert.equal(run(ctx.project, ctx.home, ["unprotect", "alpha"], ctx.env).code, 0);
    assert.equal(readState(firstFile).state, "UNPROTECTED");
    assert.equal(readState(secondFile).state, "ACTIVE");
    const overrides = JSON.parse(fs.readFileSync(fakeLocalOverridePath(ctx.root))).projects[ctx.project].mcpServers;
    assert.equal(overrides.alpha, undefined); assert.ok(overrides.beta);
    await beta.gatedCall();
  } finally { await beta.close(); }
  assert.deepEqual(fs.readFileSync(path.join(ctx.project, ".mcp.json")), before);
});

test("legacy state remains authoritative alongside a new server, including its installed override and gated call", async () => {
  const ctx = multiServerProject();
  assert.equal(run(ctx.project, ctx.home, ["protect", "alpha", "demo.mutate"], ctx.env).code, 0);
  const route = statePathFor(ctx.project, ctx.env, "alpha");
  const legacy = path.join(require("../spine/protection.cjs").projectDirectory(ctx.project, ctx.env), "state.json");
  const state = readState(route);
  state.localOverride.definition.args = ["__proxy", "--protect-state", legacy];
  fs.writeFileSync(route, JSON.stringify(state) + "\n");
  fs.renameSync(route, legacy);
  const configPath = fakeLocalOverridePath(ctx.root), config = JSON.parse(fs.readFileSync(configPath));
  config.projects[ctx.project].mcpServers.alpha.args = state.localOverride.definition.args;
  fs.writeFileSync(configPath, JSON.stringify(config) + "\n");
  const bytes = fs.readFileSync(legacy);
  assert.equal(run(ctx.project, ctx.home, ["status"], ctx.env).code, 0);
  assert.deepEqual(fs.readFileSync(legacy), bytes, "compatibility read must not rewrite a legacy record");
  assert.equal(run(ctx.project, ctx.home, ["protect", "beta", "demo.mutate"], ctx.env).code, 0);
  assert.equal(statePathFor(ctx.project, ctx.env, "alpha"), legacy);
  assert.deepEqual(fs.readFileSync(legacy), bytes);
  const proxy = await multiServerProxy(ctx, "alpha");
  try { await proxy.gatedCall(); } finally { await proxy.close(); }
  const missing = { ...ctx.env, XDG_DATA_HOME: path.join(ctx.root, "missing") };
  assert.match(execFileSync(SEAL, ["status"], { cwd: ctx.project, env: missing, encoding: "utf8" }), /Sealed MCP route: - outside Seal/);
  assert.match(run(ctx.project, ctx.home, ["status"], ctx.env).out, /Sealed MCP route alpha: STALE/);
});

test("the project lock refuses a concurrent operation on another server without changing either route", () => {
  const ctx = multiServerProject();
  assert.equal(run(ctx.project, ctx.home, ["protect", "alpha", "demo.mutate"], ctx.env).code, 0);
  const file = statePathFor(ctx.project, ctx.env, "alpha"), before = fs.readFileSync(file);
  const lock = require("../spine/protection.cjs").acquireProjectLock(ctx.project, ctx.env);
  try {
    const other = run(ctx.project, ctx.home, ["protect", "beta", "demo.mutate"], ctx.env);
    assert.equal(other.code, 1); assert.match(other.out, /proxy_lease_active/);
    assert.match(other.out, new RegExp(`project lock held by pid ${process.pid} for another Seal operation on this project; retry after that operation finishes`));
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal(fs.existsSync(statePathFor(ctx.project, ctx.env, "beta")), false);
  } finally { lock.release(); }
  assert.equal(run(ctx.project, ctx.home, ["protect", "beta", "demo.mutate"], ctx.env).code, 0);
});

test("server storage names cannot traverse directories or collide through encoding", () => {
  const ctx = multiServerProject();
  const { projectDirectory } = require("../spine/protection.cjs");
  const base = path.join(projectDirectory(ctx.project, ctx.env), "servers");
  const files = ["..", "../alpha", "alpha/beta", "alpha%2Fbeta"].map((name) => statePathFor(ctx.project, ctx.env, name));
  assert.equal(new Set(files).size, 4);
  for (const file of files) assert.equal(path.dirname(path.dirname(file)), base);
});

test("status continues past a broken server record and server-selected recovery preserves the other record", () => {
  const ctx = multiServerProject();
  for (const name of ["alpha", "beta"]) assert.equal(run(ctx.project, ctx.home, ["protect", name, "demo.mutate"], ctx.env).code, 0);
  const alpha = statePathFor(ctx.project, ctx.env, "alpha"), beta = statePathFor(ctx.project, ctx.env, "beta");
  const original = readState(alpha), survivor = fs.readFileSync(beta);
  fs.writeFileSync(alpha, JSON.stringify({ ...original, schema: "seal.protect/future" }) + "\n");
  const status = run(ctx.project, ctx.home, ["status"], ctx.env);
  assert.equal(status.code, 1); assert.match(status.out, /Stored protection state: could not be read/);
  assert.match(status.out, /Sealed MCP route beta: PENDING RESTART/);
  const ambiguous = run(ctx.project, ctx.home, ["recover", "--archive"], ctx.env);
  assert.equal(ambiguous.code, 1); assert.match(ambiguous.out, /server_required/);
  const recovered = run(ctx.project, ctx.home, ["recover", "--archive", "alpha"], ctx.env);
  assert.equal(recovered.code, 0, recovered.out);
  assert.deepEqual(fs.readFileSync(beta), survivor);
  assert.equal(fs.existsSync(alpha), false);
});

test("F03 expands project launch fields and binds resolved values to drift", () => {
  const root = testTmpdir("seal-expansion-");
  const { readProjectServer } = require("../spine/protection.cjs");
  writeProject(root, { command: "${SEAL_EXP_CMD}", args: ["${SEAL_EXP_ARG}", "${SEAL_EXP_UNSET:-fallback}"], env: { TOKEN: "${SEAL_EXP_TOKEN}" } });
  const env = { SEAL_EXP_CMD: process.execPath, SEAL_EXP_ARG: "argument", SEAL_EXP_TOKEN: "token" };
  const resolved = readProjectServer(root, "db", env);
  assert.deepEqual(resolved.childArgv, [process.execPath, "argument", "fallback"]);
  assert.deepEqual(resolved.childEnv, { TOKEN: "token" });
  assert.notEqual(readProjectServer(root, "db", { ...env, SEAL_EXP_TOKEN: "changed" }).serverDigest, resolved.serverDigest);
  assert.throws(() => readProjectServer(root, "db", {}), { code: "project_environment_missing" });
});

function lifecycleContext() {
  const root = testTmpdir("seal-lifecycle-");
  const project = path.join(root, "project"), home = path.join(root, "home");
  fs.mkdirSync(project); fs.mkdirSync(home);
  const env = { PATH: `${fakeClaudeBin(root)}${path.delimiter}${process.env.PATH}` };
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "data.txt")] });
  return { root, project, home, env };
}

test("F04 failed absent installation permits protect retry", () => {
  const { project, home, env } = lifecycleContext();
  const failed = run(project, home, ["protect", "db", "demo.mutate"], { ...env, SEAL_TEST_CLAUDE_ADD_FAIL: "1" });
  assert.match(failed.out, /claude_install_failed/);
  const retry = run(project, home, ["protect", "db", "demo.mutate"], env);
  assert.equal(retry.code, 0, retry.out);
  assert.equal(run(project, home, ["unprotect", "db"], env).code, 0);
});

for (const source of ["absent", "invalid"]) test(`F05 unprotect tolerates ${source} project source`, () => {
  const { root, project, home, env } = lifecycleContext();
  const protectedRun = run(project, home, ["protect", "db", "demo.mutate"], env);
  assert.equal(protectedRun.code, 0, protectedRun.out);
  const file = path.join(project, ".mcp.json");
  if (source === "absent") fs.unlinkSync(file); else fs.writeFileSync(file, "{invalid");
  const result = run(project, home, ["unprotect", "db"], env);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, new RegExp(`Project .mcp.json source before unprotect: ${source}`));
  assert.equal(JSON.parse(fs.readFileSync(fakeLocalOverridePath(root))).projects[project].mcpServers.db, undefined);
  if (source === "absent") assert.equal(fs.existsSync(file), false);
  else assert.equal(fs.readFileSync(file, "utf8"), "{invalid");
});

test("F04 partial installation retains ownership and supports cleanup before retry", () => {
  const { project, home, env } = lifecycleContext();
  const failed = run(project, home, ["protect", "db", "demo.mutate"], { ...env, SEAL_TEST_CLAUDE_PARTIAL: "1" });
  assert.match(failed.out, /claude_install_failed/);
  const statePath = statePathFor(project, { XDG_DATA_HOME: path.join(home, ".local/share") });
  assert.equal(readState(statePath).localOverride.installed, true);
  // Also recover a historical partial install whose record never observed success.
  const state = readState(statePath);
  state.localOverride.installed = false;
  fs.writeFileSync(statePath, JSON.stringify(state));
  const cleanup = run(project, home, ["unprotect", "db"], env);
  assert.equal(cleanup.code, 0, cleanup.out);
  assert.equal(run(project, home, ["protect", "db", "demo.mutate"], env).code, 0);
});

test("F04 failed installation refuses a foreign override and a live lease", () => {
  const { root, project, home, env } = lifecycleContext();
  assert.match(run(project, home, ["protect", "db", "demo.mutate"], { ...env, SEAL_TEST_CLAUDE_ADD_FAIL: "1" }).out, /claude_install_failed/);
  const statePath = statePathFor(project, { XDG_DATA_HOME: path.join(home, ".local/share") });
  const original = readState(statePath);
  fs.writeFileSync(statePath, JSON.stringify({ ...original, lease: { pid: process.pid, startWitness: processStartWitness(process.pid), generation: 1 } }));
  assert.match(run(project, home, ["protect", "db", "demo.mutate"], env).out, /proxy_lease_active/);
  fs.writeFileSync(statePath, JSON.stringify(original));
  const configPath = fakeLocalOverridePath(root);
  const foreign = JSON.stringify({ projects: { [project]: { mcpServers: { db: { command: "foreign", args: [] } } } } });
  fs.writeFileSync(configPath, foreign);
  assert.match(run(project, home, ["protect", "db", "demo.mutate"], env).out, /already_protected/);
  assert.match(run(project, home, ["unprotect", "db"], env).out, /local_override_drifted/);
  assert.equal(fs.readFileSync(configPath, "utf8"), foreign);
});

test("F03 expansion uses set empty values, one pass, and refuses unsupported syntax", () => {
  const root = testTmpdir("seal-expansion-boundaries-");
  const { readProjectServer } = require("../spine/protection.cjs");
  writeProject(root, { command: "node", args: ["${EMPTY:-fallback}", "${UNSET:-}", "${VALUE}"], env: { VALUE: "sibling" } });
  assert.deepEqual(readProjectServer(root, "db", { EMPTY: "", VALUE: "${LITERAL}" }).childArgv, ["node", "", "", "${LITERAL}"]);
  writeProject(root, { command: "${VALUE:+other}" });
  assert.throws(() => readProjectServer(root, "db", { VALUE: "set" }), { code: "project_environment_unsupported" });
});

test("F03 protect discovers expanded launch and activation refuses changed resolution", async () => {
  const { project, home, env, root } = lifecycleContext();
  writeProject(project, { command: "${SEAL_LIFECYCLE_NODE}", args: ["${SEAL_LIFECYCLE_BIN}", "__demo-server", "${SEAL_LIFECYCLE_DATA}"], env: { TOKEN: "${SEAL_LIFECYCLE_TOKEN:-default}" } });
  const launchEnv = { ...env, SEAL_LIFECYCLE_NODE: process.execPath, SEAL_LIFECYCLE_BIN: SEAL, SEAL_LIFECYCLE_DATA: path.join(root, "data.txt") };
  const result = run(project, home, ["protect", "db", "demo.mutate"], launchEnv);
  assert.equal(result.code, 0, result.out);
  const statePath = statePathFor(project, { XDG_DATA_HOME: path.join(home, ".local/share") });
  const state = readState(statePath);
  assert.deepEqual(state.childArgv, [process.execPath, SEAL, "__demo-server", path.join(root, "data.txt")]);
  assert.deepEqual(state.childEnv, { TOKEN: "default" });
  const { activationLease } = require("../spine/protection.cjs");
  await assert.rejects(activationLease(statePath, { ...process.env, ...launchEnv, HOME: home, XDG_DATA_HOME: path.join(home, ".local/share"), SEAL_LIFECYCLE_TOKEN: "changed" }), { code: "drifted" });
  assert.equal(readState(statePath).state, "DRIFTED");
});

test("F05 missing source does not bypass live lease or ownership refusal", () => {
  const { root, project, home, env } = lifecycleContext();
  assert.equal(run(project, home, ["protect", "db", "demo.mutate"], env).code, 0);
  fs.unlinkSync(path.join(project, ".mcp.json"));
  const statePath = statePathFor(project, { XDG_DATA_HOME: path.join(home, ".local/share") });
  const state = readState(statePath);
  fs.writeFileSync(statePath, JSON.stringify({ ...state, lease: { pid: process.pid, startWitness: processStartWitness(process.pid), generation: 1 } }));
  const configPath = fakeLocalOverridePath(root);
  const before = fs.readFileSync(configPath, "utf8");
  assert.match(run(project, home, ["unprotect", "db"], env).out, /active_claude_session/);
  assert.equal(fs.readFileSync(configPath, "utf8"), before);
  fs.writeFileSync(statePath, JSON.stringify(state));
  const config = JSON.parse(before);
  config.projects[project].mcpServers.db.command = "foreign";
  fs.writeFileSync(configPath, JSON.stringify(config));
  const foreign = fs.readFileSync(configPath, "utf8");
  assert.match(run(project, home, ["unprotect", "db"], env).out, /local_override_drifted/);
  assert.equal(fs.readFileSync(configPath, "utf8"), foreign);
});

test("initialize observations are unsigned, session-local and absent for malformed clientInfo", { timeout: 20000 }, async (t) => {
  const root = testTmpdir("seal-observed-client-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  execFileSync("git", ["init", "--quiet", project]);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    HOME: home, CLAUDE_CONFIG_DIR: home, XDG_DATA_HOME: path.join(home, ".local", "share") };
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "data.txt")] });
  const installed = run(project, home, ["protect", "db", "demo.mutate"], env);
  assert.equal(installed.code, 0, installed.out);
  const statePath = statePathFor(project, env);
  const observe = (command) => {
    const result = run(project, home, [command], env);
    assert.equal(result.code, 0, result.out);
    return withoutObservationTime(result.out);
  };
  for (const command of ["status", "coverage"]) assert.doesNotMatch(observe(command), /Observed client:|Elicitation declared:/);
  let child;
  let closed;
  let lines;
  const start = async () => {
    child = spawn(SEAL, ["__proxy", "--protect-state", statePath], { cwd: project, env, stdio: ["pipe", "pipe", "pipe"] });
    closed = new Promise((resolve) => child.once("close", resolve));
    child.stderr.resume();
    lines = readline.createInterface({ input: child.stdout });
    // The previous session's ACTIVE record may still be on disk.
    for (let i = 0; i < 500 && readState(statePath)?.lease?.pid !== child.pid; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(readState(statePath).lease.pid, child.pid);
  };
  const stop = async () => { child.stdin.end(); assert.equal(await closed, 0); lines.close(); };
  let id = 0;
  const initialize = async (params) => {
    const response = new Promise((resolve) => lines.once("line", (line) => resolve(JSON.parse(line))));
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "initialize", params: { protocolVersion: "2025-06-18", ...params } }) + "\n");
    assert.equal((await response).id, id);
  };
  try {
    await start();
    const baseline = Object.fromEntries(["status", "coverage"].map((command) => [command, observe(command)]));
    const info = { name: "codex-cli", version: "1.2.3" };
    await initialize({ clientInfo: info, capabilities: { elicitation: {} } });
    assert.deepEqual(readState(statePath).observedClient, { ...info, elicitationDeclared: true });
    const extra = "Observed client: codex-cli 1.2.3 (self-asserted, unsigned)\nElicitation declared: yes\n";
    for (const command of ["status", "coverage"]) {
      const output = observe(command);
      assert.ok(output.includes(extra), output);
      assert.equal(output.replace(extra, ""), baseline[command]);
      t.diagnostic(`${command}, valid initialize:\n${output}`);
    }
    const unsafe = "\u2028\u2029\u202e\u2060\u200c\u200d\ufe0f\n\u001b";
    const escaped = "\\u2028\\u2029\\u202e\\u2060\\u200c\\u200d\\ufe0f\\u000a\\u001b";
    await initialize({ clientInfo: { name: `client${unsafe}`, version: `version${unsafe}` }, capabilities: {} });
    const escapedExtra = `Observed client: client${escaped} version${escaped} (self-asserted, unsigned)\nElicitation declared: no\n`;
    for (const command of ["status", "coverage"]) {
      const output = observe(command);
      assert.ok(output.includes(escapedExtra), `${command} must escape U+2028 and other invisible client characters: ${output}`);
      assert.equal(output.replace(escapedExtra, ""), baseline[command]);
    }
    for (const params of [{ capabilities: {} }, { clientInfo: "malformed", capabilities: {} }, { clientInfo: { name: 42, version: "1" } }, { clientInfo: [] }]) {
      await initialize(params);
      assert.equal(Object.hasOwn(readState(statePath), "observedClient"), false);
      for (const command of ["status", "coverage"]) {
        const output = observe(command);
        assert.equal(output, baseline[command]);
        t.diagnostic(`${command}, ${JSON.stringify(params)}: byte-identical to pre-initialize output (observation time normalized)`);
      }
    }
    await initialize({ clientInfo: info, capabilities: {} });
    for (const command of ["status", "coverage"]) assert.match(observe(command), /^Elicitation declared: no$/m);
    await stop();
    await start();
    assert.equal(Object.hasOwn(readState(statePath), "observedClient"), false);
    for (const command of ["status", "coverage"]) assert.doesNotMatch(observe(command), /Observed client:|Elicitation declared:/);
    await stop();
  } finally {
    if (child && child.exitCode === null) { child.kill(); await closed; }
    lines?.close();
  }
});

test("attacker-sized identity is bounded in storage and both status surfaces", { timeout: 60000 }, async (t) => {
  const root = testTmpdir("seal-observed-client-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  execFileSync("git", ["init", "--quiet", project]);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    HOME: home, CLAUDE_CONFIG_DIR: home, XDG_DATA_HOME: path.join(home, ".local", "share") };
  writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", path.join(root, "data.txt")] });
  const installed = run(project, home, ["protect", "db", "demo.mutate"], env);
  assert.equal(installed.code, 0, installed.out);
  const statePath = statePathFor(project, env);
  const observe = (command) => {
    const result = run(project, home, [command], env);
    assert.equal(result.code, 0, result.out);
    return withoutObservationTime(result.out);
  };
  for (const command of ["status", "coverage"]) assert.doesNotMatch(observe(command), /Observed client:|Elicitation declared:/);
  let child;
  let closed;
  let lines;
  const start = async () => {
    child = spawn(SEAL, ["__proxy", "--protect-state", statePath], { cwd: project, env, stdio: ["pipe", "pipe", "pipe"] });
    closed = new Promise((resolve) => child.once("close", resolve));
    child.stderr.resume();
    lines = readline.createInterface({ input: child.stdout });
    // The previous session's ACTIVE record may still be on disk.
    for (let i = 0; i < 500 && readState(statePath)?.lease?.pid !== child.pid; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(readState(statePath).lease.pid, child.pid);
  };
  const stop = async () => { child.stdin.end(); assert.equal(await closed, 0); lines.close(); };
  let id = 0;
  const initialize = async (params) => {
    const response = new Promise((resolve) => lines.once("line", (line) => resolve(JSON.parse(line))));
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "initialize", params: { protocolVersion: "2025-06-18", ...params } }) + "\n");
    assert.equal((await response).id, id);
  };
  try {
    await start();
    const baseline = Object.fromEntries(["status", "coverage"].map((command) => [command, observe(command)]));
    const failures = [];
    const marker = "...[truncated]";
    const budget = 128 - Buffer.byteLength(marker);
    const cases = [
      ["ascii attack", "N".repeat(10240), "V".repeat(20480), "N".repeat(budget) + marker, "V".repeat(budget) + marker],
      ["unicode attack", "😀".repeat(4096), "é".repeat(8192), "😀".repeat(Math.floor(budget / 4)) + marker, "é".repeat(Math.floor(budget / 2)) + marker],
      ["below bound", "n".repeat(127), "v".repeat(127), "n".repeat(127), "v".repeat(127)],
      ["at bound", "é".repeat(64), "v".repeat(128), "é".repeat(64), "v".repeat(128)],
      ["above bound", "n".repeat(129), "v".repeat(129), "n".repeat(budget) + marker, "v".repeat(budget) + marker],
      ["escape expansion", "\u001b".repeat(10240), "\n".repeat(10240)],
    ];
    const check = (ok, message) => { if (!ok) failures.push(message); };
    for (const [label, name, version, expectedName, expectedVersion] of cases) {
      await initialize({ clientInfo: { name, version }, capabilities: {} });
      const stored = readState(statePath).observedClient;
      for (const field of ["name", "version"]) {
        check(Buffer.byteLength(stored[field]) <= 128, `${label}: persisted ${field} exceeds 128 bytes`);
        check(!stored[field].includes("\ufffd"), `${label}: split Unicode in ${field}`);
      }
      if (expectedName !== undefined) {
        check(stored.name === expectedName && stored.version === expectedVersion, `${label}: persisted identity or marker differs`);
      }
      // Also plant a pre-fix state record: rendering must bound existing data
      // independently of the initialize/persistence path.
      for (const source of ["initialize", "legacy state"]) {
        if (source === "legacy state") {
          const state = readState(statePath);
          state.observedClient = { name, version, elicitationDeclared: false };
          fs.writeFileSync(statePath, JSON.stringify(state));
        }
        for (const command of ["status", "coverage"]) {
          const output = observe(command);
          const line = output.split("\n").find((line) => line.startsWith("Observed client: "));
          const overhead = Buffer.byteLength("Observed client:   (self-asserted, unsigned)");
          check(!!line && Buffer.byteLength(line) <= overhead + 256, `${label}/${source}: ${command} exceeds two 128-byte fields`);
          if (expectedName !== undefined) {
            check(line === `Observed client: ${expectedName} ${expectedVersion} (self-asserted, unsigned)`, `${label}/${source}: ${command} identity or marker differs`);
          } else {
            check(line?.includes(marker), `${label}/${source}: ${command} lacks truncation marker`);
          }
          const observation = `${line}\nElicitation declared: no\n`;
          check(output.replace(observation, "") === baseline[command], `${label}/${source}: ${command} injected extra output`);
          t.diagnostic(`${label}/${source}/${command}: observed line ${Buffer.byteLength(line || "")} bytes`);
        }
      }
    }
    assert.deepEqual(failures, []);
    await stop();
  } finally {
    if (child && child.exitCode === null) { child.kill(); await closed; }
    lines?.close();
  }
});
