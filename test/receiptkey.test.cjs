// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");
const CHECKER = path.join(ROOT, "checker", "seal-receipt-v2.mjs");
const SCRATCH = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, "receiptkey")
  : "/home/monkey/scratch/receiptkey";
const { createJournal } = require("../spine/store.cjs");
const { createProxy } = require("../spine/proxy.cjs");
const { loadReceiptSigner, projectId, readProjectServer, receiptKeyPaths, statePathFor } = require("../spine/protection.cjs");

function fixture() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const root = testTmpdir(path.join(SCRATCH, "test-"));
  const project = path.join(root, "project");
  const dataHome = path.join(root, "data-home");
  const receiptsDir = path.join(root, "receipts");
  const storePath = path.join(root, "approvals.journal");
  const dataFile = path.join(root, "child-data.txt");
  fs.mkdirSync(project);
  const server = { command: process.execPath, args: [SEAL, "__demo-server", dataFile] };
  fs.writeFileSync(path.join(project, ".mcp.json"), `${JSON.stringify({ mcpServers: { db: server } }, null, 2)}\n`);
  createJournal(storePath);
  const env = { ...process.env, HOME: path.join(root, "home"), XDG_DATA_HOME: dataHome };
  const observed = readProjectServer(project, "db");
  const statePath = statePathFor(project, env);
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(statePath, `${JSON.stringify({
    schema: "seal.protect/v1",
    sealVersion: fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim(),
    state: "PENDING RESTART",
    projectRoot: project,
    projectId: projectId(project),
    serverName: "db",
    projectServerDigest: observed.serverDigest,
    guardTool: "demo.mutate",
    storePath,
    receiptsDir,
    childArgv: observed.childArgv,
    childEnv: observed.childEnv,
    lease: null,
  }, null, 2)}\n`, { mode: 0o600 });
  return { env, project, receiptsDir, statePath };
}

function waitForJson(stream, id, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for response ${id}: ${buffered}`)), timeoutMs);
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const frame = JSON.parse(line);
        if (frame.id === id) {
          clearTimeout(timeout);
          resolve(frame);
        }
      }
    });
  });
}

function waitForMethod(stream, method, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for request ${method}: ${buffered}`)), timeoutMs);
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const frame = JSON.parse(line);
        if (frame.method === method) {
          clearTimeout(timeout);
          resolve(frame);
        }
      }
    });
  });
}

test("protected-path receipts carry the durable signer through proxy-cli's enumerated rebuild", async () => {
  const ctx = fixture();
  const proxy = spawn(process.execPath, [SEAL, "__proxy", "--protect-state", ctx.statePath], {
    cwd: ctx.project,
    env: ctx.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  proxy.stderr.setEncoding("utf8");
  proxy.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    const initialized = waitForJson(proxy.stdout, 0);
    proxy.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0", id: 0, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: { elicitation: {} } },
    })}\n`);
    await initialized;
    const active = JSON.parse(fs.readFileSync(ctx.statePath, "utf8"));
    assert.equal(active.state, "ACTIVE");
    assert.equal(active.lease.pid, proxy.pid);
    const response = waitForMethod(proxy.stdout, "elicitation/create");
    proxy.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "demo.mutate", arguments: { line: "receipt-key-control" } },
    })}\n`);
    assert.match((await response).id, /^seal-elicitation\/v1\.[0-9a-f]{64}$/);
    const issued = fs.readFileSync(active.storePath, "utf8").trim().split("\n").map(JSON.parse).find((event) => event.type === "issued");
    assert.ok(issued);
    assert.equal(issued.project_id, active.projectId);
    assert.equal(issued.server_id, active.serverName);
    console.log(JSON.stringify({ case: "valid identity success", state: active.state, project_id: issued.project_id, server_id: issued.server_id }));
  } finally {
    proxy.stdin.end();
    await new Promise((resolve) => proxy.once("close", resolve));
  }

  assert.match(stderr, /SEAL RECEIPT SIGNING KEY CREATED/);
  const receiptName = fs.readdirSync(ctx.receiptsDir).find((name) => name.endsWith("-INPUT_REQUIRED.json"));
  assert.ok(receiptName, "protected proxy did not emit its decision receipt");
  const receiptPath = path.join(ctx.receiptsDir, receiptName);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  assert.equal(receipt.signature.algorithm, "ed25519", "signer was dropped before receipt emission");
  const { signature, ...body } = receipt;
  const verify = require("node:crypto").verify(null,
    Buffer.from(require("../spine/receipt-v2.cjs").canonical(body), "utf8"),
    loadReceiptSigner(ctx.env).publicKey, Buffer.from(signature.value, "hex"));
  console.log(`verify:${verify}`);
  assert.equal(verify, true, "protected-path receipt signature must verify");

  const keys = receiptKeyPaths(ctx.env);
  assert.equal(fs.statSync(keys.directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(keys.privateKey).mode & 0o777, 0o600);
  assert.equal(fs.statSync(keys.publicKey).mode & 0o777, 0o644);
  const checked = require("node:child_process").spawnSync(process.execPath, [CHECKER, receiptPath, "--pubkey", fs.readFileSync(keys.publicKey, "utf8").trim()], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.match(checked.stdout, /Signature and bindings   VALID/);
  assert.match(checked.stdout, /Verifier-local verdict   REPRODUCED/);
  assert.match(checked.stdout, /Event occurrence         NOT ESTABLISHED/);
});

