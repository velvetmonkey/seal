// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const readline = require("node:readline");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");
const SERVER = path.join(ROOT, "test-support", "tool-list-server.cjs");
const {
  legacyStatePathFor,
  projectId,
  readState,
  statePathFor,
  statesWithProject,
} = require("../spine/protection.cjs");
const { requireMatchingVersion } = require("../spine/version.cjs");

function scratch(prefix) {
  return fs.mkdtempSync(path.join("/home/monkey/scratch", prefix));
}

function fakeClaudeBin(root) {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  const claude = path.join(bin, "claude");
  fs.writeFileSync(claude, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const file = path.join(process.env.HOME, ".claude.json");
function read() { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } }
function write(value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\\n"); }
function servers(value) { value.projects ||= {}; value.projects[process.cwd()] ||= {}; return value.projects[process.cwd()].mcpServers ||= {}; }
if (args[0] !== "mcp") process.exit(2);
if (args[1] === "get") {
  const value = read();
  if (value.projects?.[process.cwd()]?.mcpServers?.[args[2]]) {
    console.log(args[2] + ":\\n  Scope: Local config (private to you in this project)\\n  Type: stdio");
    process.exit(0);
  }
  process.exit(1);
}
if (args[1] === "add") {
  const value = read();
  const split = args.indexOf("--");
  servers(value)[args[4]] = { type: "stdio", command: args[split + 1], args: args.slice(split + 2), env: {} };
  write(value);
  process.exit(0);
}
if (args[1] === "remove") {
  const value = read();
  const existing = value.projects?.[process.cwd()]?.mcpServers;
  if (!existing?.[args[4]]) { console.error('No MCP server named "' + args[4] + '" in local scope'); process.exit(1); }
  delete existing[args[4]];
  write(value);
  process.exit(0);
}
process.exit(2);
`, { mode: 0o755 });
  return bin;
}

function setup() {
  const root = scratch("seal-twogates-");
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  const bin = fakeClaudeBin(root);
  const definition = { command: process.execPath, args: [SERVER, "ok", "shared.mutate"] };
  fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({
    mcpServers: { alpha: definition, beta: definition },
  }, null, 2) + "\n");
  const env = {
    ...process.env,
    HOME: home,
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  };
  return { root, project, home, env };
}

function run(ctx, args) {
  const result = spawnSync(process.execPath, [SEAL, ...args], {
    cwd: ctx.project,
    env: ctx.env,
    encoding: "utf8",
  });
  return { code: result.status, out: `${result.stdout || ""}${result.stderr || ""}` };
}

function proxySession(ctx, serverName) {
  const statePath = statePathFor(ctx.project, serverName, ctx.env);
  const child = spawn(process.execPath, [SEAL, "__proxy", "--protect-state", statePath], {
    cwd: ctx.project,
    env: ctx.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = readline.createInterface({ input: child.stdout, terminal: false });
  const closed = new Promise((resolve) => child.once("close", resolve));
  return {
    child,
    statePath,
    request(frame) {
      const response = new Promise((resolve, reject) => {
        const onLine = (line) => {
          try { resolve(JSON.parse(line)); } catch (error) { reject(error); }
        };
        lines.once("line", onLine);
      });
      child.stdin.write(JSON.stringify(frame) + "\n");
      return response;
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) child.stdin.end();
      await closed;
    },
  };
}

async function waitForState(filePath, expected) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try { if (readState(filePath)?.state === expected) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`state did not become ${expected}: ${filePath}`);
}

test("server key is collision-free path-safe lowercase UTF-16LE hex", () => {
  const root = scratch("seal-twogates-key-");
  const env = { XDG_DATA_HOME: path.join(root, "data") };
  const names = ["alpha", "ALPHA", "a/b", "a\\b", "a:b", "a?b", "\ud800", "\ud801", "x".repeat(200)];
  const paths = names.map((name) => statePathFor(root, name, env));
  assert.equal(new Set(paths).size, names.length);
  for (const filePath of paths) {
    const components = filePath.split(path.sep);
    const serverIndex = components.lastIndexOf("servers");
    for (const component of components.slice(serverIndex + 1, -1)) {
      assert.match(component, /^u16-[0-9a-f]+$/);
      assert.ok(component.length <= 124);
    }
  }
});

test("legacy project-only state migrates visibly and remains readable at its old name", () => {
  const root = scratch("seal-twogates-migration-");
  const project = path.join(root, "project");
  const env = { XDG_DATA_HOME: path.join(root, "data") };
  fs.mkdirSync(project);
  const legacyPath = legacyStatePathFor(project, env);
  const legacyState = {
    schema: "seal.protect/v1",
    sealVersion: requireMatchingVersion(),
    state: "PENDING RESTART",
    projectRoot: fs.realpathSync(project),
    projectId: projectId(project),
    serverName: "old/server",
    guardTools: ["shared.mutate"],
  };
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
  fs.writeFileSync(legacyPath, JSON.stringify(legacyState, null, 2) + "\n");

  const listed = statesWithProject(project, env);
  const keyedPath = listed.entries[0].filePath;
  assert.equal(keyedPath, statePathFor(project, legacyState.serverName, env));
  assert.equal(listed.entries.length, 1);
  assert.equal(fs.lstatSync(legacyPath).isSymbolicLink(), true);
  assert.deepEqual(readState(legacyPath), legacyState);
  assert.deepEqual(readState(keyedPath), legacyState);

  const updated = { ...legacyState, state: "ACTIVE" };
  fs.writeFileSync(keyedPath, JSON.stringify(updated, null, 2) + "\n");
  assert.equal(readState(legacyPath).state, "ACTIVE");
});

test("two protected servers coexist, bind replay to durable server identity, and unprotect separately", async (t) => {
  const ctx = setup();
  const firstAlpha = run(ctx, ["protect", "alpha", "shared.mutate"]);
  assert.equal(firstAlpha.code, 0, firstAlpha.out);

  const secondAlpha = run(ctx, ["protect", "alpha", "shared.mutate"]);
  assert.notEqual(secondAlpha.code, 0, secondAlpha.out);
  assert.match(secondAlpha.out, /already_protected/);

  const firstBeta = run(ctx, ["protect", "beta", "shared.mutate"]);
  assert.equal(firstBeta.code, 0, firstBeta.out);

  const status = run(ctx, ["status"]);
  assert.equal(status.code, 0, status.out);
  assert.match(status.out, /^Protection: PENDING RESTART alpha\.shared\.mutate /m);
  assert.match(status.out, /^Protection: PENDING RESTART beta\.shared\.mutate /m);

  const alphaPath = statePathFor(ctx.project, "alpha", ctx.env);
  const betaPath = statePathFor(ctx.project, "beta", ctx.env);
  assert.notEqual(alphaPath, betaPath);
  assert.equal(readState(alphaPath).serverName, "alpha");
  assert.equal(readState(betaPath).serverName, "beta");
  assert.equal(readState(alphaPath).storePath, readState(betaPath).storePath, "project servers must share the journal that detects replay");

  const alpha = proxySession(ctx, "alpha");
  await waitForState(alphaPath, "ACTIVE");
  const beta = proxySession(ctx, "beta");
  try {
    await waitForState(betaPath, "ACTIVE");
    const activeAlpha = readState(alphaPath);
    const activeBeta = readState(betaPath);
    assert.equal(activeAlpha.state, "ACTIVE");
    assert.equal(activeBeta.state, "ACTIVE");
    assert.notEqual(activeAlpha.lease.pid, activeBeta.lease.pid);

    const call = { jsonrpc: "2.0", method: "tools/call", params: { name: "shared.mutate", arguments: { row: 7 } } };
    const issued = await alpha.request({ ...call, id: 1 });
    assert.equal(issued.result.resultType, "input_required");
    const retryParams = {
      ...call.params,
      requestState: issued.result.requestState,
      inputResponses: { approval: { action: "accept", content: { approve: true } } },
    };

    const crossServer = await beta.request({ ...call, id: 2, params: retryParams });
    assert.match(crossServer.result.content[0].text, /approval refused: context_mismatch/);
    assert.doesNotMatch(crossServer.result.content[0].text, /restart_invalidated|epoch/i);

    const sameServer = await alpha.request({ ...call, id: 3, params: retryParams });
    assert.match(sameServer.result.content[0].text, /CALLED shared\.mutate/);

    const events = fs.readFileSync(activeAlpha.storePath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const issuedEvent = events.find((event) => event.type === "issued");
    assert.equal(issuedEvent.project_id, activeAlpha.projectId);
    assert.equal(issuedEvent.server_id, "alpha");
    t.diagnostic(`active states: ${JSON.stringify({ alpha: activeAlpha, beta: activeBeta })}`);
    t.diagnostic(`cross-server response: ${JSON.stringify(crossServer)}`);
    t.diagnostic(`same-server response: ${JSON.stringify(sameServer)}`);
    t.diagnostic(`issued durable identity: ${issuedEvent.project_id}/${issuedEvent.server_id}`);
  } finally {
    await Promise.all([alpha.close(), beta.close()]);
  }

  const betaBefore = fs.readFileSync(betaPath);
  const unprotected = run(ctx, ["unprotect", "alpha"]);
  assert.equal(unprotected.code, 0, unprotected.out);
  assert.equal(readState(alphaPath).state, "UNPROTECTED");
  assert.deepEqual(fs.readFileSync(betaPath), betaBefore);
  assert.notEqual(readState(betaPath).state, "UNPROTECTED");
  const local = JSON.parse(fs.readFileSync(path.join(ctx.home, ".claude.json"), "utf8"));
  assert.equal(local.projects[ctx.project].mcpServers.alpha, undefined);
  assert.ok(local.projects[ctx.project].mcpServers.beta);
});
