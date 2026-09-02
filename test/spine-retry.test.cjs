// SPDX-License-Identifier: Apache-2.0
// Acceptance for the retry-model spine (roadmap step 2, brief spine2).
//
// Evidence rule: every child call count is READ FROM THE CHILD'S OWN COUNT
// FILE (written only by `seal __demo-server`), never inferred from output.
// Both the demo test and the protected-path test route through the same
// proxy and the same merged approval contract; deleting or bypassing that
// shared transition must break both.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");
const CHECKER = path.join(ROOT, "checker", "seal-receipt-v2.mjs");
const { createProxy } = require("../spine/proxy.cjs");
const { createJournal } = require("../spine/store.cjs");

// Match the repository's existing path.relative(ROOT, ...) convention used by
// output and inventory diagnostics: semantic output assertions must not depend
// on the checkout's absolute filesystem location.
function repositoryRelativeOutput(text) {
  // Only abbreviate paths that are actually below this checkout. A textual
  // prefix can also name a sibling temporary directory (ROOT=".../seal",
  // TMPDIR=".../seal-tmp"), which must remain an absolute path.
  return text.replaceAll(`${ROOT}${path.sep}`, `.${path.sep}`);
}


function readCount(countFile) {
  return fs.readFileSync(countFile, "utf8").trim();
}

function attach(child) {
  const state = { out: "", err: "", exit: new Promise((resolve) => child.once("close", (code) => resolve(code))), kill: () => { try { child.kill("SIGKILL"); } catch {} } };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { state.out += chunk; });
  child.stderr.on("data", (chunk) => { state.err += chunk; });
  state.waitFor = (pattern, ms = 15000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (pattern.test(state.out)) { clearInterval(poll); resolve(); }
      else if (Date.now() - started > ms) {
        clearInterval(poll);
        reject(new Error(`timed out waiting for ${pattern}\n--- stdout:\n${state.out}\n--- stderr:\n${state.err}`));
      }
    }, 25);
  });
  state.waitForErr = (pattern, ms = 15000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (pattern.test(state.err)) { clearInterval(poll); resolve(); }
      else if (Date.now() - started > ms) {
        clearInterval(poll);
        reject(new Error(`timed out waiting for ${pattern}\n--- stdout:\n${state.out}\n--- stderr:\n${state.err}`));
      }
    }, 25);
  });
  return state;
}

function blockedKernelPreload(phase) {
  const sleep = "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5100);";
  const gate = `
const fs = require("node:fs");
const blockRetry = (() => {
  if (!process.argv[1]?.endsWith("kernel-authorization-worker.cjs")) return false;
  const statePath = process.env.SEAL_TEST_KERNEL_BLOCK_STATE;
  if (!statePath || !fs.existsSync(statePath)) return false;
  fs.unlinkSync(statePath);
  return true;
})();`;
  const controls = {
    child_bootstrap_to_module_load: `${gate}
const Module = require("node:module");
const load = Module._load;
Module._load = function(request, parent, isMain) {
  if (blockRetry && request.endsWith("runner.cjs")) ${sleep}
  return load.apply(this, arguments);
};`,
    wasm_load: `${gate}
const Module = require("node:module");
const load = Module._load;
Module._load = function(request, parent, isMain) {
  const value = load.apply(this, arguments);
  if (blockRetry && request.endsWith("runner.cjs")) {
    const runnerLoad = value.load;
    value.load = async function(...args) { ${sleep} return runnerLoad.apply(this, args); };
  }
  return value;
};`,
    decision_execution: `${gate}
const Module = require("node:module");
const load = Module._load;
Module._load = function(request, parent, isMain) {
  const value = load.apply(this, arguments);
  if (blockRetry && request.endsWith("runner.cjs")) {
    const decide = value.decide;
    value.decide = async function(...args) { ${sleep} return decide.apply(this, args); };
  }
  return value;
};`,
  };
  return controls[phase];
}

