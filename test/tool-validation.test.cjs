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
const { protectedToolNames, readState, statePathFor } = require("../spine/protection.cjs");

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

function proxySession(ctx) {
  const statePath = statePathFor(ctx.project, ctx.env);
  const proxy = spawn(process.execPath, [SEAL, "__proxy", "--protect-state", statePath], {
    cwd: ctx.project,
    env: ctx.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = readline.createInterface({ input: proxy.stdout, terminal: false });
  const queued = [];
  const waiters = [];
  const elicitationIds = [];
  lines.on("line", (line) => {
    const frame = JSON.parse(line);
    const waiter = waiters.shift();
    if (waiter) waiter(frame);
    else queued.push(frame);
  });
  const nextFrame = () => queued.length > 0
    ? Promise.resolve(queued.shift())
    : new Promise((resolve) => waiters.push(resolve));
  let initialized = false;
  async function ensureInitialized() {
    if (initialized) return;
    initialized = true;
    proxy.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: "tool-validation-init", method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: { elicitation: {} } },
    }) + "\n");
    while ((await nextFrame()).id !== "tool-validation-init") {}
  }
  return {
    proxy,
    elicitationIds,
    async request(frame, action = "accept") {
      await ensureInitialized();
      proxy.stdin.write(JSON.stringify(frame) + "\n");
      while (true) {
        const response = await nextFrame();
        if (response.method === "elicitation/create") {
          elicitationIds.push(response.id);
          const result = action === "accept"
            ? { action, content: { approve: true } }
            : { action };
          proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: response.id, result }) + "\n");
        } else if (response.id === frame.id) {
          return response;
        }
      }
    },
    async close() {
      proxy.stdin.end();
      await new Promise((resolve) => proxy.once("close", resolve));
    },
  };
}

test("protect refuses a misspelled tool and names every observed tool", () => {
  const ctx = setup("ok", "db.drop_table,db.read");
  const result = run(ctx, ["protect", "db", "db.drop_tabel"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /protected_tool_absent/);
  assert.match(result.out, /observed tools: db\.drop_table, db\.read/);
  assert.match(result.out, /^Next:\n  Choose exact tool names from the observed tools list above, then retry protect\.$/m);
  assert.equal(fs.existsSync(statePathFor(ctx.project, ctx.env)), false);
});

test("protect refuses a tool name with leading or trailing whitespace", () => {
  const ctx = setup("ok", "db.drop_table, db.drop_table");
  const result = run(ctx, ["protect", "db", " db.drop_table"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /protected tool name has surrounding whitespace: " db\.drop_table"/);
  assert.equal(fs.existsSync(statePathFor(ctx.project, ctx.env)), false);
});

test("stored protection state refuses a tool name with surrounding whitespace", () => {
  const ctx = setup("ok", "db.drop_table");
  const protectedRun = run(ctx, ["protect", "db", "db.drop_table"]);
  assert.equal(protectedRun.code, 0, protectedRun.out);
  const filePath = statePathFor(ctx.project, ctx.env);
  const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
  state.guardTools = [" db.drop_table"];
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n");
  assert.throws(
    () => protectedToolNames(readState(filePath)),
    (error) => {
      assert.equal(error.code, "state_broken");
      assert.equal(error.message, 'stored protection state contains protected tool name with surrounding whitespace: " db.drop_table"');
      return true;
    },
  );
});

test("an observed tool protects end to end and reports every other tool as not approval-gated", async () => {
  const ctx = setup("ok", "db.drop_table,db.read");
  const protectedRun = run(ctx, ["protect", "db", "db.drop_table"]);
  assert.equal(protectedRun.code, 0, protectedRun.out);
  assert.match(protectedRun.out, /Sealed MCP route db: PENDING RESTART/);
  assert.match(protectedRun.out, /^  db\.drop_table$/m);
  assert.match(protectedRun.out, /Protection scope: 1 other tool NOT APPROVAL-GATED \(they pass through Seal\): db\.read/);
  const session = proxySession(ctx);
  try {
    const response = await session.request({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "db.drop_table", arguments: {} } }, "decline");
    assert.match(response.result.content[0].text, /declined/);
    assert.equal(session.elicitationIds.length, 1);
  } finally {
    await session.close();
  }
});

test("a named tool list gives both tools separate asks", async (t) => {
  const ctx = setup("ok", "db.drop_table,db.read,db.health");
  const protectedRun = run(ctx, ["protect", "db", "db.drop_table", "db.read"]);
  assert.equal(protectedRun.code, 0, protectedRun.out);
  assert.match(protectedRun.out, /Sealed MCP route db: PENDING RESTART/);
  assert.match(protectedRun.out, /^  db\.drop_table$/m);
  assert.match(protectedRun.out, /^  db\.read$/m);
  assert.match(protectedRun.out, /Protection scope: 1 other tool NOT APPROVAL-GATED \(they pass through Seal\): db\.health/);

  const session = proxySession(ctx);
  try {
    const toolA = { jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "db.drop_table", arguments: { table: "one" } } };
    const allowedA = await session.request(toolA);
    assert.match(allowedA.result.content[0].text, /CALLED db\.drop_table/);

    const refusedB = await session.request({
      jsonrpc: "2.0", id: 23, method: "tools/call", params: { name: "db.read", arguments: { table: "one" } },
    }, "decline");
    assert.match(refusedB.result.content[0].text, /declined/);
    assert.equal(new Set(session.elicitationIds).size, 2, "each tool must receive its own elicitation request id");
    t.diagnostic(`tool A approved response: ${allowedA.result.content[0].text}`);
    t.diagnostic(`tool B after tool A approval: ${refusedB.result.content[0].text}`);
    t.diagnostic(`asks have distinct ids: ${new Set(session.elicitationIds).size === 2}`);
  } finally {
    await session.close();
  }
});

