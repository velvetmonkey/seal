// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const test = require("node:test");

const { createApprovalContract, REFUSALS } = require("../contract/contract.cjs");
const {
  createKernelAuthorizationAdapter,
  DEFAULT_KERNEL_ROOT,
} = require("../contract/kernel-authorization.cjs");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");
const HANGING_WORKER = path.join(ROOT, "test-support", "hanging-kernel-worker.cjs");
const TOOL = "demo.mutate";
const ARGS = { line: "kernel bridge acceptance" };
const ACCEPT = { approval: { action: "accept", content: { approve: true } } };

function fresh(contract, args = ARGS) {
  return contract.begin({ tool: TOOL, args }).result.requestState;
}

function acceptedRetry(contract, state, overrides = {}) {
  return contract.retry({
    tool: TOOL, args: ARGS, requestState: state, inputResponses: ACCEPT, ...overrides,
  });
}

function proxyHarness(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-kernel-real-path-"));
  const store = path.join(dir, "approvals.journal");
  const receipts = path.join(dir, "receipts");
  const data = path.join(dir, "data.txt");
  execFileSync(process.execPath, [SEAL, "__proxy", "--init-store", "--store", store]);
  const child = spawn(process.execPath, [
    SEAL, "__proxy", "--guard", TOOL, "--store", store, "--receipts", receipts,
    "--", process.execPath, SEAL, "__demo-server", data,
  ], { stdio: ["pipe", "pipe", "pipe"] });
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
  assert.equal(receipt.evidence.authorization_rule, "PROVED");
  assert.equal(receipt.evidence.state_machine, "TESTED");
  assert.equal(receipt.evidence.kernel.verdict, "ALLOW");
  const raw = JSON.parse(receipt.evidence.kernel.raw);
  const audit = JSON.parse(raw.audit);
  assert.equal(audit.verdict, "allow");
  assert.deepEqual(audit.certs.map((cert) => cert.kernel), ["safety", "temporal"]);
  assert.match(audit.request_sha256, /^[0-9a-f]{64}$/);
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

test("Node/kernel authorization disagreement refuses and names the refusing side", () => {
  const contract = createApprovalContract({ kernelAdapter: {
    authorize() { return { verdict: "BLOCK", raw: "injected disagreement" }; },
  } });
  const refused = acceptedRetry(contract, fresh(contract));
  assert.equal(refused.refusal, REFUSALS.AUTHORIZATION_DISAGREEMENT);
  assert.match(refused.detail, /^kernel refused while Node allowed/);
});
