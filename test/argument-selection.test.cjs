// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createProxy } = require("../spine/proxy.cjs");
const { createJournal } = require("../spine/store.cjs");
const { evaluateSelection, normalizeToolSelection } = require("../spine/tool-selection.cjs");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, "test-support/tool-list-server.cjs");

function waitFor(frames, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const frame = frames.find(predicate);
      if (frame) { clearInterval(timer); resolve(frame); }
      else if (Date.now() - started > timeoutMs) { clearInterval(timer); reject(new Error(`timed out; frames=${JSON.stringify(frames)}`)); }
    }, 10);
  });
}

function session(selection) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-argument-selection-"));
  const storePath = path.join(dir, "approvals.journal");
  createJournal(storePath);
  const frames = [];
  const proxy = createProxy({
    guardSelections: [selection],
    storePath,
    receiptsDir: path.join(dir, "receipts"),
    childArgv: [process.execPath, SERVER, "ok", "db.mutate"],
    onClientLine: (line) => frames.push(JSON.parse(line)),
  });
  proxy.write(JSON.stringify({ jsonrpc: "2.0", id: "init", method: "initialize", params: { capabilities: { elicitation: {} } } }));
  return { dir, frames, proxy, close() { proxy.stop(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("a matching predicate gates and names the predicate in the prompt", async (t) => {
  const run = session({ name: "db.mutate", predicate: 'operation="delete"' });
  t.after(() => run.close());
  await waitFor(run.frames, (frame) => frame.id === "init");
  run.proxy.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "db.mutate", arguments: { operation: "delete" } } }));
  const prompt = await waitFor(run.frames, (frame) => frame.method === "elicitation/create");
  assert.match(prompt.params.message, /Selection predicate: db\.mutate\?operation="delete" \(predicate matched\)/);
  t.diagnostic(prompt.params.message.split("\n").at(-1));
});

test("a definitive predicate non-match allows the call without a prompt", async (t) => {
  const run = session({ name: "db.mutate", predicate: 'operation="delete"' });
  t.after(() => run.close());
  await waitFor(run.frames, (frame) => frame.id === "init");
  run.proxy.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "db.mutate", arguments: { operation: "read" } } }));
  const response = await waitFor(run.frames, (frame) => frame.id === 2);
  assert.match(response.result.content[0].text, /CALLED db\.mutate/);
  assert.equal(run.frames.some((frame) => frame.method === "elicitation/create"), false);
  t.diagnostic(response.result.content[0].text);
});

test("the one-wildcard string pattern gates a matching call", () => {
  const selection = normalizeToolSelection({ name: "db.mutate", predicate: 'operation~"delete_*"' });
  const raw = JSON.stringify({ jsonrpc: "2.0", params: { arguments: { operation: "delete_table" } } });
  assert.deepEqual(evaluateSelection(selection, { operation: "delete_table" }, raw), {
    gate: true,
    label: 'db.mutate?operation~"delete_*"',
    detail: "predicate matched",
  });
});

test("a one-wildcard string pattern keeps its fixed parts disjoint", () => {
  const cases = [
    ['ab*bc', "abc", false],
    ['ab*bc', "abbc", true],
    ['ab*bc', "abXYbc", true],
    ['delete_*', "delete_all", true],
    ['*_all', "delete_all", true],
    ['*', "anything", true],
  ];
  for (const [pattern, actual, expected] of cases) {
    const predicate = `line~${JSON.stringify(pattern)}`;
    const selection = normalizeToolSelection({ name: "db.mutate", predicate });
    const raw = JSON.stringify({ jsonrpc: "2.0", params: { arguments: { line: actual } } });
    assert.equal(evaluateSelection(selection, { line: actual }, raw).gate, expected, `${pattern} against ${actual}`);
  }
});

