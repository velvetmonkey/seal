const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
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
  fs.writeFileSync(incompatibleState, JSON.stringify({ schema: "seal.protect/v1", sealVersion: "0.0.0", state: "PENDING RESTART" }));
  result = run(incompatibleProject, home, ["protect", "db", "demo.mutate"], env);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /incompatible_state/);
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
  const proxy = spawn(SEAL, ["__proxy", "--protect-state", statePath], { cwd: project, env, stdio: ["pipe", "pipe", "pipe"] });
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
    assert.doesNotMatch(result.out, /^Sealed MCP route .*: (?:PENDING RESTART|ACTIVE) /m);
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
  assert.doesNotMatch(status.out, /^Sealed MCP route .*: ACTIVE /m);
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
  assert.doesNotMatch(status.out, /^Sealed MCP route .*: ACTIVE /m);
});