async function runDemoToKernelRefusal(phase, t) {
  const controlDir = testTmpdir("seal-cli-kernel-phase-");
  const control = path.join(controlDir, "block.cjs");
  const blockState = path.join(controlDir, "worker-count");
  fs.writeFileSync(control, blockedKernelPreload(phase));
  t.after(() => fs.rmSync(controlDir, { recursive: true, force: true }));
  const dir = testTmpdir("seal-cli-kernel-demo-");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const child = spawn(process.execPath, [SEAL, "demo", "--dir", dir], {
    env: {
      ...process.env,
      NODE_OPTIONS: `--require=${control}`,
      SEAL_TEST_KERNEL_BLOCK_STATE: blockState,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const run = attach(child);
  t.after(run.kill);
  await run.waitFor(/Approve\? \[y\/N\]/);
  fs.writeFileSync(blockState, "retry");
  child.stdin.write("y\n");
  await run.waitForErr(new RegExp(`^seal: kernel timing active phase: ${phase}$`, "m"));
  // The active-phase line is the first timing diagnostic. Wait for the last
  // required timing section before ending the demo, so this test observes the
  // complete refusal rather than killing the process during its stderr write.
  await run.waitForErr(/^seal: kernel timing unmeasured spans:$/m);
  run.kill();
  const code = await run.exit;
  return { code, ...run };
}

// --- demo acceptance --------------------------------------------------------

test("seal demo: input_required, approve once, replay refused, then direct write; counts from the child's file", async (t) => {
  const dir = testTmpdir("seal-spine2-demo-");
  const countFile = path.join(dir, "child", "data.txt.count");
  const child = spawn(process.execPath, [SEAL, "demo", "--dir", dir], { stdio: ["pipe", "pipe", "pipe"] });
  const run = attach(child);
  t.after(run.kill);

  await run.waitFor(/INPUT REQUIRED/);
  await run.waitFor(/Approve\? \[y\/N\]/);
  assert.equal(readCount(countFile), "0", "child must have observed zero calls before approval");
  assert.match(run.out, /child calls observed: 0/);
  // The contract's fixed dialog is displayed, not summarised.
  assert.match(run.out, /Approval required/);
  assert.match(run.out, /Tool: demo\.mutate/);
  assert.match(run.out, /at most one run; 2 min/);
  assert.match(run.out, /Outside Seal: Bash, network, subprocesses/);

  child.stdin.write("y\n");
  const code = await run.exit;
  run.out = repositoryRelativeOutput(run.out);
  run.err = repositoryRelativeOutput(run.err);
  assert.equal(code, 0, `demo exited ${code}\n--- stdout:\n${run.out}\n--- stderr:\n${run.err}`);

  assert.equal(readCount(countFile), "1", "child must have observed exactly one call after approve + replay");
  assert.equal(run.err, "", "a successful approved retry must not print kernel timing");
  assert.match(run.out, /child calls observed: 1/);
  assert.match(run.out, /still 1/);
  assert.match(run.out, /one-use held/);
  assert.match(run.out, /already_consumed/);

  const receiptPaths = [...run.out.matchAll(/^receipt written: (.+)$/gm)].map((m) => m[1]);
  assert.equal(receiptPaths.length, 3, `expected 3 receipts\n${run.out}`);
  const decisions = receiptPaths.map((p) => JSON.parse(fs.readFileSync(p, "utf8")).action);
  assert.deepEqual(decisions, ["INPUT_REQUIRED", "ALLOW", "BLOCK"]);

  assert.doesNotMatch(run.out, /verif/i);
  const data = fs.readFileSync(path.join(dir, "child", "data.txt"), "utf8");
  assert.deepEqual(data.split("\n").filter(Boolean), [
    "seal demo wrote this line",
    "seal demo wrote this line directly",
  ]);
});

test("seal demo: declining sends a decline retry; child stays at 0", async (t) => {
  const dir = testTmpdir("seal-spine2-demo-decline-");
  const countFile = path.join(dir, "child", "data.txt.count");
  const child = spawn(process.execPath, [SEAL, "demo", "--dir", dir], { stdio: ["pipe", "pipe", "pipe"] });
  const run = attach(child);
  t.after(run.kill);
  await run.waitFor(/Approve\? \[y\/N\]/);
  child.stdin.write("n\n");
  const code = await run.exit;
  assert.equal(code, 0, run.out + run.err);
  assert.equal(readCount(countFile), "0");
  assert.match(run.out, /DECLINED/);
  assert.match(run.out, /nothing was approved/);
});

test("seal demo prints the active kernel phase for blocked workers", async (t) => {
  const phases = ["wasm_load", "decision_execution"];
  for (const phase of phases) {
    const run = await runDemoToKernelRefusal(phase, t);
    assert.ok(run.code === 1 || run.code === null, `${phase}: ${run.out}\n${run.err}`);
    assert.match(run.err, new RegExp(`^seal: kernel timing active phase: ${phase}$`, "m"), run.err);
    assert.match(run.err, /^seal: kernel timing completed phases:$/m, run.err);
    assert.match(run.err, /^seal: kernel timing unmeasured spans:$/m, run.err);
  }
});

test("seal demo ordinary BLOCK keeps its stderr bytes unchanged", async (t) => {
  const dir = testTmpdir("seal-cli-block-demo-");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const child = spawn(process.execPath, [SEAL, "demo", "--dir", dir], { stdio: ["pipe", "pipe", "pipe"] });
  const run = attach(child);
  t.after(run.kill);
  await run.waitFor(/Approve\? \[y\/N\]/);
  child.stdin.write("y\n");
  const code = await run.exit;
  assert.equal(code, 0, `${run.out}\n${run.err}`);
  assert.deepEqual(Buffer.from(run.err), Buffer.from(""));
  assert.match(run.out, /BLOCKED   the shared proxy refused the replay/);
});

// --- protected path ---------------------------------------------------------
// The test is the MCP client on `seal __proxy` stdio. It keeps tools/call
// pending while it answers the proxy's server-to-client elicitation/create.

function spawnProxy(dir, dataFile, extra = {}) {
  const storePath = extra.storePath || path.join(dir, "approvals.journal");
  const proxy = spawn(process.execPath, [
    SEAL, "__proxy",
    "--guard", "demo.mutate",
    "--store", storePath,
    "--receipts", extra.receiptsDir || path.join(dir, "receipts"),
    "--", process.execPath, SEAL, "__demo-server", dataFile,
  ], { stdio: ["pipe", "pipe", "pipe"] });
  const run = attach(proxy);
  const responses = [];
  let buffered = "";
  proxy.stdout.on("data", () => {
    const chunk = run.out.slice(buffered.length);
    buffered = run.out;
    for (const line of chunk.split("\n")) if (line.trim()) responses.push(JSON.parse(line));
  });
  const waitForFrame = (predicate, ms = 15000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      const hit = responses.find(predicate);
      if (hit) { clearInterval(poll); resolve(hit); }
      else if (Date.now() - started > ms) { clearInterval(poll); reject(new Error(`no matching frame\nstdout:\n${run.out}\nstderr:\n${run.err}`)); }
    }, 25);
  });
  const responseFor = (id, ms) => waitForFrame((frame) => frame.id === id && !frame.method, ms);
  const requestFor = (method, ms) => waitForFrame((frame) => frame.method === method, ms);
  return { proxy, run, requestFor, responseFor, responses, storePath };
}

