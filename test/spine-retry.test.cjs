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

const SEAL = path.join(__dirname, "..", "bin", "seal");

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

test("seal demo: input_required, approve once, replay refused; counts from the child's file", async (t) => {
  const dir = tmpdir("seal-spine2-demo-");
  const countFile = path.join(dir, "child", "data.txt.count");
  const child = spawn(process.execPath, [SEAL, "demo", "--dir", dir], { stdio: ["pipe", "pipe", "pipe"] });
  const run = attach(child);
  t.after(run.kill);

  await run.waitFor(/INPUT REQUIRED/);
  await run.waitFor(/Approve\? \[y\/N\]/);
  assert.equal(readCount(countFile), "0", "child must have observed zero calls before approval");
  assert.match(run.out, /child calls observed: 0/);
  // The contract's message is displayed, not summarised.
  assert.match(run.out, /Approve exactly this call, once\./);
  assert.match(run.out, /outside Seal/);

  child.stdin.write("y\n");
  const code = await run.exit;
  assert.equal(code, 0, `demo exited ${code}\n--- stdout:\n${run.out}\n--- stderr:\n${run.err}`);

  assert.equal(readCount(countFile), "1", "child must have observed exactly one call after approve + replay");
  assert.match(run.out, /child calls observed: 1/);
  assert.match(run.out, /still 1/);
  assert.match(run.out, /one-use enforced/);
  assert.match(run.out, /already_consumed/);

  const receiptPaths = [...run.out.matchAll(/^receipt written: (.+)$/gm)].map((m) => m[1]);
  assert.equal(receiptPaths.length, 3, `expected 3 receipts\n${run.out}`);
  const decisions = receiptPaths.map((p) => JSON.parse(fs.readFileSync(p, "utf8")).decision);
  assert.deepEqual(decisions, ["INPUT_REQUIRED", "ALLOW", "BLOCK"]);

  assert.doesNotMatch(run.out, /verif/i);
  const data = fs.readFileSync(path.join(dir, "child", "data.txt"), "utf8");
  assert.equal(data.split("\n").filter(Boolean).length, 1);
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
  assert.match(state, /^seal-approval-v1:/);
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
    env: { ...process.env, SEAL_SPINE_PLATFORM: "darwin", SEAL_SPINE_ARCH: "x64" },
  });
  const run = attach(child);
  t.after(run.kill);
  const code = await run.exit;
  assert.notEqual(code, 0);
  assert.match(run.err, /unsupported/);
});
