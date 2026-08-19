// SPDX-License-Identifier: Apache-2.0
// Roadmap step 5 — ordinary failure modes, driven on disk.
// Each case makes the condition real, then proves: named refusal (or
// works-by-design), child count did not move, .mcp.json bytes unchanged
// by the refusal.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn, spawnSync } = require("node:child_process");
const readline = require("node:readline");
const test = require("node:test");

const SEAL = path.join(__dirname, "../bin/seal");
const { processStartWitness, statePathFor, readState } = require("../spine/protection.cjs");
const { tmpdir, track } = require("../test-support/tmpdir.cjs");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
function countOf(dataFile) {
  const file = `${dataFile}.count`;
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "ABSENT";
}
function writeProject(project, server) {
  const body = JSON.stringify({ mcpServers: { db: server } }, null, 2) + "\n";
  fs.writeFileSync(path.join(project, ".mcp.json"), body);
  return body;
}
function fakeClaudeBin(root) {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "claude"), `#!/usr/bin/env node
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
	  if (localServer(name)) { console.log(name + ":\\n  Scope: Local config (private to you in this project)\\n  Type: stdio"); process.exit(0); }
  if (projectHas(name)) { console.log(name + ":\\n  Scope: Project config (shared via .mcp.json)\\n  Type: stdio"); process.exit(0); }
  process.exit(1);
}
if (args[1] === "add") {
	  const name = args[4];
	  const split = args.indexOf("--");
	  const config = readConfig();
	  config.projects ||= {};
	  config.projects[cwd] ||= {};
	  config.projects[cwd].mcpServers ||= {};
	  config.projects[cwd].mcpServers[name] = { type: "stdio", command: args[split + 1], args: args.slice(split + 2), env: {} };
	  writeConfig(config);
	  process.exit(0);
	}
	if (args[1] === "remove") {
	  const config = readConfig();
	  if (config.projects?.[cwd]?.mcpServers?.[args[4]]) delete config.projects[cwd].mcpServers[args[4]];
	  writeConfig(config);
  process.exit(0);
}
process.exit(2);
`, { mode: 0o755 });
  return bin;
}
function setup(prefix) {
  const root = tmpdir(prefix);
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const dataFile = path.join(root, "data.txt");
  fs.writeFileSync(dataFile, "");
  fs.writeFileSync(`${dataFile}.count`, "0\n");
  const fakeBin = fakeClaudeBin(root);
  const env = {
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
    HOME: home,
    XDG_DATA_HOME: path.join(home, ".local", "share"),
  };
  const mcp = writeProject(project, { command: process.execPath, args: [SEAL, "__demo-server", dataFile] });
  return { root, project, home, dataFile, fakeBin, env, mcp, mcpPath: path.join(project, ".mcp.json") };
}
function runSeal(ctx, args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [SEAL, ...args], {
    cwd: ctx.project,
    env: { ...process.env, ...ctx.env, ...extraEnv },
    encoding: "utf8",
  });
  return { code: result.status, out: `${result.stdout || ""}${result.stderr || ""}`, stdout: result.stdout || "", stderr: result.stderr || "" };
}
function snapshot(ctx) {
  return { mcp: sha256(fs.readFileSync(ctx.mcpPath)), count: countOf(ctx.dataFile) };
}
function assertUntouched(ctx, before, label) {
  const after = snapshot(ctx);
  assert.equal(after.mcp, before.mcp, `${label}: .mcp.json changed`);
  assert.equal(after.count, before.count, `${label}: child count moved (${before.count} -> ${after.count})`);
}

async function withProxy(ctx, fn) {
  const statePath = statePathFor(ctx.project, ctx.env);
  const proxy = spawn(process.execPath, [SEAL, "__proxy", "--protect-state", statePath], {
    cwd: ctx.project,
    env: { ...process.env, ...ctx.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const responses = [];
  let buf = "";
  proxy.stdout.setEncoding("utf8");
  proxy.stdout.on("data", (chunk) => {
    buf += chunk;
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) if (line.trim()) {
      try { responses.push(JSON.parse(line)); } catch { /* ignore banner */ }
    }
  });
  const wait = (id, ms = 8000) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const hit = responses.find((r) => r.id === id);
      if (hit) { clearInterval(iv); resolve(hit); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error(`no response ${id}: ${buf}`)); }
    }, 15);
  });
  const send = (obj) => proxy.stdin.write(JSON.stringify(obj) + "\n");
  try {
    return await fn({ proxy, send, wait, responses, statePath });
  } finally {
    try { proxy.stdin.end(); } catch {}
    await new Promise((resolve) => proxy.once("close", resolve));
  }
}