test("a malformed stored predicate gates fail closed", async (t) => {
  const run = session({ name: "db.mutate", predicate: "operation=[" });
  t.after(() => run.close());
  await waitFor(run.frames, (frame) => frame.id === "init");
  run.proxy.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "db.mutate", arguments: { operation: "read" } } }));
  const prompt = await waitFor(run.frames, (frame) => frame.method === "elicitation/create");
  assert.match(prompt.params.message, /predicate failed to parse/);
  t.diagnostic(prompt.params.message.split("\n").at(-1));
});

test("a bare tool name gates every call as before", async (t) => {
  const run = session("db.mutate");
  t.after(() => run.close());
  await waitFor(run.frames, (frame) => frame.id === "init");
  run.proxy.write(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "db.mutate", arguments: { operation: "read" } } }));
  const prompt = await waitFor(run.frames, (frame) => frame.method === "elicitation/create");
  assert.match(prompt.params.message, /Selection predicate: db\.mutate \(bare tool name selects all calls\)/);
  t.diagnostic(prompt.params.message.split("\n").at(-1));
});

test("JSON number zero and signed zero are one scalar", () => {
  const zero = normalizeToolSelection({ name: "db.mutate", predicate: "count=0" });
  const negative = normalizeToolSelection({ name: "db.mutate", predicate: "count=-0" });
  const rawNegative = '{"jsonrpc":"2.0","params":{"arguments":{"count":-0}}}';
  const rawPositive = '{"jsonrpc":"2.0","params":{"arguments":{"count":0}}}';
  const argsNegative = JSON.parse('{"count":-0}');
  const argsPositive = JSON.parse('{"count":0}');
  assert.equal(evaluateSelection(zero, argsNegative, rawNegative).detail, "predicate matched");
  assert.equal(evaluateSelection(zero, argsPositive, rawPositive).detail, "predicate matched");
  assert.equal(evaluateSelection(negative, argsPositive, rawPositive).detail, "predicate matched");
  assert.equal(evaluateSelection(negative, argsNegative, rawNegative).detail, "predicate matched");
});

test("JSON signed zero matches JSON number zero", async (t) => {
  const run = session({ name: "db.mutate", predicate: "count=0" });
  t.after(() => run.close());
  await waitFor(run.frames, (frame) => frame.id === "init");
  run.proxy.write('{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"db.mutate","arguments":{"count":-0}}}');
  const prompt = await waitFor(run.frames, (frame) => frame.method === "elicitation/create");
  assert.match(prompt.params.message, /Selection predicate: db\.mutate\?count=0 \(predicate matched\)/);
  assert.equal(run.frames.some((frame) => frame.id === 12), false);
  t.diagnostic(prompt.params.message.split("\n").at(-1));
});

test("argument-shape evasion attempts all gate", (t) => {
  const selection = normalizeToolSelection({ name: "db.mutate", predicate: 'operation="delete"' });
  let deep = { operation: "delete" };
  for (let index = 0; index < 100; index += 1) deep = { next: deep };
  const attempts = [
    ["nested one level", { wrapper: { operation: "delete" } }],
    ["duplicate key", JSON.parse('{"operation":"delete","operation":"read"}'), '{"jsonrpc":"2.0","params":{"arguments":{"operation":"delete","operation":"read"}}}'],
    ["escaped duplicate key", JSON.parse('{"operation":"delete","\\u006fperation":"read"}'), '{"jsonrpc":"2.0","params":{"arguments":{"operation":"delete","\\u006fperation":"read"}}}'],
    ["Unicode lookalike key", { operatiоn: "delete" }],
    ["numeric value", { operation: 1 }],
    ["null value", { operation: null }],
    ["absent key", {}],
    ["array value", { operation: ["delete"] }],
    ["extra JSON whitespace", { operation: "delete" }, '{ "jsonrpc" : "2.0", "params" : { "arguments" : { "operation" : "delete" } } }'],
    ["prototype key", JSON.parse('{"__proto__":{"operation":"read"}}')],
    ["very deep object", deep],
    ["case-different key", { Operation: "delete" }],
  ];
  for (const [name, args, raw = JSON.stringify({ jsonrpc: "2.0", params: { arguments: args } })] of attempts) {
    const result = evaluateSelection(selection, args, raw);
    assert.equal(result.gate, true, `${name}: ${JSON.stringify(result)}`);
    t.diagnostic(`${name}: GATED — ${result.detail}`);
  }
  t.diagnostic(`COUNT: ${attempts.length}`);
});

