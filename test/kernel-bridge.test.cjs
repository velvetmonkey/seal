// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFile, execFileSync } = require("node:child_process");
const { promisify } = require("node:util");
const test = require("node:test");

const { createApprovalContract, REFUSALS } = require("../contract/contract.cjs");
const {
  createKernelAuthorizationAdapter,
  DEFAULT_KERNEL_ROOT,
} = require("../contract/kernel-authorization.cjs");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");
const OLD_KERNEL_ROOT = path.join(ROOT, "test-support", "runtime-fixture", "kernel");
const HANGING_WORKER = path.join(ROOT, "test-support", "hanging-kernel-worker.cjs");
const TOOL = "demo.mutate";
const ARGS = { line: "kernel bridge acceptance" };
const ACCEPT = { approval: { action: "accept", content: { approve: true } } };
const execFileAsync = promisify(execFile);

test("the production kernel has one runtime location and the retired fixture path is absent", () => {
  assert.equal(DEFAULT_KERNEL_ROOT, path.join(ROOT, "runtime", "kernel"));
  assert.ok(fs.statSync(path.join(DEFAULT_KERNEL_ROOT, "wasm", "seal.wasm")).isFile());
  assert.equal(fs.existsSync(OLD_KERNEL_ROOT), false);
});

test("a valid kernel placed only at the retired fixture path cannot satisfy the adapter", (t) => {
  const product = fs.mkdtempSync(path.join(os.tmpdir(), "seal-kernel-old-path-only-"));
  t.after(() => fs.rmSync(product, { recursive: true, force: true }));
  fs.mkdirSync(path.join(product, "contract"), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(product, "test-support", "runtime-fixture", "kernel")), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "contract", "kernel-authorization.cjs"), path.join(product, "contract", "kernel-authorization.cjs"));
  fs.copyFileSync(path.join(ROOT, "runtime-manifest.json"), path.join(product, "runtime-manifest.json"));
  fs.cpSync(DEFAULT_KERNEL_ROOT, path.join(product, "test-support", "runtime-fixture", "kernel"), { recursive: true });

  const isolated = require(path.join(product, "contract", "kernel-authorization.cjs"));
  assert.equal(fs.existsSync(isolated.DEFAULT_KERNEL_ROOT), false);
  assert.throws(
    () => isolated.createKernelAuthorizationAdapter().authorize({}),
    (error) => error.code === "kernel_integrity_refused" && /cannot hash the vendored wasm/.test(error.message),
  );
});

function fresh(contract, args = ARGS) {
  return contract.begin({ tool: TOOL, args }).result.requestState;
}

function acceptedRetry(contract, state, overrides = {}) {
  return contract.retry({
    tool: TOOL, args: ARGS, requestState: state, inputResponses: ACCEPT, ...overrides,
  });
}

function proxyHarness(t, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-kernel-real-path-"));
  const store = path.join(dir, "approvals.journal");
  const receipts = path.join(dir, "receipts");
  const data = path.join(dir, "data.txt");
  execFileSync(process.execPath, [SEAL, "__proxy", "--init-store", "--store", store]);
  const child = spawn(process.execPath, [
    SEAL, "__proxy", "--guard", TOOL, "--store", store, "--receipts", receipts,
    "--", process.execPath, SEAL, "__demo-server", data,
  ], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { try { child.kill("SIGKILL"); } catch {} });
  let out = "", err = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { out += chunk; });
  child.stderr.on("data", (chunk) => { err += chunk; });
  async function response(id) {
    const started = Date.now();
    while (Date.now() - started < 15000) {
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        const frame = JSON.parse(line);
        if (frame.id === id) return frame;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`no response ${id}\nstdout:\n${out}\nstderr:\n${err}`);
  }
  function send(id, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params }) + "\n");
  }
  return { child, dir, data, receipts, send, response };
}

function redirectedKernelWorker(t, workerSource) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-mcp-kernel-worker-"));
  const worker = path.join(dir, "worker.cjs");
  const preload = path.join(dir, "redirect-worker.cjs");
  fs.writeFileSync(worker, workerSource);
  fs.writeFileSync(preload, `
const childProcess = require("node:child_process");
const spawnSync = childProcess.spawnSync;
childProcess.spawnSync = function(command, args, options) {
  const input = typeof options?.input === "string" ? JSON.parse(options.input) : {};
  if (input.accepted && Array.isArray(args) && args[0]?.endsWith("kernel-authorization-worker.cjs")) {
    return spawnSync.call(this, command, [${JSON.stringify(worker)}, ...args.slice(1)], options);
  }
  return spawnSync.apply(this, arguments);
};
`);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return preload;
}