test("1 branch drift: named refusal, no forward, .mcp.json untouched by the refusal", () => {
  const ctx = setup("f5-branch-");
  assert.equal(runSeal(ctx, ["protect", "db", "demo.mutate"]).code, 0);
  // Simulate checking out a branch whose .mcp.json names a different server.
  writeProject(ctx.project, { command: process.execPath, args: [SEAL, "__demo-server", ctx.dataFile, "--other-branch"] });
  const before = snapshot(ctx);
  const started = spawnSync(process.execPath, [SEAL, "__proxy", "--protect-state", statePathFor(ctx.project, ctx.env)], {
    cwd: ctx.project, env: { ...process.env, ...ctx.env }, encoding: "utf8", input: "",
  });
  assert.notEqual(started.status, 0);
  assert.match(`${started.stderr}${started.stdout}`, /drifted/);
  assertUntouched(ctx, before, "branch drift");
});

test("2 manual edit of .mcp.json: same detector, named project_server_drifted on a live call", async () => {
  const ctx = setup("f5-edit-");
  assert.equal(runSeal(ctx, ["protect", "db", "demo.mutate"]).code, 0);
  await withProxy(ctx, async ({ send, wait }) => {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await wait(1);
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "demo.mutate", arguments: { line: "held" } } });
    const opened = await wait(2);
    assert.equal(opened.result.resultType, "input_required");
    writeProject(ctx.project, { command: process.execPath, args: [SEAL, "__demo-server", ctx.dataFile, "--hand-edit"] });
    const before = snapshot(ctx);
    send({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: {
        name: "demo.mutate", arguments: { line: "held" },
        requestState: opened.result.requestState,
        inputResponses: { approval: { action: "accept", content: { approve: true } } },
      },
    });
    const refused = await wait(3);
    assert.match(refused.result.content[0].text, /project_server_drifted/);
    assert.equal(countOf(ctx.dataFile), "0");
    assert.equal(sha256(fs.readFileSync(ctx.mcpPath)), before.mcp);
  });
});

test("3 pre-existing overlay: local_override_exists, no .mcp.json write", () => {
  const ctx = setup("f5-overlay-");
  execFileSync("claude", ["mcp", "add", "--scope", "local", "db", "--", "node", "-e", "process.exit(0)"], {
    cwd: ctx.project, env: { ...process.env, ...ctx.env },
  });
  const before = snapshot(ctx);
  const result = runSeal(ctx, ["protect", "db", "demo.mutate"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /local_override_exists/);
  assertUntouched(ctx, before, "pre-existing overlay");
});

test("4a deleted overlay binary: no fallback, child count does not move", () => {
  const ctx = setup("f5-gone-overlay-");
  assert.equal(runSeal(ctx, ["protect", "db", "demo.mutate"]).code, 0);
  const configPath = path.join(ctx.home, ".claude.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const rec = config.projects[ctx.project].mcpServers.db;
  const gone = path.join(ctx.root, "seal-was-here");
  fs.writeFileSync(gone, "#!/usr/bin/env node\n");
  fs.chmodSync(gone, 0o755);
  rec.command = gone;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  fs.unlinkSync(gone);
  const before = snapshot(ctx);
  const attempt = spawnSync(process.execPath, [gone, ...(rec.args || [])], { encoding: "utf8" });
  assert.notEqual(attempt.status, 0);
  assert.match(`${attempt.stderr || ""}${attempt.stdout || ""}`, /Cannot find module|ENOENT|MODULE_NOT_FOUND/);
  assert.equal(countOf(ctx.dataFile), "0");
  assert.equal(sha256(fs.readFileSync(ctx.mcpPath)), before.mcp);
});

test("4b missing protected-server binary: protect refuses before recording state", () => {
  const ctx = setup("f5-gone-child-");
  const missing = path.join(ctx.root, "no-such-server");
  writeProject(ctx.project, { command: missing, args: ["--stdio"] });
  const before = snapshot(ctx);
  const protect = runSeal(ctx, ["protect", "db", "demo.mutate"]);
  assert.notEqual(protect.code, 0);
  assert.match(protect.out, /protected_server_start_failed/);
  assert.doesNotMatch(protect.out, /PENDING RESTART/);
  assert.equal(fs.existsSync(statePathFor(ctx.project, ctx.env)), false);
  assertUntouched(ctx, before, "deleted child binary");
});

test("5a incompatible state (version): message names the version, not the schema", () => {
  const ctx = setup("f5-incompat-ver-");
  const statePath = statePathFor(ctx.project, ctx.env);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ schema: "seal.protect/v1", sealVersion: "0.0.0", state: "PENDING RESTART" }));
  const before = snapshot(ctx);
  const result = runSeal(ctx, ["protect", "db", "demo.mutate"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /incompatible_state/);
  assert.match(result.out, /stored protection state is from another binary version/);
  assert.doesNotMatch(result.out, /has schema/);
  assertUntouched(ctx, before, "incompatible version");
});

