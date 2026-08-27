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
const { spawn, execFileSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");
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

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
  return state;
}

// --- demo acceptance --------------------------------------------------------

test("seal demo: input_required, approve once, replay refused, then direct write; counts from the child's file", async (t) => {
  const dir = tmpdir("seal-spine2-demo-");
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
  assert.match(run.out, /child calls observed: 1/);
  assert.match(run.out, /still 1/);
  assert.match(run.out, /one-use held/);
  assert.match(run.out, /already_consumed/);

  const receiptPaths = [...run.out.matchAll(/^receipt written: (.+)$/gm)].map((m) => m[1]);
  assert.equal(receiptPaths.length, 3, `expected 3 receipts\n${run.out}`);
  const decisions = receiptPaths.map((p) => JSON.parse(fs.readFileSync(p, "utf8")).decision);
  assert.deepEqual(decisions, ["INPUT_REQUIRED", "ALLOW", "BLOCK"]);

  assert.doesNotMatch(run.out, /verif/i);
  const data = fs.readFileSync(path.join(dir, "child", "data.txt"), "utf8");
  assert.deepEqual(data.split("\n").filter(Boolean), [
    "seal demo wrote this line",
    "seal demo wrote this line directly",
  ]);
});

test("seal demo: declining sends a decline retry; child stays at 0", async (t) => {
  const dir = tmpdir("seal-spine2-demo-decline-");
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

// --- protected path ---------------------------------------------------------
// The test is the MCP client on `seal __proxy` stdio, speaking the retry
// protocol: tools/call → input_required → fresh tools/call with the answer.

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
  const responseFor = (id, ms = 15000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      const hit = responses.find((r) => r.id === id);
      if (hit) { clearInterval(poll); resolve(hit); }
      else if (Date.now() - started > ms) { clearInterval(poll); reject(new Error(`no response for id ${id}\nstdout:\n${run.out}\nstderr:\n${run.err}`)); }
    }, 25);
  });
  return { proxy, run, responseFor, storePath };
}

function callParams(line, extraParams = {}) {
  return { jsonrpc: "2.0", method: "tools/call", params: { name: "demo.mutate", arguments: { line }, ...extraParams } };
}
const ACCEPT = { approval: { action: "accept", content: { approve: true } } };

test("receipt correlations refuse loudly at capacity without orphaning live approvals", async (t) => {
  const dir = tmpdir("seal-receipt-correlation-capacity-");
  const storePath = path.join(dir, "approvals.journal");
  const receiptsDir = path.join(dir, "receipts");
  const dataFile = path.join(dir, "data.txt");
  createJournal(storePath);
  const responses = [];
  const decisions = [];
  const proxy = createProxy({
    guardTool: "demo.mutate",
    storePath,
    receiptsDir,
    receiptCorrelationCapacity: 2,
    childArgv: [process.execPath, SEAL, "__demo-server", dataFile],
    onClientLine(line) { responses.push(JSON.parse(line)); },
    onDecision(decision) { decisions.push(decision); },
  });
  t.after(() => proxy.stop());

  proxy.write(JSON.stringify({ ...callParams("first pending"), id: 1 }));
  proxy.write(JSON.stringify({ ...callParams("second pending"), id: 2 }));
  proxy.write(JSON.stringify({ ...callParams("over capacity"), id: 3 }));
  assert.equal(responses.find((response) => response.id === 1).result.resultType, "input_required");
  assert.equal(responses.find((response) => response.id === 2).result.resultType, "input_required");
  assert.match(responses.find((response) => response.id === 3).result.content[0].text, /receipt_correlation_capacity_exceeded/);
  assert.equal(decisions.at(-1).refusal, "receipt_correlation_capacity_exceeded");

  const firstState = responses.find((response) => response.id === 1).result.requestState;
  proxy.write(JSON.stringify({ ...callParams("first pending", { requestState: firstState, inputResponses: ACCEPT }), id: 4 }));
  assert.equal(decisions.at(-1).decision, "ALLOW", "the live approval retained its receipt correlation at capacity");
  const receiptFiles = fs.readdirSync(receiptsDir);
  const inputCorrelations = receiptFiles
    .filter((name) => name.endsWith("-INPUT_REQUIRED.json"))
    .map((name) => JSON.parse(fs.readFileSync(path.join(receiptsDir, name), "utf8")).approvalRequest.correlation);
  const allowReceipt = JSON.parse(fs.readFileSync(path.join(receiptsDir, receiptFiles.find((name) => name.endsWith("-ALLOW.json"))), "utf8"));
  assert.ok(inputCorrelations.includes(allowReceipt.approvalRequest.correlation));

  proxy.write(JSON.stringify({ ...callParams("slot reopened"), id: 5 }));
  assert.equal(responses.find((response) => response.id === 5).result.resultType, "input_required");
  await proxy.stop();
});