test("real MCP retry uses the proved authorization kernel and forwards only its ALLOW", async (t) => {
  const run = proxyHarness(t);
  run.send(1, { name: TOOL, arguments: ARGS });
  const opened = await run.response(1);
  run.send(2, {
    name: TOOL, arguments: ARGS, requestState: opened.result.requestState, inputResponses: ACCEPT,
  });
  const allowed = await run.response(2);
  assert.equal(allowed.result.isError, undefined, JSON.stringify(allowed));
  assert.equal(fs.readFileSync(`${run.data}.count`, "utf8").trim(), "1");
  const allowReceiptName = fs.readdirSync(run.receipts).find((name) => name.endsWith("-ALLOW.json"));
  const receipt = JSON.parse(fs.readFileSync(path.join(run.receipts, allowReceiptName), "utf8"));
  assert.equal(receipt.seal_receipt, "v2");
  assert.equal(receipt.action, "ALLOW");
  assert.equal(receipt.verdict, "ALLOW");
  assert.equal(receipt.tool, TOOL);
  assert.deepEqual(receipt.arguments, ARGS);
  assert.deepEqual(receipt.granted_capabilities.map(({ target }) => target), receipt.kernel_inputs.approvals);
  assert.equal(receipt.kernel_inputs.grants, "");
  assert.equal(receipt.kernel_inputs.forecasts, "");
  run.child.stdin.end();
});

test("real MCP timeout after all child phases reports that worker exit was not observed", async (t) => {
  const control = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "seal-mcp-kernel-timeout-")), "delay-response.cjs");
  fs.writeFileSync(control, `
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = function(chunk, ...rest) {
  if (process.argv[1]?.endsWith("kernel-authorization-worker.cjs") && typeof chunk === "string" && chunk.includes('"verdict":"ALLOW"')) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5100);
  }
  return write(chunk, ...rest);
};
`);
  t.after(() => fs.rmSync(path.dirname(control), { recursive: true, force: true }));
  const run = proxyHarness(t, { NODE_OPTIONS: `--require=${control}` });
  run.send(1, { name: TOOL, arguments: ARGS });
  const opened = await run.response(1);
  run.send(2, {
    name: TOOL, arguments: ARGS, requestState: opened.result.requestState, inputResponses: ACCEPT,
  });
  const refused = await run.response(2);
  assert.equal(refused.result.isError, true, JSON.stringify(refused));
  t.diagnostic(refused.result.content[0].text);
  assert.equal(refused.result.content[0].text, "approval refused: kernel_execution_refused — kernel worker exceeded its 5000 ms deadline; Node authorization did not override the kernel refusal (kernel worker exit was not observed after all measured phases completed)");
  assert.doesNotMatch(refused.result.content[0].text, /null|undefined/);
  run.child.stdin.end();
});

test("real MCP hanging worker with no child phases does not claim measured phases completed", async (t) => {
  const preload = redirectedKernelWorker(t, `
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5100);
`);
  const run = proxyHarness(t, { NODE_OPTIONS: `--require=${preload}` });
  run.send(1, { name: TOOL, arguments: ARGS });
  const opened = await run.response(1);
  run.send(2, {
    name: TOOL, arguments: ARGS, requestState: opened.result.requestState, inputResponses: ACCEPT,
  });
  const refused = await run.response(2);
  assert.equal(refused.result.isError, true, JSON.stringify(refused));
  t.diagnostic(refused.result.content[0].text);
  assert.doesNotMatch(refused.result.content[0].text, /after all measured phases completed/);
  assert.match(refused.result.content[0].text, /kernel worker did not publish a child timing phase/);
  run.child.stdin.end();
});

