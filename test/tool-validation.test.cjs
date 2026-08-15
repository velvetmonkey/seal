// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const readline = require("node:readline");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin/seal");
const SERVER = path.join(ROOT, "test-support/tool-list-server.cjs");
const { readState, statePathFor } = require("../spine/protection.cjs");

function setup(mode = "ok", source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-tool-validation-"));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  fs.mkdirSync(project); fs.mkdirSync(home); fs.mkdirSync(bin);
  const claude = path.join(bin, "claude");
  fs.writeFileSync(claude, `#!/usr/bin/env node
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const a=process.argv.slice(2), d=path.join(process.env.HOME,".claude-local"); fs.mkdirSync(d,{recursive:true});
const f=path.join(d,crypto.createHash("sha256").update(process.cwd()+":"+a[a[1]==="add"?4:2]).digest("hex")+".json");
if(a[1]==="get") process.exit(fs.existsSync(f)?0:1);
if(a[1]==="add"){fs.writeFileSync(f,JSON.stringify(a));process.exit(0)}
if(a[1]==="remove"){try{fs.unlinkSync(f)}catch{}process.exit(0)} process.exit(2);
`, { mode: 0o755 });
  const args = [SERVER, mode];
  if (source !== undefined) args.push(source);
  fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: process.execPath, args } } }, null, 2) + "\n");
  const env = { ...process.env, HOME: home, XDG_DATA_HOME: path.join(home, ".local/share"), PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  return { root, project, home, env };
}
function run(ctx, args) {
  const result = spawnSync(process.execPath, [SEAL, ...args], { cwd: ctx.project, env: ctx.env, encoding: "utf8" });
  return { code: result.status, out: `${result.stdout || ""}${result.stderr || ""}` };
}

test("protect refuses a misspelled tool and names every observed tool", () => {
  const ctx = setup("ok", "db.drop_table,db.read");
  const result = run(ctx, ["protect", "db", "db.drop_tabel"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /protected_tool_absent/);
  assert.match(result.out, /observed tools: db\.drop_table, db\.read/);
  assert.equal(fs.existsSync(statePathFor(ctx.project, ctx.env)), false);
});

test("an observed tool protects end to end and reports every other tool outside Seal", async () => {
  const ctx = setup("ok", "db.drop_table,db.read");
  const protectedRun = run(ctx, ["protect", "db", "db.drop_table"]);
  assert.equal(protectedRun.code, 0, protectedRun.out);
  assert.match(protectedRun.out, /Protection: PENDING RESTART db\.db\.drop_table/);
  assert.match(protectedRun.out, /Protection scope: 1 other tool OUTSIDE Seal: db\.read/);
  const statePath = statePathFor(ctx.project, ctx.env);
  const proxy = spawn(process.execPath, [SEAL, "__proxy", "--protect-state", statePath], { cwd: ctx.project, env: ctx.env, stdio: ["pipe", "pipe", "pipe"] });
  const lines = readline.createInterface({ input: proxy.stdout, terminal: false });
  try {
    proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "db.drop_table", arguments: {} } }) + "\n");
    const response = await new Promise((resolve) => lines.once("line", (line) => resolve(JSON.parse(line))));
    assert.equal(response.result.resultType, "input_required");
  } finally {
    proxy.stdin.end();
    await new Promise((resolve) => proxy.once("close", resolve));
  }
});

test("a configured server that cannot start refuses protection", () => {
  const ctx = setup();
  fs.writeFileSync(path.join(ctx.project, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: path.join(ctx.root, "missing-server") } } }));
  const result = run(ctx, ["protect", "db", "db.drop_table"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /protected_server_start_failed/);
  assert.doesNotMatch(result.out, /PENDING RESTART/);
});

test("an initialize failure refuses protection", () => {
  const ctx = setup("initialize-error");
  const result = run(ctx, ["protect", "db", "db.drop_table"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /protected_server_initialize_failed/);
});

test("a slow initialize refuses at the default deadline and names --timeout-ms", () => {
  const ctx = setup("slow-initialize", "5100");
  const result = run(ctx, ["protect", "db", "db.drop_table"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /protected_server_initialize_failed/);
  assert.match(result.out, /after 5000ms \(default: 5000ms; increase with --timeout-ms <milliseconds>\)/);
  assert.equal(fs.existsSync(statePathFor(ctx.project, ctx.env)), false);
});

test("--timeout-ms permits a legitimate slow initialize and is persisted for activation", () => {
  const ctx = setup("slow-initialize", "5100");
  const result = run(ctx, ["protect", "--timeout-ms", "6000", "db", "db.drop_table"]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /Protection: PENDING RESTART db\.db\.drop_table/);
  assert.equal(readState(statePathFor(ctx.project, ctx.env)).discoveryTimeoutMs, 6000);
});

test("a dead initialize still refuses at the default deadline", () => {
  const ctx = setup("dead-initialize");
  const result = run(ctx, ["protect", "db", "db.drop_table"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /protected_server_initialize_failed/);
  assert.match(result.out, /after 5000ms \(default: 5000ms; increase with --timeout-ms <milliseconds>\)/);
  assert.equal(fs.existsSync(statePathFor(ctx.project, ctx.env)), false);
});

test("a tools/list error refuses protection", () => {
  const ctx = setup("list-error");
  const result = run(ctx, ["protect", "db", "db.drop_table"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /protected_server_tools_list_failed/);
});

test("an empty tools/list refuses protection", () => {
  const ctx = setup("empty");
  const result = run(ctx, ["protect", "db", "db.drop_table"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /protected_server_tools_empty/);
  assert.doesNotMatch(result.out, /PENDING RESTART/);
});

test("protection scope caps a large tool inventory and reports the omitted count", () => {
  const ctx = setup("many", "20000");
  const result = run(ctx, ["protect", "db", "db.tool_0"]);
  assert.equal(result.code, 0, result.out);
  const scope = result.out.split("\n").find((line) => line.startsWith("Protection scope:"));
  assert.match(scope, /^Protection scope: 19999 other tools OUTSIDE Seal: /);
  assert.match(scope, /\(\+19979 more\)$/);
  assert.ok(scope.length < 500, `scope line was ${scope.length} characters`);
});

test("activation becomes visibly BROKEN when the protected tool vanished", () => {
  const names = path.join(os.tmpdir(), `seal-tool-names-${crypto.randomUUID()}`);
  fs.writeFileSync(names, "db.drop_table db.read\n");
  const ctx = setup("file", names);
  assert.equal(run(ctx, ["protect", "db", "db.drop_table"]).code, 0);
  fs.writeFileSync(names, "db.read\n");
  const statePath = statePathFor(ctx.project, ctx.env);
  const activated = run(ctx, ["__proxy", "--protect-state", statePath]);
  assert.notEqual(activated.code, 0);
  assert.match(activated.out, /protected_tool_vanished/);
  assert.match(activated.out, /observed tools: db\.read/);
  assert.equal(readState(statePath).state, "BROKEN");
});