function receiptFor(dir, decision) {
  const receipts = path.join(dir, "receipts");
  const file = fs.readdirSync(receipts).find((name) => name.endsWith(`-${decision}.json`));
  assert.ok(file, `expected a ${decision} receipt in ${receipts}`);
  return JSON.parse(fs.readFileSync(path.join(receipts, file), "utf8"));
}

test("INPUT_REQUIRED receipt records a non-replayable approval correlation", async (t) => {
  const dir = tmpdir("seal-receipt-correlation-");
  const dataFile = path.join(dir, "data.txt");
  execFileSync(process.execPath, [SEAL, "__proxy", "--init-store", "--store", path.join(dir, "approvals.journal")]);
  const { proxy, run, responseFor } = spawnProxy(dir, dataFile);
  t.after(run.kill);

  proxy.stdin.write(JSON.stringify({ ...callParams("receipt correlation"), id: 1 }) + "\n");
  const opened = await responseFor(1);
  assert.equal(opened.result.resultType, "input_required");
  const receipt = receiptFor(dir, "INPUT_REQUIRED");
  assert.ok(!Object.hasOwn(receipt, "requestState"), "a receipt must never carry the retry credential");
  assert.match(receipt.approvalRequest?.correlation || "", /^seal-receipt-correlation\/v1\.[0-9a-f]{64}$/);
  assert.notEqual(receipt.approvalRequest.correlation, opened.result.requestState);

  proxy.stdin.end();
  assert.equal(await run.exit, 0, run.err);
});

test("approved retry receipt correlates with its INPUT_REQUIRED receipt", async (t) => {
  const dir = tmpdir("seal-receipt-approved-retry-");
  const dataFile = path.join(dir, "data.txt");
  execFileSync(process.execPath, [SEAL, "__proxy", "--init-store", "--store", path.join(dir, "approvals.journal")]);
  const { proxy, run, responseFor } = spawnProxy(dir, dataFile);
  t.after(run.kill);

  proxy.stdin.write(JSON.stringify({ ...callParams("approved correlation"), id: 1 }) + "\n");
  const opened = await responseFor(1);
  proxy.stdin.write(JSON.stringify({ ...callParams("approved correlation", { requestState: opened.result.requestState, inputResponses: ACCEPT }), id: 2 }) + "\n");
  const flowed = await responseFor(2);
  assert.ok(!flowed.result.isError, JSON.stringify(flowed));
  assert.equal(readCount(`${dataFile}.count`), "1");
  assert.equal(receiptFor(dir, "ALLOW").approvalRequest.correlation, receiptFor(dir, "INPUT_REQUIRED").approvalRequest.correlation);

  proxy.stdin.end();
  assert.equal(await run.exit, 0, run.err);
});