for (const [name, identity] of [
  ["empty serverName", { projectId: "plant-project-313", serverName: "" }],
  ["legacy identity absent", {}],
  ["projectId absent", { serverName: "db" }],
  ["empty projectId", { projectId: "", serverName: "db" }],
  ["serverName absent", { projectId: "plant-project-313" }],
]) {
  test(`proxy-cli refuses ${name} before startup side effects`, () => {
    const ctx = fixture();
    const state = JSON.parse(fs.readFileSync(ctx.statePath, "utf8"));
    delete state.projectId;
    delete state.serverName;
    Object.assign(state, identity);
    fs.writeFileSync(ctx.statePath, JSON.stringify(state));
    const before = fs.readFileSync(ctx.statePath, "utf8");
    const result = spawnSync(process.execPath, [SEAL, "__proxy", "--protect-state", ctx.statePath], {
      cwd: ctx.project, env: ctx.env, encoding: "utf8", timeout: 10000,
    });
    const observed = JSON.parse(fs.readFileSync(ctx.statePath, "utf8"));
    console.log(JSON.stringify({ case: name, exit: result.status, stderr: result.stderr.trim(), state: observed.state, lease: observed.lease, unchanged: fs.readFileSync(ctx.statePath, "utf8") === before }));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /seal __proxy: identity_absent:/);
    assert.doesNotMatch(result.stderr, /drifted|SIGNING KEY CREATED/);
    assert.equal(fs.readFileSync(ctx.statePath, "utf8"), before, "refusal must not mutate state or commit a lease");
    assert.equal(fs.readFileSync(state.storePath, "utf8"), "");
    assert.equal(fs.existsSync(receiptKeyPaths(ctx.env).directory), false);
    assert.equal(fs.existsSync(ctx.receiptsDir), false);
  });
}

for (const discoveryFails of [false, true]) {
  test(`proxy-cli rechecks identity after discovery ${discoveryFails ? "fails" : "succeeds"}`, () => {
    const ctx = fixture();
    const state = JSON.parse(fs.readFileSync(ctx.statePath, "utf8"));
    // A real discovery child removes projectId while activation is outside
    // the lock. Both lease commit and failure cleanup must validate again.
    const script = `
      const fs = require("node:fs");
      require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
        const request = JSON.parse(line);
        if (request.method === "initialize") {
          console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "identity-race", version: "1" } } }));
        } else if (request.method === "tools/list") {
          const statePath = process.argv[1];
          const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
          delete state.projectId;
          fs.writeFileSync(statePath, JSON.stringify(state));
          if (${discoveryFails}) process.exit(1);
          console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "demo.mutate", inputSchema: { type: "object" } }] } }));
        }
      });
    `;
    fs.writeFileSync(path.join(ctx.project, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: process.execPath, args: ["-e", script, ctx.statePath] } } }));
    const observed = readProjectServer(ctx.project, "db");
    Object.assign(state, { childArgv: observed.childArgv, projectServerDigest: observed.serverDigest });
    fs.writeFileSync(ctx.statePath, JSON.stringify(state));
    const result = spawnSync(process.execPath, [SEAL, "__proxy", "--protect-state", ctx.statePath], {
      cwd: ctx.project, env: ctx.env, encoding: "utf8", timeout: 10000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /seal __proxy: identity_absent:/);
    const after = JSON.parse(fs.readFileSync(ctx.statePath, "utf8"));
    const expected = { ...state };
    delete expected.projectId;
    assert.deepEqual(after, expected, "activation must not mutate the identity-less record");
    assert.equal(after.lease, null);
    assert.equal(fs.readFileSync(state.storePath, "utf8"), "");
    assert.equal(fs.existsSync(receiptKeyPaths(ctx.env).directory), false);
  });
}