test("real MCP timeout with partial child phases does not claim measured phases completed", async (t) => {
  const preload = redirectedKernelWorker(t, `
for (const name of [
  "child_bootstrap_to_module_load",
  "child_request_read",
  "child_request_parse",
  "wasm_load",
  "decision_execution",
]) {
  process.stderr.write("SEAL_KERNEL_TIMING_PHASE " + JSON.stringify({
    name,
    clock: "child_process_hrtime_ns",
    timestamps: { started_ns: "1", finished_ns: "2" },
  }) + "\\n");
}
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5100);
`);
  const run = proxyHarness(t, { NODE_OPTIONS: `--require=${preload}` });
  run.send(1, { name: TOOL, arguments: ARGS });
  const opened = await run.response(1);
  run.send(2, {
    name: TOOL, arguments: ARGS, requestState: opened.result.requestState, inputResponses: ACCEPT,
  });
  const refused = await run.response(2);
  assert.equal(refused.result.isError, true, JSON.stringify(refused));
  t.diagnostic(refused.result.content[0].text);
  assert.doesNotMatch(refused.result.content[0].text, /after all measured phases completed/);
  assert.match(refused.result.content[0].text, /kernel worker did not answer/);
  run.child.stdin.end();
});

test("the MCP proxy contains no separate literal child phase-name array", () => {
  const source = fs.readFileSync(path.join(ROOT, "spine", "proxy.cjs"), "utf8");
  assert.doesNotMatch(source, /\[\s*["']child_[a-z_]+["'][\s\S]*?\]/);
});

test("real MCP timeout while a child phase runs still names that phase", async (t) => {
  const control = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "seal-mcp-kernel-phase-")), "delay-decision.cjs");
  fs.writeFileSync(control, `
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  const value = originalLoad.apply(this, arguments);
  if (request.endsWith("runner.cjs")) {
    const decide = value.decide;
    value.decide = async function(...args) {
      if (args[1]?.approvals?.length) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5100);
      return decide.apply(this, args);
    };
  }
  return value;
};
`);
  t.after(() => fs.rmSync(path.dirname(control), { recursive: true, force: true }));
  const run = proxyHarness(t, { NODE_OPTIONS: `--require=${control}` });
  run.send(1, { name: TOOL, arguments: ARGS });
  const opened = await run.response(1);
  run.send(2, {
    name: TOOL, arguments: ARGS, requestState: opened.result.requestState, inputResponses: ACCEPT,
  });
  const refused = await run.response(2);
  assert.equal(refused.result.isError, true, JSON.stringify(refused));
  t.diagnostic(refused.result.content[0].text);
  assert.match(refused.result.content[0].text, /kernel deadline while running decision_execution/);
  run.child.stdin.end();
});