test("retry using only an INPUT_REQUIRED receipt is refused as state_malformed", async (t) => {
  const dir = tmpdir("seal-receipt-only-retry-");
  const dataFile = path.join(dir, "data.txt");
  execFileSync(process.execPath, [SEAL, "__proxy", "--init-store", "--store", path.join(dir, "approvals.journal")]);
  const { proxy, run, responseFor } = spawnProxy(dir, dataFile);
  t.after(run.kill);

  // Establish the child-owned count file before asserting that refusal left it
  // at zero. Without this round trip, Node 20 can observe the refusal before
  // the spawned demo server has created its startup count file.
  proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 90, method: "initialize", params: {} }) + "\n");
  await responseFor(90);
  proxy.stdin.write(JSON.stringify({ ...callParams("receipt-only retry"), id: 1 }) + "\n");
  await responseFor(1);
  const receipt = receiptFor(dir, "INPUT_REQUIRED");
  proxy.stdin.write(JSON.stringify({ ...callParams("receipt-only retry", { requestState: receipt.approvalRequest.correlation, inputResponses: ACCEPT }), id: 2 }) + "\n");
  const refused = await responseFor(2);
  assert.equal(refused.result.isError, true);
  assert.match(refused.result.content[0].text, /state_malformed/);
  assert.equal(readCount(`${dataFile}.count`), "0");

  proxy.stdin.end();
  assert.equal(await run.exit, 0, run.err);
});

test("seal __proxy: input_required, approved retry flows once, replay refused; counts from the child's file", async (t) => {
  const dir = tmpdir("seal-spine2-proxy-");
  const dataFile = path.join(dir, "data.txt");
  const countFile = `${dataFile}.count`;
  execFileSync(process.execPath, [SEAL, "__proxy", "--init-store", "--store", path.join(dir, "approvals.journal")]);
  const { proxy, run, responseFor } = spawnProxy(dir, dataFile);
  t.after(run.kill);

  proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  const init = await responseFor(1);
  assert.equal(init.result.serverInfo.name, "seal __demo-server");

  proxy.stdin.write(JSON.stringify({ ...callParams("protected line"), id: 2 }) + "\n");
  const opened = await responseFor(2);
  assert.equal(opened.result.resultType, "input_required");
  const state = opened.result.requestState;
  assert.match(state, /^seal-rs1\.[0-9a-f]{64}$/);
  assert.equal(readCount(countFile), "0");

  proxy.stdin.write(JSON.stringify({ ...callParams("protected line", { requestState: state, inputResponses: ACCEPT }), id: 3 }) + "\n");
  const flowed = await responseFor(3);
  assert.ok(!flowed.result.isError, JSON.stringify(flowed));
  assert.match(flowed.result.content[0].text, /appended/);
  assert.equal(readCount(countFile), "1");

  proxy.stdin.write(JSON.stringify({ ...callParams("protected line", { requestState: state, inputResponses: ACCEPT }), id: 4 }) + "\n");
  const replayed = await responseFor(4);
  assert.equal(replayed.result.isError, true);
  assert.match(replayed.result.content[0].text, /already_consumed/);
  assert.equal(readCount(countFile), "1", "the one-use approval must not admit a second call");

  proxy.stdin.end();
  assert.equal(await run.exit, 0, run.err);
});

// --- durability: one-use survives a process restart -------------------------