test("proxy-cli with valid identity still refuses genuine route drift", () => {
  const ctx = fixture();
  const state = JSON.parse(fs.readFileSync(ctx.statePath, "utf8"));
  const configPath = path.join(ctx.project, ".mcp.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.mcpServers.db.args.push("changed-route");
  fs.writeFileSync(configPath, JSON.stringify(config));
  const result = spawnSync(process.execPath, [SEAL, "__proxy", "--protect-state", ctx.statePath], {
    cwd: ctx.project, env: ctx.env, encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /seal __proxy: drifted:/);
  assert.doesNotMatch(result.stderr, /identity_absent/);
  const after = JSON.parse(fs.readFileSync(ctx.statePath, "utf8"));
  assert.equal(after.state, "DRIFTED");
  assert.equal(after.lease, null);
  assert.equal(fs.readFileSync(state.storePath, "utf8"), "");
  console.log(JSON.stringify({ case: "valid identity, real drift", exit: result.status, stderr: result.stderr.trim(), state: after.state, lease: after.lease }));
});

test("proxy threads distinct route identities into both approval journals", async (t) => {
  const root = testTmpdir(path.join(SCRATCH, "route-identity-"));
  const observed = [];
  const proxies = [];
  for (const route of [
    { projectId: "project-alpha", serverName: "server-one" },
    { projectId: "project-beta", serverName: "server-two" },
  ]) {
    const dir = path.join(root, route.serverName);
    fs.mkdirSync(dir, { recursive: true });
    const storePath = path.join(dir, "approvals.journal");
    createJournal(storePath);
    const proxy = createProxy({
      signer: loadReceiptSigner({ XDG_DATA_HOME: path.join(dir, "keys") }),
      guardTool: "demo.mutate",
      storePath,
      receiptsDir: path.join(dir, "receipts"),
      childArgv: [process.execPath, path.join(ROOT, "contract", "fixtures", "counting-child.cjs"), path.join(dir, "data")],
      projectId: route.projectId,
      serverName: route.serverName,
      onClientLine: () => {},
    });
    proxies.push(proxy);
    proxy.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { elicitation: {} } } }));
    proxy.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "demo.mutate", arguments: { line: route.serverName } } }));
    let issued;
    for (let attempt = 0; attempt < 100 && !issued; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const lines = fs.readFileSync(storePath, "utf8").trim().split("\n").filter(Boolean);
      issued = lines.map(JSON.parse).find((event) => event.type === "issued");
    }
    assert.ok(issued, `no issued event for ${route.serverName}`);
    observed.push({ project_id: issued.project_id, server_id: issued.server_id });
  }
  t.after(() => { for (const proxy of proxies) proxy.stop(); });
  assert.deepEqual(observed, [
    { project_id: "project-alpha", server_id: "server-one" },
    { project_id: "project-beta", server_id: "server-two" },
  ]);
});

test("receipt key absence generates, while ambiguous private-key states refuse by name", () => {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const env = { XDG_DATA_HOME: testTmpdir(path.join(SCRATCH, "ambiguity-")) };
  let announcements = 0;
  loadReceiptSigner(env, () => { announcements += 1; });
  const keys = receiptKeyPaths(env);
  assert.equal(announcements, 1, "absent key did not generate and announce");
  loadReceiptSigner(env, () => { announcements += 1; });
  assert.equal(announcements, 1, "an existing key announced as newly generated");

  fs.chmodSync(keys.privateKey, 0o644);
  assert.throws(
    () => loadReceiptSigner(env),
    (error) => error.code === "receipt_key_permissions" && /required 0600/.test(error.message),
  );

  fs.chmodSync(keys.privateKey, 0o000);
  assert.throws(
    () => loadReceiptSigner(env),
    (error) => error.code === "receipt_key_unreadable" && /private receipt key is unreadable/.test(error.message),
  );

  fs.chmodSync(keys.privateKey, 0o600);
  fs.writeFileSync(keys.privateKey, "");
  assert.throws(() => loadReceiptSigner(env), (error) => error.code === "receipt_key_empty");
});