test("authorization rows are presented to the real kernel and alterations are denied", () => {
  const real = createKernelAuthorizationAdapter();
  for (const vector of [
    { overrides: { args: { line: "altered" } }, refusal: REFUSALS.ARGUMENTS_ALTERED },
    { overrides: { tool: "other.tool" }, refusal: REFUSALS.TOOL_ALTERED },
    { overrides: { projectId: "other-project" }, refusal: REFUSALS.CONTEXT_MISMATCH },
  ]) {
    let observed;
    const contract = createApprovalContract({ kernelAdapter: {
      authorize(input) { observed = real.authorize(input); return observed; },
    } });
    const denied = acceptedRetry(contract, fresh(contract), vector.overrides);
    assert.equal(denied.refusal, vector.refusal);
    assert.equal(observed.verdict, "BLOCK");
    assert.match(observed.raw, /\"route\":\"block\"/);
  }
});

test("kernel timing publishes only same-clock timestamp pairs and names cross-process gaps", () => {
  const answer = createKernelAuthorizationAdapter().authorize({
    epoch: 1,
    issuedTool: TOOL,
    issuedArgs: ARGS,
    retryTool: TOOL,
    retryArgs: ARGS,
    accepted: true,
    now: 1000,
  });
  const expected = [
    "parent_request_serialization",
    "parent_response_deserialization",
    "parent_kernel_worker_wait",
    "child_bootstrap_to_module_load",
    "child_request_read",
    "child_request_parse",
    "wasm_load",
    "decision_execution",
    "child_response_construction_and_serialization",
    "module_load_to_request_read",
    "request_read_to_request_parse",
    "request_parse_to_wasm_load",
    "wasm_load_to_decision_execution",
    "decision_execution_to_response_construction",
  ];
  assert.deepEqual(Object.keys(answer.kernel_timing_ms).sort(), expected.sort());
  assert.equal("worker_creation" in answer.kernel_timing_ms, false);
  for (const [clock, phases] of Object.entries(answer.kernel_timing_timestamps)) {
    for (const [name, timestamps] of Object.entries(phases)) {
      if (name === "parent_spawn_invoked_ns") continue;
      assert.match(timestamps.started_ns, /^\d+$/, `${clock}/${name} start`);
      assert.match(timestamps.finished_ns, /^\d+$/, `${clock}/${name} finish`);
      assert.ok(BigInt(timestamps.finished_ns) >= BigInt(timestamps.started_ns), `${clock}/${name} order`);
    }
  }
  assert.match(answer.kernel_timing_unmeasured.parent_spawn_to_first_child_instruction, /^UNMEASURED:/);
  assert.match(answer.kernel_timing_unmeasured.request_pipe_delivery, /^UNMEASURED:/);
  assert.match(answer.kernel_timing_unmeasured.response_pipe_return, /^UNMEASURED:/);
  assert.equal(answer.kernel_timing_active_phase, null);
});

test("Node state rows refuse without consulting the authorization kernel", () => {
  const never = { authorize() { throw new Error("kernel must not be called for a state refusal"); } };
  let clock = 1000;
  const contract = createApprovalContract({ kernelAdapter: never, now: () => clock, ttlMs: 10 });
  const state = fresh(contract);
  assert.equal(acceptedRetry(contract, "bad").refusal, REFUSALS.STATE_MALFORMED);
  assert.equal(acceptedRetry(contract, `seal-rs1.${"ab".repeat(32)}`).refusal, REFUSALS.UNKNOWN_STATE);
  assert.equal(acceptedRetry(contract, state, { inputResponses: {} }).refusal, REFUSALS.RESPONSE_MALFORMED);
  clock = 1011;
  assert.equal(acceptedRetry(contract, state).refusal, REFUSALS.EXPIRED);

  let calls = 0;
  const allow = { authorize() { calls += 1; return { verdict: "ALLOW", raw: "state test" }; } };
  const consumed = createApprovalContract({ kernelAdapter: allow });
  const consumedState = fresh(consumed);
  assert.equal(acceptedRetry(consumed, consumedState).kind, "allow");
  assert.equal(acceptedRetry(consumed, consumedState).refusal, REFUSALS.ALREADY_CONSUMED);
  assert.equal(calls, 1, "replay state refusal must not call the kernel again");
});

test("physical wasm corruption refuses by name with no JavaScript fallback", (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "seal-kernel-corrupt-"));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  fs.cpSync(DEFAULT_KERNEL_ROOT, scratch, { recursive: true });
  const wasm = path.join(scratch, "wasm", "seal.wasm");
  const bytes = fs.readFileSync(wasm);
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  fs.writeFileSync(wasm, bytes);
  const contract = createApprovalContract({
    kernelAdapter: createKernelAuthorizationAdapter({ kernelRoot: scratch }),
  });
  const refused = acceptedRetry(contract, fresh(contract));
  assert.equal(refused.refusal, REFUSALS.KERNEL_INTEGRITY_REFUSED);
  assert.match(refused.detail, /no JavaScript fallback exists/);
});

test("a hung kernel worker reaches its product deadline and refuses closed", () => {
  const contract = createApprovalContract({
    kernelAdapter: createKernelAuthorizationAdapter({ workerPath: HANGING_WORKER }),
  });
  const started = Date.now();
  const refused = acceptedRetry(contract, fresh(contract));
  const elapsed = Date.now() - started;
  assert.equal(refused.refusal, REFUSALS.KERNEL_EXECUTION_REFUSED);
  assert.match(refused.detail, /kernel worker exceeded its 5000 ms deadline/);
  assert.ok(elapsed >= 5000, `worker returned before its deadline: ${elapsed} ms`);
  assert.ok(elapsed < 7000, `worker did not return promptly: ${elapsed} ms`);
});