test("5b incompatible state (schema): message names the schema, not a version", () => {
  const ctx = setup("f5-incompat-schema-");
  const statePath = statePathFor(ctx.project, ctx.env);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ schema: "seal.protect/v0", sealVersion: "0.1.1", state: "PENDING RESTART" }));
  const before = snapshot(ctx);
  const result = runSeal(ctx, ["protect", "db", "demo.mutate"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /incompatible_state/);
  assert.match(result.out, /has schema "seal\.protect\/v0"/);
  assert.match(result.out, /not seal\.protect\/v1/);
  assert.doesNotMatch(result.out, /another binary version/);
  assertUntouched(ctx, before, "incompatible schema");
});

test("6 two protected projects: works by design, isolation holds", () => {
  const a = setup("f5-two-a-");
  const b = setup("f5-two-b-");
  b.env.PATH = a.env.PATH; // same fake claude is per-root; use each own
  assert.equal(runSeal(a, ["protect", "db", "demo.mutate"]).code, 0);
  assert.equal(runSeal(b, ["protect", "db", "demo.mutate"]).code, 0);
  const beforeA = snapshot(a);
  const beforeB = snapshot(b);
  const statusA = runSeal(a, ["status"]);
  const statusB = runSeal(b, ["status"]);
  assert.match(statusA.out, /PENDING RESTART/);
  assert.match(statusB.out, /PENDING RESTART/);
  assert.notEqual(statePathFor(a.project, a.env), statePathFor(b.project, b.env));
  assertUntouched(a, beforeA, "two projects A");
  assertUntouched(b, beforeB, "two projects B");
});

test("7 live session during protect: works by design as PENDING RESTART", () => {
  const ctx = setup("f5-live-protect-");
  // A long-lived dummy stands in for a running Claude Code process.
  const dummy = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  try {
    const before = snapshot(ctx);
    const result = runSeal(ctx, ["protect", "db", "demo.mutate"]);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /PENDING RESTART/);
    assert.doesNotMatch(result.out, /ACTIVE/);
    assertUntouched(ctx, before, "live protect");
  } finally {
    dummy.kill("SIGKILL");
  }
});

test("8 live session during unprotect: active_claude_session", () => {
  const ctx = setup("f5-live-unprotect-");
  assert.equal(runSeal(ctx, ["protect", "db", "demo.mutate"]).code, 0);
  const statePath = statePathFor(ctx.project, ctx.env);
  const state = readState(statePath);
  fs.writeFileSync(statePath, JSON.stringify({ ...state, state: "ACTIVE", lease: { pid: process.pid, startWitness: processStartWitness(process.pid) } }, null, 2));
  const before = snapshot(ctx);
  const result = runSeal(ctx, ["unprotect", "db"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /active_claude_session/);
  assertUntouched(ctx, before, "live unprotect");
});

test("9 unsupported transport: project_server_non_stdio", () => {
  const ctx = setup("f5-http-");
  writeProject(ctx.project, { type: "http", url: "https://example.invalid/mcp" });
  const before = snapshot(ctx);
  const result = runSeal(ctx, ["protect", "db", "demo.mutate"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /project_server_non_stdio/);
  assertUntouched(ctx, before, "unsupported transport");
});

test("10 elicitation hook: doctor names elicitation_hook_configured", () => {
  const ctx = setup("f5-hook-");
  const before = snapshot(ctx);
  const result = runSeal(ctx, ["doctor"], { SEAL_ELICITATION_AUTO_RESPONSE: "accept" });
  assert.notEqual(result.code, 0);
  assert.match(result.out, /REFUSED/);
  assert.match(result.out, /elicitation_hook_configured/);
  assertUntouched(ctx, before, "elicitation hook");
});

test("11 declined-call: DECLINED, child stays at 0", async () => {
  const dir = tmpdir("f5-decline-");
  const countFile = path.join(dir, "child", "data.txt.count");
  const child = spawn(process.execPath, [SEAL, "demo", "--dir", dir], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (c) => {
    out += c;
    if (/Approve\? \[y\/N\]/.test(out)) child.stdin.write("n\n");
  });
  const code = await new Promise((resolve) => child.once("close", resolve));
  assert.equal(code, 0, out);
  assert.match(out, /DECLINED|declined|nothing was approved/i);
  assert.equal(fs.readFileSync(countFile, "utf8").trim(), "0");
});