test("restart survival: an approval consumed before restart is refused after restart", async (t) => {
  const dir = tmpdir("seal-spine2-restart-");
  const storePath = path.join(dir, "approvals.journal");
  execFileSync(process.execPath, [SEAL, "__proxy", "--init-store", "--store", storePath]);

  // Session A: mint and consume.
  const dataA = path.join(dir, "a", "data.txt");
  const a = spawnProxy(dir, dataA, { storePath, receiptsDir: path.join(dir, "receipts") });
  t.after(a.run.kill);
  a.proxy.stdin.write(JSON.stringify({ ...callParams("restart line"), id: 1 }) + "\n");
  const opened = await a.responseFor(1);
  const state = opened.result.requestState;
  a.proxy.stdin.write(JSON.stringify({ ...callParams("restart line", { requestState: state, inputResponses: ACCEPT }), id: 2 }) + "\n");
  const flowed = await a.responseFor(2);
  assert.ok(!flowed.result.isError);
  assert.equal(readCount(`${dataA}.count`), "1");
  a.proxy.stdin.end();
  assert.equal(await a.run.exit, 0, a.run.err);

  // Session B: a NEW process on the SAME journal, a fresh child.
  const dataB = path.join(dir, "b", "data.txt");
  const b = spawnProxy(dir, dataB, { storePath, receiptsDir: path.join(dir, "receipts") });
  t.after(b.run.kill);
  // Round-trip through the child first so its count file exists before we read it.
  b.proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 90, method: "initialize", params: {} }) + "\n");
  await b.responseFor(90);
  b.proxy.stdin.write(JSON.stringify({ ...callParams("restart line", { requestState: state, inputResponses: ACCEPT }), id: 1 }) + "\n");
  const replayed = await b.responseFor(1);
  assert.equal(replayed.result.isError, true);
  assert.match(replayed.result.content[0].text, /already_consumed/,
    "a one-use rule that forgets on restart is not one use");
  assert.equal(readCount(`${dataB}.count`), "0", "the restarted proxy's child must receive nothing");
  b.proxy.stdin.end();
  assert.equal(await b.run.exit, 0, b.run.err);
});

test("restart invalidation: a PENDING continuation does not survive a restart", async (t) => {
  const dir = tmpdir("seal-spine2-pending-");
  const storePath = path.join(dir, "approvals.journal");
  execFileSync(process.execPath, [SEAL, "__proxy", "--init-store", "--store", storePath]);

  // Session A: open a continuation, answer nothing, exit.
  const dataA = path.join(dir, "a", "data.txt");
  const a = spawnProxy(dir, dataA, { storePath, receiptsDir: path.join(dir, "receipts") });
  t.after(a.run.kill);
  a.proxy.stdin.write(JSON.stringify({ ...callParams("pending line"), id: 1 }) + "\n");
  const opened = await a.responseFor(1);
  const state = opened.result.requestState;
  assert.equal(opened.result.resultType, "input_required");
  a.proxy.stdin.end();
  assert.equal(await a.run.exit, 0, a.run.err);

  // Session B: the old pending handle must be invalid; a fresh call is forced.
  const dataB = path.join(dir, "b", "data.txt");
  const b = spawnProxy(dir, dataB, { storePath, receiptsDir: path.join(dir, "receipts") });
  t.after(b.run.kill);
  b.proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 90, method: "initialize", params: {} }) + "\n");
  await b.responseFor(90);
  b.proxy.stdin.write(JSON.stringify({ ...callParams("pending line", { requestState: state, inputResponses: ACCEPT }), id: 1 }) + "\n");
  const stale = await b.responseFor(1);
  assert.equal(stale.result.isError, true);
  assert.match(stale.result.content[0].text, /restart_invalidated/);
  assert.equal(readCount(`${dataB}.count`), "0", "an invalidated continuation may not touch the child");
  // A fresh call still works in session B.
  b.proxy.stdin.write(JSON.stringify({ ...callParams("pending line"), id: 2 }) + "\n");
  const fresh = await b.responseFor(2);
  assert.equal(fresh.result.resultType, "input_required");
  b.proxy.stdin.end();
  assert.equal(await b.run.exit, 0, b.run.err);
});

// --- silence must fail ------------------------------------------------------

test("corrupt approval store: exit non-zero, named, never approves, no tick", async (t) => {
  const dir = tmpdir("seal-spine2-corrupt-");
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
  const dir = tmpdir("seal-spine2-absent-");
  const { run } = spawnProxy(dir, path.join(dir, "data.txt")); // no --init-store ran
  t.after(run.kill);
  const code = await run.exit;
  assert.notEqual(code, 0);
  assert.match(run.err, /approval store is absent/);
});

test("unreadable approval store: a refusal, not an empty store", async (t) => {
  const dir = tmpdir("seal-spine2-unreadable-");
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
  const dir = tmpdir("seal-spine2-platform-");
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
