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