function callParams(line, extraParams = {}) {
  return { jsonrpc: "2.0", method: "tools/call", params: { name: "demo.mutate", arguments: { line }, ...extraParams } };
}

function initialize(proxy, capabilities = { elicitation: {} }, id = 90) {
  proxy.stdin.write(JSON.stringify({
    jsonrpc: "2.0", id, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities },
  }) + "\n");
}

function answer(proxy, request, action, content) {
  const result = content === undefined ? { action } : { action, content };
  proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
}

function receiptFor(dir, decision) {
  const receipts = path.join(dir, "receipts");
  const file = fs.readdirSync(receipts).find((name) => name.endsWith(`-${decision}.json`));
  assert.ok(file, `expected a ${decision} receipt in ${receipts}`);
  return JSON.parse(fs.readFileSync(path.join(receipts, file), "utf8"));
}

test("a top-level batch is refused as one frame and never reaches the child", async (t) => {
  const dir = testTmpdir("seal-batch-frame-");
  const storePath = path.join(dir, "approvals.journal");
  const dataFile = path.join(dir, "data.txt");
  createJournal(storePath);
  const frames = [];
  const proxy = createProxy({
    guardTool: "demo.mutate",
    storePath,
    receiptsDir: path.join(dir, "receipts"),
    childArgv: [process.execPath, path.join(ROOT, "contract", "fixtures", "counting-child.cjs"), dataFile],
    onClientLine(line) { frames.push(JSON.parse(line)); },
  });
  t.after(() => proxy.stop());
  const countFile = `${dataFile}.count`;
  const waitForCount = async () => {
    const started = Date.now();
    while (!fs.existsSync(countFile)) {
      if (Date.now() - started > 5000) assert.fail("counting child did not start");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  await waitForCount();
  proxy.write(JSON.stringify([callParams("batched", {})]));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(readCount(countFile), "0");
  const body = receiptFor(dir, "BLOCK");
  assert.equal(body.tool, "<batch>");
  assert.match(body.reason, /^safety kernel: /);
  assert.deepEqual(frames, [{
    jsonrpc: "2.0",
    id: null,
    error: {
      code: -32600,
      message: "MCP 2025-06-18 does not permit JSON-RPC batches; send each call as its own message.",
    },
  }]);
});

test("a duplicate-key frame is refused before it can reach the child", async (t) => {
  const dir = testTmpdir("seal-duplicate-key-frame-");
  const storePath = path.join(dir, "approvals.journal");
  const dataFile = path.join(dir, "data.txt");
  createJournal(storePath);
  const proxy = createProxy({
    guardTool: "demo.mutate",
    storePath,
    receiptsDir: path.join(dir, "receipts"),
    childArgv: [process.execPath, path.join(ROOT, "contract", "fixtures", "counting-child.cjs"), dataFile],
    onClientLine() {},
  });
  t.after(() => proxy.stop());
  const countFile = `${dataFile}.count`;
  const started = Date.now();
  while (!fs.existsSync(countFile)) {
    if (Date.now() - started > 5000) assert.fail("counting child did not start");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  proxy.write('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"demo.mutate","name":"other","arguments":{}}}');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(readCount(countFile), "0");
  const body = receiptFor(dir, "BLOCK");
  assert.equal(body.tool, "<ambiguous>");
  assert.match(body.reason, /^safety kernel: /);
});

test("all duplicate-key frame shapes refuse with a checker-valid ambiguous receipt", async (t) => {
  const lines = [
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"demo.mutate","name":"other","arguments":{}}}',
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"a":1,"a":2}}',
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":null,"name":null}}',
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":{},"name":{}}}',
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"","name":""}}',
    '{"jsonrpc":"2.0","id":1,"method":"notifications/x","params":{"a":1,"a":2}}',
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"demo.mutate","arguments":{"a":1,"a":2}}}',
  ];
  for (const [index, line] of lines.entries()) {
    const dir = testTmpdir(`seal-duplicate-key-shape-${index}-`);
    const storePath = path.join(dir, "approvals.journal");
    const dataFile = path.join(dir, "data.txt");
    createJournal(storePath);
    const proxy = createProxy({
      guardTool: "demo.mutate",
      storePath,
      receiptsDir: path.join(dir, "receipts"),
      childArgv: [process.execPath, path.join(ROOT, "contract", "fixtures", "counting-child.cjs"), dataFile],
      onClientLine() {},
    });
    t.after(() => proxy.stop());
    const countFile = `${dataFile}.count`;
    const started = Date.now();
    while (!fs.existsSync(countFile)) {
      if (Date.now() - started > 5000) assert.fail(`counting child did not start for shape ${index + 1}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    proxy.write(line);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(readCount(countFile), "0", `shape ${index + 1}`);
    const files = fs.readdirSync(path.join(dir, "receipts"));
    assert.equal(files.length, 1, `shape ${index + 1}`);
    const receiptPath = path.join(dir, "receipts", files[0]);
    const body = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    assert.equal(body.tool, "<ambiguous>", `shape ${index + 1}`);
    const checked = spawnSync(process.execPath, [CHECKER, receiptPath], { encoding: "utf8" });
    assert.equal(checked.status, 0, `shape ${index + 1}: ${checked.stdout}${checked.stderr}`);
  }
});

test("duplicate-key gate controls preserve guarded, unguarded, and ordinary frames", async (t) => {
  const dir = testTmpdir("seal-duplicate-key-controls-");
  const storePath = path.join(dir, "approvals.journal");
  const dataFile = path.join(dir, "data.txt");
  createJournal(storePath);
  const frames = [];
  const proxy = createProxy({
    guardTool: "demo.mutate",
    storePath,
    receiptsDir: path.join(dir, "receipts"),
    childArgv: [process.execPath, path.join(ROOT, "contract", "fixtures", "counting-child.cjs"), dataFile],
    onClientLine(line) { frames.push(JSON.parse(line)); },
  });
  t.after(() => proxy.stop());
  const countFile = `${dataFile}.count`;
  const started = Date.now();
  while (!fs.existsSync(countFile)) {
    if (Date.now() - started > 5000) assert.fail("counting child did not start");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  proxy.write('{"jsonrpc":"2.0","id":90,"method":"initialize","params":{"capabilities":{"elicitation":{}}}}');
  await new Promise((resolve) => setTimeout(resolve, 50));
  const baseline = Number(readCount(countFile));
  proxy.write('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"demo.mutate","arguments":{"line":"guarded alone"}}}');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(Number(readCount(countFile)) - baseline, 0);
  assert.equal(fs.readdirSync(path.join(dir, "receipts")).length, 1);
  const guardedReceipt = JSON.parse(fs.readFileSync(path.join(dir, "receipts", fs.readdirSync(path.join(dir, "receipts"))[0]), "utf8"));
  assert.equal(guardedReceipt.tool, "demo.mutate");
  assert.notEqual(guardedReceipt.tool, "<ambiguous>");
  assert.equal(frames.filter((frame) => frame.method === "elicitation/create").length, 1);

  proxy.write('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"demo.read","arguments":{"line":"unguarded"}}}');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(Number(readCount(countFile)) - baseline, 1);
  assert.equal(fs.readdirSync(path.join(dir, "receipts")).length, 1);

  const falseLookalike = JSON.stringify({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "demo.read", arguments: { text: '{"a":1,"a":2}' } },
  });
  const largeParams = { name: "demo.read", arguments: {} };
  for (let index = 0; index < 100; index += 1) largeParams.arguments[`key${index}`] = index;
  proxy.write(falseLookalike);
  proxy.write(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: largeParams }));
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(Number(readCount(countFile)) - baseline, 3);
  assert.equal(fs.readdirSync(path.join(dir, "receipts")).length, 1);
});

test("a client without elicitation gets a named refusal and no held call", async (t) => {
  const dir = testTmpdir("seal-receipt-correlation-");
  const dataFile = path.join(dir, "data.txt");
  execFileSync(process.execPath, [SEAL, "__proxy", "--init-store", "--store", path.join(dir, "approvals.journal")]);
  const { proxy, run, responseFor } = spawnProxy(dir, dataFile);
  t.after(run.kill);
  initialize(proxy, {});
  await responseFor(90);
  proxy.stdin.write(JSON.stringify({ ...callParams("receipt correlation"), id: 1 }) + "\n");
  const refused = await responseFor(1);
  assert.equal(refused.result.isError, true);
  assert.match(refused.result.content[0].text, /client_elicitation_unsupported/);
  assert.match(refused.result.content[0].text, /cannot present an approval/);
  assert.equal(readCount(`${dataFile}.count`), "0");
  proxy.stdin.end();
  assert.equal(await run.exit, 0, run.err);
});

test("real elicitation accept flows once and duplicate or unmatched responses do not flow", async (t) => {
  const dir = testTmpdir("seal-receipt-approved-retry-");
  const dataFile = path.join(dir, "data.txt");
  execFileSync(process.execPath, [SEAL, "__proxy", "--init-store", "--store", path.join(dir, "approvals.journal")]);
  const { proxy, run, requestFor, responseFor } = spawnProxy(dir, dataFile);
  t.after(run.kill);
  initialize(proxy);
  await responseFor(90);
  proxy.stdin.write(JSON.stringify({ ...callParams("approved correlation"), id: 1 }) + "\n");
  const request = await requestFor("elicitation/create");
  assert.match(request.id, /^seal-elicitation\/v1\.[0-9a-f]{64}$/);
  assert.deepEqual(request.params.requestedSchema, {
    type: "object",
    properties: { approve: { type: "boolean", title: "Approve one run: demo.mutate", description: "Arguments: line: \"approved correlation\". Scope: at most one run." } },
    required: ["approve"],
  });
  assert.equal(readCount(`${dataFile}.count`), "0");
  proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: `seal-elicitation/v1.${"00".repeat(32)}`, result: { action: "accept", content: { approve: true } } }) + "\n");
  assert.equal(readCount(`${dataFile}.count`), "0");
  answer(proxy, request, "accept", { approve: true });
  const flowed = await responseFor(1);
  assert.ok(!flowed.result.isError, JSON.stringify(flowed));
  assert.equal(readCount(`${dataFile}.count`), "1");
  answer(proxy, request, "accept", { approve: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(readCount(`${dataFile}.count`), "1");
  assert.deepEqual(receiptFor(dir, "ALLOW").arguments, receiptFor(dir, "INPUT_REQUIRED").arguments);
  const receipt = receiptFor(dir, "INPUT_REQUIRED");
  assert.ok(!Object.hasOwn(receipt, "requestState"));
  assert.ok(!Object.hasOwn(receipt, "approvalRequest"));
  proxy.stdin.end();
  assert.equal(await run.exit, 0, run.err);
});

for (const action of ["decline", "cancel"]) test(`real elicitation ${action} refuses and does not flow`, async (t) => {
  const dir = testTmpdir(`seal-elicit-${action}-`);
  const dataFile = path.join(dir, "data.txt");
  execFileSync(process.execPath, [SEAL, "__proxy", "--init-store", "--store", path.join(dir, "approvals.journal")]);
  const { proxy, run, requestFor, responseFor } = spawnProxy(dir, dataFile);
  t.after(run.kill);
  initialize(proxy);
  await responseFor(90);
  proxy.stdin.write(JSON.stringify({ ...callParams(`${action} line`), id: 1 }) + "\n");
  const request = await requestFor("elicitation/create");
  answer(proxy, request, action);
  const refused = await responseFor(1);
  assert.equal(refused.result.isError, true);
  assert.match(refused.result.content[0].text, new RegExp(action === "decline" ? "declined" : "cancelled"));
  assert.equal(readCount(`${dataFile}.count`), "0");
  proxy.stdin.end();
  assert.equal(await run.exit, 0, run.err);
});

test("the retired client-supplied continuation shape is refused", async (t) => {
  const dir = testTmpdir("seal-receipt-only-retry-");
  const dataFile = path.join(dir, "data.txt");
  execFileSync(process.execPath, [SEAL, "__proxy", "--init-store", "--store", path.join(dir, "approvals.journal")]);
  const { proxy, run, responseFor } = spawnProxy(dir, dataFile);
  t.after(run.kill);
  initialize(proxy);
  await responseFor(90);
  proxy.stdin.write(JSON.stringify({ ...callParams("retired retry", {
    requestState: `seal-rs1.${"ab".repeat(32)}`,
    inputResponses: { approval: { action: "accept", content: { approve: true } } },
  }), id: 2 }) + "\n");
  const refused = await responseFor(2);
  assert.equal(refused.result.isError, true);
  assert.match(refused.result.content[0].text, /response_malformed/);
  assert.match(refused.result.content[0].text, /answer the elicitation\/create request/);
  assert.equal(readCount(`${dataFile}.count`), "0");
  proxy.stdin.end();
  assert.equal(await run.exit, 0, run.err);
});

test("two guarded calls receive distinct elicitation ids", async (t) => {
  const dir = testTmpdir("seal-elicit-distinct-");
  const dataFile = path.join(dir, "data.txt");
  execFileSync(process.execPath, [SEAL, "__proxy", "--init-store", "--store", path.join(dir, "approvals.journal")]);
  const { proxy, run, responses, responseFor } = spawnProxy(dir, dataFile);
  t.after(run.kill);
  initialize(proxy);
  await responseFor(90);
  proxy.stdin.write(JSON.stringify({ ...callParams("first"), id: 1 }) + "\n");
  proxy.stdin.write(JSON.stringify({ ...callParams("second"), id: 2 }) + "\n");
  const started = Date.now();
  while (responses.filter((frame) => frame.method === "elicitation/create").length < 2) {
    if (Date.now() - started > 5000) assert.fail(JSON.stringify(responses));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const ids = responses.filter((frame) => frame.method === "elicitation/create").map((frame) => frame.id);
  assert.equal(new Set(ids).size, 2);
  proxy.stdin.end();
  assert.equal(await run.exit, 0, run.err);
});

test("receipt correlations refuse loudly at capacity without orphaning live approvals", async (t) => {
  const dir = testTmpdir("seal-elicit-correlation-capacity-");
  const storePath = path.join(dir, "approvals.journal");
  const dataFile = path.join(dir, "data.txt");
  createJournal(storePath);
  const frames = [];
  const proxy = createProxy({
    guardTool: "demo.mutate",
    storePath,
    receiptsDir: path.join(dir, "receipts"),
    receiptCorrelationCapacity: 1,
    childArgv: [process.execPath, SEAL, "__demo-server", dataFile],
    onClientLine(line) { frames.push(JSON.parse(line)); },
  });
  t.after(() => proxy.stop());
  const waitFor = async (predicate) => {
    const deadline = Date.now() + 5000;
    while (!frames.find(predicate)) {
      if (Date.now() >= deadline) assert.fail(JSON.stringify(frames));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return frames.find(predicate);
  };

  proxy.write(JSON.stringify({ jsonrpc: "2.0", id: 90, method: "initialize", params: { capabilities: { elicitation: {} } } }));
  proxy.write(JSON.stringify({ ...callParams("live approval"), id: 1 }));
  const elicitation = await waitFor((frame) => frame.method === "elicitation/create");
  assert.equal(readCount(`${dataFile}.count`), "0", "the live approval must not flow before its answer");

  proxy.write(JSON.stringify({ ...callParams("over capacity"), id: 2 }));
  const refused = await waitFor((frame) => frame.id === 2 && frame.result);
  assert.equal(refused.result.isError, true);
  assert.match(refused.result.content[0].text, /receipt_correlation_capacity_exceeded/);
  assert.match(refused.result.content[0].text, /receipt correlation capacity 1 is full/);

  proxy.write(JSON.stringify({
    jsonrpc: "2.0",
    id: elicitation.id,
    result: { action: "accept", content: { approve: true } },
  }));
  const allowed = await waitFor((frame) => frame.id === 1 && frame.result);
  assert.equal(allowed.result.isError, undefined, JSON.stringify(allowed));
  assert.equal(readCount(`${dataFile}.count`), "1", "the live approval must remain answerable after the loud refusal");

  proxy.write(JSON.stringify({ ...callParams("capacity reopened"), id: 3 }));
  const reopened = await waitFor((frame) => frame.method === "elicitation/create" && frame.id !== elicitation.id);
  assert.match(reopened.id, /^seal-elicitation\/v1\.[0-9a-f]{64}$/);
});

test("an unanswered capable client times out to cancelled", async (t) => {
  const dir = testTmpdir("seal-elicit-timeout-");
  const storePath = path.join(dir, "approvals.journal");
  createJournal(storePath);
  const frames = [];
  const proxy = createProxy({
    guardTool: "demo.mutate", storePath, receiptsDir: path.join(dir, "receipts"),
    ttlMs: 25,
    childArgv: [process.execPath, SEAL, "__demo-server", path.join(dir, "data.txt")],
    onClientLine(line) { frames.push(JSON.parse(line)); },
  });
  t.after(() => proxy.stop());
  proxy.write(JSON.stringify({ jsonrpc: "2.0", id: 90, method: "initialize", params: { capabilities: { elicitation: {} } } }));
  proxy.write(JSON.stringify({ ...callParams("timeout"), id: 1 }));
  const started = Date.now();
  while (!frames.find((frame) => frame.id === 1 && frame.result)) {
    if (Date.now() - started > 5000) assert.fail(JSON.stringify(frames));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const refused = frames.find((frame) => frame.id === 1 && frame.result);
  assert.match(refused.result.content[0].text, /approval refused: cancelled/);
  assert.match(refused.result.content[0].text, /did not answer elicitation\/create within 25 ms/);
  await proxy.stop();
});

// --- silence must fail ------------------------------------------------------

test("corrupt approval store: exit non-zero, named, never approves, no tick", async (t) => {
  const dir = testTmpdir("seal-spine2-corrupt-");
  const storePath = path.join(dir, "approvals.journal");
  fs.writeFileSync(storePath, "this is not an event\n");
  const { run } = spawnProxy(dir, path.join(dir, "data.txt"), { storePath });
  t.after(run.kill);
  const code = await run.exit;
  assert.notEqual(code, 0);
  assert.match(run.err, /approval store is corrupt/);
  assert.doesNotMatch(run.out, /[✓✔]|ok\b/i);
  assert.equal(fs.existsSync(path.join(dir, "data.txt.count")), false, "no child may start over corrupt state");
});

test("absent approval store: a refusal, not an empty store", async (t) => {
  const dir = testTmpdir("seal-spine2-absent-");
  const { run } = spawnProxy(dir, path.join(dir, "data.txt")); // no --init-store ran
  t.after(run.kill);
  const code = await run.exit;
  assert.notEqual(code, 0);
  assert.match(run.err, /approval store is absent/);
});

test("unreadable approval store: a refusal, not an empty store", async (t) => {
  const dir = testTmpdir("seal-spine2-unreadable-");
  const storePath = path.join(dir, "approvals.journal");
  fs.writeFileSync(storePath, "", { mode: 0o000 });
  const { run } = spawnProxy(dir, path.join(dir, "data.txt"), { storePath });
  t.after(run.kill);
  const code = await run.exit;
  assert.notEqual(code, 0);
  assert.match(run.err, /approval store is unreadable/);
});

// --- supported lane ---------------------------------------------------------

test("unsupported platform returns unsupported, not a warning", async (t) => {
  const dir = testTmpdir("seal-spine2-platform-");
  const child = spawn(process.execPath, [SEAL, "demo", "--dir", dir], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, SEAL_SPINE_PLATFORM: "plan9", SEAL_SPINE_ARCH: "mips" },
  });
  const run = attach(child);
  t.after(run.kill);
  const code = await run.exit;
  assert.notEqual(code, 0);
  assert.match(run.err, /unsupported/);
});