test("bare tool selections inspect duplicate keys before returning", () => {
  const selection = normalizeToolSelection("db.mutate");
  for (const raw of [
    '{"params":{"name":"db.mutate","name":"db.read","arguments":{}}}',
    '{"params":{"name":"db.read","name":"db.mutate","arguments":{}}}',
    '{"params":{"name":"db.mutate","arguments":{"x":1,"\\u0078":2}}}',
  ]) {
    assert.deepEqual(evaluateSelection(selection, {}, raw), {
      gate: true, label: "db.mutate", detail: "duplicate JSON object key",
    });
  }
  assert.match(evaluateSelection(selection, {}, '{').detail, /argument inspection failed/);
  assert.equal(evaluateSelection(selection, {}, '{"params":{"name":"db.mutate","arguments":{}}}').detail,
    "bare tool name selects all calls");
});

test("both duplicate name orders are refused before the child and normal traffic is preserved", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-duplicate-order-"));
  const capture = path.join(dir, "child.jsonl");
  fs.writeFileSync(capture, "");
  const storePath = path.join(dir, "approvals.journal");
  createJournal(storePath);
  const frames = [];
  const child = `const fs = require('node:fs');
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      fs.appendFileSync(${JSON.stringify(capture)}, line + '\\n');
      const frame = JSON.parse(line);
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id,
        result: { content: [{ type: 'text', text: line }] } }) + '\\n');
    });`;
  const proxy = createProxy({ guardSelections: ["db.mutate"], storePath,
    receiptsDir: path.join(dir, "receipts"), childArgv: [process.execPath, "-e", child],
    onClientLine: line => frames.push(JSON.parse(line)) });
  t.after(async () => { await proxy.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const init = '{"jsonrpc":"2.0","id":"init","method":"initialize","params":{"capabilities":{"elicitation":{}}}}';
  proxy.write(init);
  await waitFor(frames, frame => frame.id === "init");
  for (const [id, names] of [
    ["guarded-first", '"name":"db.mutate","name":"db.read"'],
    ["unguarded-first", '"name":"db.read","name":"db.mutate"'],
  ]) {
    proxy.write(`{"jsonrpc":"2.0","id":"${id}","method":"tools/call","params":{${names},"arguments":{}}}`);
    const response = await waitFor(frames, frame => frame.id === id);
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /response_malformed — duplicate JSON object key/);
    t.diagnostic(`${id}: ${response.result.content[0].text}`);
  }
  assert.equal(frames.some(frame => frame.method === "elicitation/create"), false);
  proxy.write('{"jsonrpc":"2.0","id":"normal-guarded","method":"tools/call","params":{"name":"db.mutate","arguments":{}}}');
  const prompt = await waitFor(frames, frame => frame.method === "elicitation/create");
  assert.match(prompt.params.message, /Selection predicate: db\.mutate \(bare tool name selects all calls\)/);
  const unguarded = '{"jsonrpc":"2.0","id":"normal-unguarded","method":"tools/call","params":{"name":"db.read","arguments":{}}}';
  proxy.write(unguarded);
  const response = await waitFor(frames, frame => frame.id === "normal-unguarded");
  assert.equal(response.result.content[0].text, unguarded);
  assert.equal(fs.readFileSync(capture, "utf8"), `${init}\n${unguarded}\n`);
  t.diagnostic("child raw capture contains only initialize and the unchanged normal unguarded frame");
});