test("an injected delayed decision carries completed phases through the shipped retry refusal", (t) => {
  const control = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "seal-kernel-delay-")), "delay-kernel-decision.cjs");
  fs.writeFileSync(control, `
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  const loaded = originalLoad.apply(this, arguments);
  if (request.endsWith("runner.cjs")) {
    const decide = loaded.decide;
    loaded.decide = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 5100));
      return decide(...args);
    };
  }
  return loaded;
};
`);
  const originalNodeOptions = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = `${originalNodeOptions ? `${originalNodeOptions} ` : ""}--require=${control}`;
  t.after(() => {
    if (originalNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = originalNodeOptions;
    fs.rmSync(path.dirname(control), { recursive: true, force: true });
  });
  const contract = createApprovalContract({ kernelAdapter: createKernelAuthorizationAdapter() });
  const refused = acceptedRetry(contract, fresh(contract));
  assert.equal(refused.kind, "refuse");
  assert.equal(refused.refusal, REFUSALS.KERNEL_EXECUTION_REFUSED);
  assert.match(refused.detail, /exceeded its 5000 ms deadline/);
  assert.ok(refused.timing, "the returned refusal carries timing");
  const published = Object.keys(refused.timing.kernel_timing_timestamps.child_process_hrtime_ns).sort();
  assert.deepEqual(published, [
    "child_bootstrap_to_module_load",
    "child_request_parse",
    "child_request_read",
    "module_load_to_request_read",
    "request_parse_to_wasm_load",
    "request_read_to_request_parse",
    "wasm_load",
    "wasm_load_to_decision_execution",
  ]);
  assert.deepEqual(Object.keys(refused.timing.kernel_timing_ms).sort(), [
    "child_bootstrap_to_module_load",
    "child_request_parse",
    "child_request_read",
    "module_load_to_request_read",
    "parent_kernel_worker_wait",
    "parent_request_serialization",
    "request_parse_to_wasm_load",
    "request_read_to_request_parse",
    "wasm_load",
    "wasm_load_to_decision_execution",
  ]);
  assert.equal(refused.timing.kernel_timing_active_phase, "decision_execution");
  assert.equal("decision_execution" in refused.timing.kernel_timing_ms, false);
  assert.equal("child_response_construction_and_serialization" in refused.timing.kernel_timing_ms, false);
  t.diagnostic(`timeout refusal received by caller: ${JSON.stringify(refused)}`);
});

test("a response write that does not flush reports completed security work and lifecycle state", (t) => {
  const control = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "seal-kernel-response-write-")), "block.cjs");
  fs.writeFileSync(control, `
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = function(chunk, ...rest) {
  if (typeof chunk === "string" && chunk.includes('"receipt_record"')) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5100);
  }
  return write(chunk, ...rest);
};
`);
  const originalNodeOptions = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = `${originalNodeOptions ? `${originalNodeOptions} ` : ""}--require=${control}`;
  t.after(() => {
    if (originalNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = originalNodeOptions;
    fs.rmSync(path.dirname(control), { recursive: true, force: true });
  });
  const contract = createApprovalContract({ kernelAdapter: createKernelAuthorizationAdapter() });
  const refused = acceptedRetry(contract, fresh(contract));
  assert.equal(refused.refusal, REFUSALS.KERNEL_EXECUTION_REFUSED);
  assert.equal(refused.timing.kernel_timing_active_phase, null);
  assert.deepEqual(Object.keys(refused.timing.kernel_timing_lifecycle).sort(), ["response_generated", "response_write_started"]);
  for (const phase of [
    "child_bootstrap_to_module_load",
    "child_request_read",
    "child_request_parse",
    "wasm_load",
    "decision_execution",
    "child_response_construction_and_serialization",
  ]) assert.equal(typeof refused.timing.kernel_timing_ms[phase], "number", phase);
});

function blockingPreload(phase) {
  const sleep = "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5100);";
  const controls = {
    child_bootstrap_to_module_load: `
const Module = require("node:module");
const load = Module._load;
Module._load = function(request, parent, isMain) {
  if (request.endsWith("runner.cjs")) ${sleep}
  return load.apply(this, arguments);
};`,
    child_request_read: `
const stdinOn = process.stdin.on;
process.stdin.on = function(event, listener) {
  if (event === "data") return stdinOn.call(this, event, (...args) => { ${sleep} return listener(...args); });
  return stdinOn.call(this, event, listener);
};`,
    child_request_parse: `
const parse = JSON.parse;
JSON.parse = function(text, ...rest) {
  if (typeof text === "string" && text.startsWith('{"epoch":')) ${sleep}
  return parse.call(this, text, ...rest);
};`,
    wasm_load: `
const Module = require("node:module");
const load = Module._load;
Module._load = function(request, parent, isMain) {
  const value = load.apply(this, arguments);
  if (request.endsWith("runner.cjs")) {
    const runnerLoad = value.load;
    value.load = async function(...args) { ${sleep} return runnerLoad.apply(this, args); };
  }
  return value;
};`,
    decision_execution: `
const Module = require("node:module");
const load = Module._load;
Module._load = function(request, parent, isMain) {
  const value = load.apply(this, arguments);
  if (request.endsWith("runner.cjs")) {
    const decide = value.decide;
    value.decide = async function(...args) { ${sleep} return decide.apply(this, args); };
  }
  return value;
};`,
    child_response_construction_and_serialization: `
const stringify = JSON.stringify;
JSON.stringify = function(value, ...rest) {
  if (value && value.verdict && value.receipt_record) ${sleep}
  return stringify.call(this, value, ...rest);
};`,
  };
  return controls[phase];
}

