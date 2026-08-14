const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const readline = require("node:readline");
const test = require("node:test");

const SEAL = path.join(__dirname, "../bin/seal");
const { statePathFor, readState } = require("../spine/protection.cjs");

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

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
function key(name) { return crypto.createHash("sha256").update(cwd).digest("hex").slice(0, 16) + "-" + name + ".json"; }
function localPath(name) { const dir = path.join(home, ".claude-local"); fs.mkdirSync(dir, { recursive: true }); return path.join(dir, key(name)); }
function projectHas(name) {
  try { return !!JSON.parse(fs.readFileSync(path.join(cwd, ".mcp.json"), "utf8")).mcpServers[name]; } catch { return false; }
}
if (args[0] !== "mcp") process.exit(2);
if (args[1] === "get") {
  const name = args[2];
  if (fs.existsSync(localPath(name))) {
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
  const split = args.indexOf("--");
  fs.writeFileSync(localPath(name), JSON.stringify({ command: args[split + 1], args: args.slice(split + 2) }));
  console.log("Added stdio MCP server " + name + " to local config");
  process.exit(0);
}
if (args[1] === "remove") {
  const name = args[4];
  try { fs.unlinkSync(localPath(name)); } catch {}
  console.log("Removed MCP server " + name + " from local config");
  process.exit(0);
}
process.exit(2);
`);
  fs.chmodSync(script, 0o755);
  return bin;
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
  const root = tmpdir("seal-protect3b-hash-");
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

test("protect names install-time refusals", () => {
  const root = tmpdir("seal-protect3b-refusals-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };

  let result = run(project, home, ["protect", "db", "demo.mutate"], env);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /project_server_absent/);

  fs.writeFileSync(path.join(project, ".mcp.json"), "{not-json\n");
  result = run(project, home, ["protect", "db", "demo.mutate"], env);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /project_server_invalid/);

  writeProject(project, { type: "http", url: "https://example.invalid/mcp" });
  result = run(project, home, ["protect", "db", "demo.mutate"], env);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /project_server_non_stdio/);

  writeProject(project, { command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] });
  execFileSync("claude", ["mcp", "add", "--scope", "local", "db", "--", "node", "-e", "process.exit(0)"], {
    cwd: project,
    env: { ...process.env, ...env, HOME: home },
  });
  result = run(project, home, ["protect", "db", "demo.mutate"], env);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /local_override_exists/);

  const incompatibleProject = path.join(root, "incompatible-project");
  fs.mkdirSync(incompatibleProject);
  writeProject(incompatibleProject, { command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] });
  const incompatibleState = statePathFor(incompatibleProject, { XDG_DATA_HOME: path.join(home, ".local", "share") });
  fs.mkdirSync(path.dirname(incompatibleState), { recursive: true });
  fs.writeFileSync(incompatibleState, JSON.stringify({ schema: "seal.protect/v1", sealVersion: "0.0.0", state: "PENDING RESTART" }));
  result = run(incompatibleProject, home, ["protect", "db", "demo.mutate"], env);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /incompatible_state/);
});

test("proxy activation promotes pending, and live project drift refuses before child delivery", async () => {
  const root = tmpdir("seal-protect3b-drift-");
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
    proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "demo.mutate", arguments: { line: "held" } } }) + "\n");
    const opened = await nextLine();
    assert.equal(opened.result.resultType, "input_required");

    writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", dataFile, "--drifted"] });
    proxy.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "demo.mutate",
        arguments: { line: "held" },
        requestState: opened.result.requestState,
        inputResponses: { approval: { action: "accept", content: { approve: true } } },
      },
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
  const root = tmpdir("seal-protect3b-active-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const fakeBin = fakeClaudeBin(root);
  const env = { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  writeProject(project, { command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] });
  assert.equal(run(project, home, ["protect", "db", "demo.mutate"], env).code, 0);
  const statePath = statePathFor(project, { XDG_DATA_HOME: path.join(home, ".local", "share") });
  const state = readState(statePath);
  fs.writeFileSync(statePath, JSON.stringify({ ...state, state: "ACTIVE", lease: { pid: process.pid } }, null, 2));

  const result = run(project, home, ["unprotect", "db"], env);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /active_claude_session/);
});

test("status and doctor use outside-Seal and assumption/refusal language", () => {
  const root = tmpdir("seal-protect3b-doctor-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);

  const status = run(project, home, ["status"]);
  assert.equal(status.code, 0);
  assert.match(status.out, /^Protection: - outside Seal$/m);
  assert.doesNotMatch(status.out, /unprotected/i);

  const doctor = run(project, home, ["doctor"]);
  assert.equal(doctor.code, 0);
  assert.match(doctor.out, /^ASSUMPTION$/m);
  assert.match(doctor.out, /Claude Code presents approval requests to a human and faithfully returns\n  the response/);
  assert.match(doctor.out, /✓ No elicitation auto-response hooks detected/);

  const refused = run(project, home, ["doctor"], { SEAL_ELICITATION_AUTO_RESPONSE: "accept" });
  assert.notEqual(refused.code, 0);
  assert.match(refused.out, /^REFUSED$/m);
  assert.match(refused.out, /Human approval origin cannot be assumed/);
});
