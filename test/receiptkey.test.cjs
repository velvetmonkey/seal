// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");
const CHECKER = path.join(ROOT, "checker", "seal-receipt-v2.mjs");
const SCRATCH = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, "receiptkey")
  : "/home/monkey/scratch/receiptkey";
const { createJournal } = require("../spine/store.cjs");
const { loadReceiptSigner, projectId, readProjectServer, receiptKeyPaths, statePathFor } = require("../spine/protection.cjs");

function fixture() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const root = fs.mkdtempSync(path.join(SCRATCH, "test-"));
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
    const response = waitForMethod(proxy.stdout, "elicitation/create");
    proxy.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "demo.mutate", arguments: { line: "receipt-key-control" } },
    })}\n`);
    assert.match((await response).id, /^seal-elicitation\/v1\.[0-9a-f]{64}$/);
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

  const keys = receiptKeyPaths(ctx.env);
  assert.equal(fs.statSync(keys.directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(keys.privateKey).mode & 0o777, 0o600);
  assert.equal(fs.statSync(keys.publicKey).mode & 0o777, 0o644);
  const checked = require("node:child_process").spawnSync(process.execPath, [CHECKER, receiptPath, "--pubkey", fs.readFileSync(keys.publicKey, "utf8").trim()], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.match(checked.stdout, /Signature and bindings   VALID/);
  assert.match(checked.stdout, /Kernel decision          REPRODUCED/);
  assert.match(checked.stdout, /Event occurrence         NOT ESTABLISHED/);
});

test("receipt key absence generates, while ambiguous private-key states refuse by name", () => {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const env = { XDG_DATA_HOME: fs.mkdtempSync(path.join(SCRATCH, "ambiguity-")) };
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