test("any unknown tool makes the whole named list fail", (t) => {
  const ctx = setup("ok", "db.drop_table,db.read");
  const result = run(ctx, ["protect", "db", "db.drop_table", "db.missing"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /protected_tool_absent/);
  assert.match(result.out, /requested tool "db\.missing" was not returned by tools\/list/);
  assert.match(result.out, /^Next:\n  Choose exact tool names from the observed tools list above, then retry protect\.$/m);
  assert.equal(fs.existsSync(statePathFor(ctx.project, ctx.env)), false, "no partial state may be written");
  t.diagnostic(result.out.trim());
  t.diagnostic(`state written: ${fs.existsSync(statePathFor(ctx.project, ctx.env))}`);
});

test("protect refuses an empty tool list", (t) => {
  const ctx = setup("ok", "db.drop_table,db.read");
  const result = run(ctx, ["protect", "db"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /usage: seal protect .* SERVER TOOL \[TOOL\.\.\.\]/);
  assert.equal(fs.existsSync(statePathFor(ctx.project, ctx.env)), false);
  t.diagnostic(result.out.trim());
});

test("duplicate protected tool names are deduped in stored order", (t) => {
  const ctx = setup("ok", "db.drop_table,db.read");
  const result = run(ctx, ["protect", "db", "db.drop_table", "db.read", "db.drop_table"]);
  assert.equal(result.code, 0, result.out);
  const stored = readState(statePathFor(ctx.project, ctx.env)).guardTools;
  assert.deepEqual(stored, ["db.drop_table", "db.read"]);
  t.diagnostic(`stored guardTools: ${JSON.stringify(stored)}`);
});

test("three protected tools round-trip through stored state", (t) => {
  const ctx = setup("ok", "db.drop_table,db.read,db.health");
  const expected = ["db.drop_table", "db.read", "db.health"];
  const result = run(ctx, ["protect", "db", ...expected]);
  assert.equal(result.code, 0, result.out);
  const state = readState(statePathFor(ctx.project, ctx.env));
  assert.deepEqual(state.guardTools, expected);
  assert.equal(Object.hasOwn(state, "guardTool"), false, "new state must carry the list, not the old scalar");
  t.diagnostic(`written/read guardTools: ${JSON.stringify(state.guardTools)}`);
  t.diagnostic(`old scalar present: ${Object.hasOwn(state, "guardTool")}`);
});

test("pre-change scalar guardTool state still activates and gates", async (t) => {
  const ctx = setup("ok", "db.drop_table,db.read");
  const protectedRun = run(ctx, ["protect", "db", "db.drop_table"]);
  assert.equal(protectedRun.code, 0, protectedRun.out);
  const filePath = statePathFor(ctx.project, ctx.env);
  const current = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const { guardTools, ...oldState } = current;
  fs.writeFileSync(filePath, JSON.stringify({ ...oldState, guardTool: guardTools[0] }, null, 2) + "\n");

  assert.deepEqual(readState(filePath).guardTools, ["db.drop_table"], "old scalar state must normalize on read");
  t.diagnostic(`pre-change disk keys: guardTool=${JSON.parse(fs.readFileSync(filePath, "utf8")).guardTool}, guardTools=${JSON.parse(fs.readFileSync(filePath, "utf8")).guardTools}`);
  const session = proxySession(ctx);
  try {
    const refused = await session.request({
      jsonrpc: "2.0", id: 31, method: "tools/call", params: { name: "db.drop_table", arguments: {} },
    }, "cancel");
    assert.match(refused.result.content[0].text, /cancelled/);
    t.diagnostic(`old scalar state call response: ${refused.result.content[0].text}`);
  } finally {
    await session.close();
  }
});

test("a configured server that cannot start refuses protection", () => {
  const ctx = setup();
  fs.writeFileSync(path.join(ctx.project, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: path.join(ctx.root, "missing-server") } } }));
  const result = run(ctx, ["protect", "db", "db.drop_table"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /protected_server_start_failed/);
  assert.match(result.out, /^Next:\n  Fix the configured MCP server's startup and tools\/list response\. If it is only slow, retry protect with a larger timeout\.$/m);
  assert.doesNotMatch(result.out, /PENDING RESTART/);
});

test("an initialize failure refuses protection", () => {
  const ctx = setup("initialize-error");
  const result = run(ctx, ["protect", "db", "db.drop_table"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /protected_server_initialize_failed/);
  assert.match(result.out, /^Next:\n  Fix the configured MCP server's startup and tools\/list response\. If it is only slow, retry protect with a larger timeout\.$/m);
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
  assert.match(result.out, /Sealed MCP route db: PENDING RESTART/);
  assert.match(result.out, /^  db\.drop_table$/m);
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
  assert.match(result.out, /^Next:\n  Fix the configured MCP server's startup and tools\/list response\. If it is only slow, retry protect with a larger timeout\.$/m);
});

test("an empty tools/list refuses protection", () => {
  const ctx = setup("empty");
  const result = run(ctx, ["protect", "db", "db.drop_table"]);
  assert.notEqual(result.code, 0);
  assert.match(result.out, /protected_server_tools_empty/);
  assert.match(result.out, /^Next:\n  Fix the configured MCP server's startup and tools\/list response\. If it is only slow, retry protect with a larger timeout\.$/m);
  assert.doesNotMatch(result.out, /PENDING RESTART/);
});

test("protection scope caps a large tool inventory and reports the omitted count", () => {
  const ctx = setup("many", "20000");
  const result = run(ctx, ["protect", "db", "db.tool_0"]);
  assert.equal(result.code, 0, result.out);
  const scope = result.out.split("\n").find((line) => line.startsWith("Protection scope:"));
  assert.match(scope, /^Protection scope: 19999 other tools NOT APPROVAL-GATED \(they pass through Seal\): /);
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