test("each blocked worker phase names itself in the timeout refusal", async (t) => {
  const phases = [
    "child_bootstrap_to_module_load",
    "child_request_read",
    "child_request_parse",
    "wasm_load",
    "decision_execution",
    "child_response_construction_and_serialization",
  ];
  const controls = [];
  t.after(() => controls.forEach((control) => fs.rmSync(path.dirname(control), { recursive: true, force: true })));
  const results = await Promise.all(phases.map(async (phase) => {
    const control = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "seal-kernel-phase-")), "block.cjs");
    controls.push(control);
    fs.writeFileSync(control, blockingPreload(phase));
    const program = `
const { createApprovalContract } = require(${JSON.stringify(path.join(ROOT, "contract", "contract.cjs"))});
const { createKernelAuthorizationAdapter } = require(${JSON.stringify(path.join(ROOT, "contract", "kernel-authorization.cjs"))});
const contract = createApprovalContract({ kernelAdapter: createKernelAuthorizationAdapter() });
const state = contract.begin({ tool: ${JSON.stringify(TOOL)}, args: ${JSON.stringify(ARGS)} }).result.requestState;
const result = contract.retry({ tool: ${JSON.stringify(TOOL)}, args: ${JSON.stringify(ARGS)}, requestState: state, inputResponses: ${JSON.stringify(ACCEPT)} });
process.stdout.write(JSON.stringify(result));`;
    const { stdout } = await execFileAsync(process.execPath, ["-e", program], {
      env: { ...process.env, NODE_OPTIONS: `--require=${control}` },
      timeout: 10000,
    });
    return [phase, JSON.parse(stdout)];
  }));
  for (const [phase, refused] of results) {
    assert.equal(refused.refusal, REFUSALS.KERNEL_EXECUTION_REFUSED, `${phase}: ${JSON.stringify(refused)}`);
    assert.equal(refused.timing.kernel_timing_active_phase, phase, phase);
  }
});

test("an active wasm load publishes the gap from request parse to its start", async (t) => {
  const control = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "seal-kernel-active-gap-")), "block.cjs");
  t.after(() => fs.rmSync(path.dirname(control), { recursive: true, force: true }));
  fs.writeFileSync(control, blockingPreload("wasm_load"));
  const program = `
const { createApprovalContract } = require(${JSON.stringify(path.join(ROOT, "contract", "contract.cjs"))});
const { createKernelAuthorizationAdapter } = require(${JSON.stringify(path.join(ROOT, "contract", "kernel-authorization.cjs"))});
const contract = createApprovalContract({ kernelAdapter: createKernelAuthorizationAdapter() });
const state = contract.begin({ tool: ${JSON.stringify(TOOL)}, args: ${JSON.stringify(ARGS)} }).result.requestState;
const result = contract.retry({ tool: ${JSON.stringify(TOOL)}, args: ${JSON.stringify(ARGS)}, requestState: state, inputResponses: ${JSON.stringify(ACCEPT)} });
process.stdout.write(JSON.stringify(result));`;
  const { stdout } = await execFileAsync(process.execPath, ["-e", program], {
    env: { ...process.env, NODE_OPTIONS: `--require=${control}` },
    timeout: 10000,
  });
  const refused = JSON.parse(stdout);
  assert.equal(refused.timing.kernel_timing_active_phase, "wasm_load");
  assert.equal(typeof refused.timing.kernel_timing_ms.request_parse_to_wasm_load, "number");
  assert.ok(refused.timing.kernel_timing_ms.request_parse_to_wasm_load >= 0);
  assert.match(refused.timing.kernel_timing_timestamps.child_process_hrtime_ns.request_parse_to_wasm_load.finished_ns, /^\d+$/);
});

test("Node/kernel authorization disagreement refuses and names the refusing side", () => {
  const contract = createApprovalContract({ kernelAdapter: {
    authorize() { return { verdict: "BLOCK", raw: "injected disagreement" }; },
  } });
  const refused = acceptedRetry(contract, fresh(contract));
  assert.equal(refused.refusal, REFUSALS.AUTHORIZATION_DISAGREEMENT);
  assert.match(refused.detail, /^kernel refused while Node allowed/);
});
