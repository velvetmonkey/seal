// SPDX-License-Identifier: Apache-2.0
// Case-folded keys and re-serialized forwarding through the installed
// `seal __proxy`. The protected server is a fake that appends every line it
// receives, byte for byte, to its own log; "the child received" is always read
// from that log, never inferred from proxy output.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const PREDICATE = 'path~"/prod/*"';

// Protected Accept requires an installer-produced anchor, even in tests.
let installedProxy;
function installedProxyPath() {
  if (installedProxy) return installedProxy;
  const out = testTmpdir("seal-keyfold-install-");
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

const LOGGING_SERVER = `
const fs = require("node:fs");
const log = process.argv[1];
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  fs.appendFileSync(log, line + "\\n");
  let frame;
  try { frame = JSON.parse(line); } catch { return; }
  if (!Object.hasOwn(frame, "id") || typeof frame.method !== "string") return;
  // Echo the raw id token so a large numeric id is observable exactly.
  const id = line.match(/"id"\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)/)[1];
  const result = frame.method === "initialize"
    ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "logging-server", version: "1" } }
    : frame.method === "tools/list"
      ? { tools: ["write_file", "other.tool"].map((name) => ({ name, inputSchema: { type: "object" } })) }
      : { content: [{ type: "text", text: "CALLED " + (frame.params && frame.params.name) }] };
  process.stdout.write('{"jsonrpc":"2.0","id":' + id + ',"result":' + JSON.stringify(result) + '}\\n');
});`;

function session(t) {
  const dir = testTmpdir("seal-keyfold-");
  const childLog = path.join(dir, "child.log");
  fs.writeFileSync(childLog, "");
  const protection = require("../spine/protection.cjs");
  const { createJournal } = require("../spine/store.cjs");
  const env = { ...process.env, XDG_DATA_HOME: path.join(dir, "data-home") };
  const projectRoot = path.join(dir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".mcp.json"), JSON.stringify({
    mcpServers: { files: { command: process.execPath, args: ["-e", LOGGING_SERVER, childLog] } },
  }));
  const storePath = path.join(dir, "approvals.journal");
  createJournal(storePath);
  const receiptsDir = path.join(dir, "receipts");
  const project = protection.readProjectServer(projectRoot, "files");
  const statePath = protection.statePathFor(projectRoot, env);
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(statePath, JSON.stringify({
    schema: "seal.protect/v1", state: protection.STATES.PENDING_RESTART,
    projectRoot, projectId: protection.projectId(projectRoot), serverName: "files",
    projectServerDigest: project.serverDigest, guardTools: ["write_file"],
    guardPredicates: [{ tool: "write_file", predicate: PREDICATE }],
    storePath, receiptsDir, childArgv: project.childArgv, childEnv: project.childEnv, lease: null,
  }), { mode: 0o600 });
  const proxy = spawn(process.execPath, [installedProxyPath(), "__proxy", "--protect-state", statePath],
    { env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  proxy.stderr.setEncoding("utf8");
  proxy.stderr.on("data", (chunk) => { stderr += chunk; });
  const lines = [];
  readline.createInterface({ input: proxy.stdout }).on("line", (line) => { if (line.trim()) lines.push(line); });
  t.after(() => {
    try { proxy.kill("SIGKILL"); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const frames = (from = 0) => lines.slice(from).map((line) => JSON.parse(line));
  const waitFor = async (predicate, ms = 20000, from = 0) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = frames(from).find(predicate);
      if (hit) return hit;
      assert.ok(Date.now() < deadline, `no matching frame\nclient lines:\n${lines.join("\n")}\nstderr:\n${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const write = (line) => proxy.stdin.write(line + "\n");
  // A ping round-trip through the child orders every earlier forward.
  let fences = 0;
  const fence = async () => {
    const id = `fence-${fences++}`;
    write(JSON.stringify({ jsonrpc: "2.0", id, method: "ping" }));
    await waitFor((frame) => frame.id === id && !frame.method);
  };
  const childCalls = () => fs.readFileSync(childLog, "utf8").split("\n").filter((line) => line.includes("tools/call"));
  const receipts = () => fs.existsSync(receiptsDir)
    ? fs.readdirSync(receiptsDir).sort().map((name) => JSON.parse(fs.readFileSync(path.join(receiptsDir, name), "utf8")))
    : [];
  return { write, waitFor, fence, childCalls, receipts, frames, lineCount: () => lines.length };
}

async function started(t) {
  const s = session(t);
  s.write(JSON.stringify({ jsonrpc: "2.0", id: "init", method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: { elicitation: {} } } }));
  await s.waitFor((frame) => frame.id === "init" && !frame.method);
  return s;
}

const BYPASS = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"write_file","arguments":{"path":"/tmp/x","Path":"/prod/db"}}}';

test("the case-folded predicate bypass is refused and the child receives nothing", async (t) => {
  const s = await started(t);
  s.write(BYPASS);
  const refusal = await s.waitFor((frame) => frame.id === 1);
  await s.fence();
  assert.deepEqual(s.childCalls(), [], "the child must receive nothing");
  assert.equal(refusal.error?.code, -32600, JSON.stringify(refusal));
  assert.equal(refusal.error.data.refusal, "key_case_fold_collision");
  assert.match(refusal.error.message, /arguments keys "path" and "Path" are equal under Unicode case folding/);
  assert.equal(s.frames().some((frame) => frame.method === "elicitation/create"), false);
  const [receipt] = s.receipts();
  assert.equal(receipt.action, "BLOCK");
  assert.deepEqual(receipt.arguments, { path: "/tmp/x", Path: "/prod/db" });
});

test("the control line still prompts, and after approval the child receives the re-serialized call", async (t) => {
  const s = await started(t);
  s.write('{ "jsonrpc":"2.0", "id":2, "method":"tools/call", "x-envelope":1,'
    + ' "params":{ "name":"write_file", "arguments":{ "path":"\\/prod\\/db", "n":1.0 }, "_meta":{"progressToken":3}, "x-params":2 } }');
  const prompt = await s.waitFor((frame) => frame.method === "elicitation/create");
  assert.match(prompt.params.message, /path: \/prod\/db/);
  await s.fence();
  assert.deepEqual(s.childCalls(), [], "nothing reaches the child before approval");
  s.write(JSON.stringify({ jsonrpc: "2.0", id: prompt.id, result: { action: "accept", content: { approve: true } } }));
  await s.waitFor((frame) => frame.id === 2 && !frame.method);
  await s.fence();
  assert.deepEqual(s.childCalls(), [
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"write_file","arguments":{"path":"/prod/db","n":1}}}',
  ]);
});

test("a non-matching guarded call reaches the child only as its allowlisted re-serialization", async (t) => {
  const s = await started(t);
  s.write('  {"jsonrpc":"2.0","id":3,"method":"tools/call","x-envelope":{"path":"/prod/db"},'
    + '"params":{"name":"write_file","arguments":{"path":"\\u002ftmp/x","b":1,"2":2,"note":"caf\\u00e9"},'
    + '"_meta":{"progressToken":"p"},"x-params":{"path":"/prod/db"}}}  ');
  const reply = await s.waitFor((frame) => frame.id === 3);
  assert.deepEqual(reply.result, { content: [{ type: "text", text: "CALLED write_file" }] });
  await s.fence();
  assert.deepEqual(s.childCalls(), [
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"write_file","arguments":{"2":2,"path":"/tmp/x","b":1,"note":"café"}}}',
  ]);
  assert.equal(s.frames().some((frame) => frame.method === "elicitation/create"), false);
});

test("a normal non-guarded tools/call still works and the child receives an equivalent re-serialized call", async (t) => {
  const s = await started(t);
  const sent = ' {"jsonrpc":"2.0","id":9007199254740993,"method":"tools/call","params":{"name":"other.tool","arguments":{"q":"a b","n":2.50,"big":1E21,"z":-0},"_meta":{"progressToken":1}}} ';
  s.write(sent);
  await s.fence();
  const [received] = s.childCalls();
  assert.equal(received,
    '{"jsonrpc":"2.0","id":9007199254740993,"method":"tools/call","params":{"name":"other.tool","arguments":{"q":"a b","n":2.5,"big":1e+21,"z":0},"_meta":{"progressToken":1}}}');
  // JSON has one zero: serializing the parsed -0 drops its sign, exactly as
  // an approved call's re-serialization always has. Every other value is equal.
  const expected = JSON.parse(sent);
  expected.params.arguments.z = 0;
  assert.deepEqual(JSON.parse(received), expected);
  assert.ok(s.frames().some((frame) => frame.id === 9007199254740993 && frame.result?.content?.[0]?.text === "CALLED other.tool"));
});

test("case-variant methods, envelope keys, params keys and tool names are refused with a named error", async (t) => {
  const s = await started(t);
  const call = (id, extra) => JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call",
    params: { name: "write_file", arguments: { path: "/prod/db" } }, ...extra });
  const cases = [
    [10, call(10, { method: "TOOLS/CALL" }), "case_variant_name", /method "TOOLS\/CALL" equals "tools\/call"/],
    [11, call(11, { method: "Tools/Call" }), "case_variant_name", /method "Tools\/Call"/],
    [null, '{"jsonrpc":"2.0","id":12,"Method":"tools/call","params":{"name":"write_file","arguments":{"path":"/prod/db"}}}', "case_variant_name", /envelope key "Method" equals "method"/],
    [13, '{"jsonrpc":"2.0","id":13,"method":"ping","Method":"tools/call","params":{"name":"write_file","arguments":{"path":"/prod/db"}}}', "key_case_fold_collision", /envelope keys "method" and "Method"/],
    [14, '{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"Write_File","arguments":{"path":"/prod/db"}}}', "case_variant_name", /tool name "Write_File" equals guarded tool "write_file"/],
    [15, '{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"other.tool","Name":"write_file","arguments":{"path":"/prod/db"}}}', "key_case_fold_collision", /params keys "name" and "Name"/],
    [16, '{"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"write_file","Arguments":{"path":"/prod/db"}}}', "case_variant_name", /params key "Arguments" equals "arguments"/],
    [17, '{"jsonrpc":"2.0","id":17,"method":"tools/call","paramſ":{"name":"write_file","arguments":{"path":"/prod/db"}}}', "case_variant_name", /envelope key "paramſ" equals "params"/],
    [18, '{"jsonrpc":"2.0","id":18,"method":"tools/call","params":{"name":"write_file","arguments":{"path":"/tmp/x","opts":{"mode":"a","MODE":"w"}}}}', "key_case_fold_collision", /arguments keys "mode" and "MODE"/],
    [19, '{"jsonrpc":"2.0","id":19,"method":"tools/call","params":{"name":"write_file","arguments":{"path":"/tmp/x","\u212Aey":1,"key":2}}}', "key_case_fold_collision", /arguments keys/],
  ];
  for (const [id, line, refusal, detail] of cases) {
    const before = s.lineCount();
    s.write(line);
    const error = await s.waitFor((frame) => frame.error?.data?.refusal, 20000, before);
    assert.equal(error.id, id, line);
    assert.equal(error.error.data.refusal, refusal, line);
    assert.match(error.error.message, detail, line);
  }
  await s.fence();
  assert.deepEqual(s.childCalls(), []);
  assert.equal(s.receipts().filter((receipt) => receipt.action === "BLOCK").length, cases.length);
});

test("Node's unapproved forward needs the kernel: a kernel BLOCK is an authorization disagreement", async (t) => {
  const s = await started(t);
  s.write('{"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"write_file","arguments":{"path":"/tmp/x","note":"\\ud800"}}}');
  const reply = await s.waitFor((frame) => frame.id === 20);
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /^approval refused: authorization_disagreement — kernel refused while Node allowed/);
  await s.fence();
  assert.deepEqual(s.childCalls(), []);
  const [receipt] = s.receipts();
  assert.equal(receipt.action, "BLOCK");
  assert.equal(receipt.verdict, "BLOCK");
  assert.equal(receipt.kernel_config.safety.tools.length, 2);
  assert.deepEqual(receipt.kernel_config.safety.tools[0].match, { type: "starts_with", arg: "path", value: "/prod/" });
});

test("a number whose value would change on re-serialization is refused, not rewritten", async (t) => {
  const s = await started(t);
  for (const [id, number] of [[30, "9007199254740993"], [31, "1e400"]]) {
    s.write(`{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":"other.tool","arguments":{"n":${number}}}}`);
    const error = await s.waitFor((frame) => frame.id === id);
    assert.equal(error.error.data.refusal, "number_not_representable");
  }
  s.write('{"jsonrpc":"2.0","id":32,"method":"tools/call","params":{"name":"other.tool","arguments":{"n":9007199254740992,"f":0.10000000000000001}}}');
  await s.waitFor((frame) => frame.id === 32 && frame.result);
  await s.fence();
  assert.deepEqual(s.childCalls(), [
    '{"jsonrpc":"2.0","id":32,"method":"tools/call","params":{"name":"other.tool","arguments":{"n":9007199254740992,"f":0.1}}}',
  ]);
});
