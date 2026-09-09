const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const {
  acquireProjectLock,
  lockPathFor,
  lockOwnerIsLive,
  processStartWitness,
  projectId,
  readProjectServer,
  readState,
  statePathFor,
} = require("../spine/protection.cjs");
const { createJournal } = require("../spine/store.cjs");
const { requireMatchingVersion } = require("../spine/version.cjs");

const SCRATCH = testTmpdir(path.join(os.tmpdir(), "seal-proxy-lock-"));

function project() {
  const root = testTmpdir(path.join(SCRATCH, "test-"));
  return { root, lockPath: lockPathFor(root) };
}

function waitForExit(child) {
  return new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
}

test("two concurrent writers: the second writer lock refuses while the first keeps working", async () => {
  const { root } = project();
  const first = spawn(process.execPath, ["-e", `
    const { acquireProjectLock } = require(${JSON.stringify(path.join(__dirname, "../spine/protection.cjs"))});
    const lock = acquireProjectLock(${JSON.stringify(root)});
    process.stdout.write("FIRST_READY\\n");
    setTimeout(() => { lock.release(); process.exit(0); }, 300);
  `], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve) => first.stdout.once("data", resolve));
  let secondStderr = "";
  const second = spawn(process.execPath, ["-e", `
    const { acquireProjectLock } = require(${JSON.stringify(path.join(__dirname, "../spine/protection.cjs"))});
    try { acquireProjectLock(${JSON.stringify(root)}); } catch (error) {
      process.stderr.write(error.code + "\\n" + error.message + "\\n"); process.exit(1);
    }
  `], { stdio: ["ignore", "ignore", "pipe"] });
  second.stderr.on("data", (chunk) => { secondStderr += chunk; });
  const [result, firstResult] = await Promise.all([waitForExit(second), waitForExit(first)]);
  assert.equal(result.code, 1);
  assert.match(result.signal || "", /^$|^null$/);
  assert.match(secondStderr, /^proxy_lease_active\nproject lock held by pid \d+ for another Seal operation on this project; retry after that operation finishes/);
  assert.equal(firstResult.code, 0);
});

test("a cleanly exited proxy leaves a lock that a new proxy acquires", () => {
  const { root } = project();
  const first = acquireProjectLock(root);
  first.release();
  const second = acquireProjectLock(root);
  assert.equal(second.recovered, false);
  second.release();
});

test("a killed proxy leaves a stale lock that the next proxy recovers", async () => {
  const { root } = project();
  const owner = spawn(process.execPath, ["-e", `
    const { acquireProjectLock } = require(${JSON.stringify(path.join(__dirname, "../spine/protection.cjs"))});
    acquireProjectLock(${JSON.stringify(root)}); process.stdout.write("READY\\n"); setInterval(() => {}, 1000);
  `], { stdio: ["ignore", "pipe", "ignore"] });
  await new Promise((resolve) => owner.stdout.once("data", resolve));
  owner.kill("SIGKILL");
  await waitForExit(owner);
  const recovered = acquireProjectLock(root);
  assert.equal(recovered.recovered, true);
  recovered.release();
});

test("a live PID with a different process-start witness is stale", () => {
  const { root, lockPath } = project();
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: unrelated.pid, startWitness: "not-that-process" }) + "\n", { mode: 0o600 });
    const acquired = acquireProjectLock(root);
    assert.equal(acquired.recovered, true);
    acquired.release();
  } finally {
    unrelated.kill("SIGKILL");
  }
});

test("the witness is Linux /proc stat field 22", () => {
  assert.equal(typeof processStartWitness(process.pid), "string");
  assert.ok(processStartWitness(process.pid).length > 0);
});

test("the shared owner predicate reads live and dead Linux owners correctly", () => {
  const liveOwner = { pid: process.pid, startWitness: processStartWitness(process.pid) };
  assert.equal(lockOwnerIsLive(liveOwner), true);
  assert.equal(lockOwnerIsLive({ pid: 999999, startWitness: "dead" }), false);
});

// A stdio server whose tools/list answer arrives late, so that two activations
// launched together are both inside tool discovery at the same time.
const SLOW_SERVER = `
  const rl = require("node:readline").createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    const frame = JSON.parse(line);
    if (frame.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "slow", version: "0" } } }) + "\\n");
    } else if (frame.method === "tools/list") {
      setTimeout(() => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { tools: [{ name: "demo.mutate", inputSchema: { type: "object" } }] } }) + "\\n"), 800);
    }
  });
  rl.on("close", () => process.exit(0));
`;

function pendingServers(names) {
  const root = testTmpdir(path.join(SCRATCH, "startup-"));
  const project = path.join(root, "project");
  const dataHome = path.join(root, "data");
  fs.mkdirSync(project);
  const servers = Object.fromEntries(names.map((name) => [name, { command: process.execPath, args: ["-e", SLOW_SERVER] }]));
  fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: servers }) + "\n");
  const env = { XDG_DATA_HOME: dataHome };
  const states = {};
  for (const name of names) {
    const projectServer = readProjectServer(project, name);
    const statePath = statePathFor(project, env, name);
    fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
    const storePath = path.join(path.dirname(statePath), "approvals.journal");
    createJournal(storePath);
    fs.writeFileSync(statePath, JSON.stringify({
      schema: "seal.protect/v1",
      sealVersion: requireMatchingVersion(),
      state: "PENDING RESTART",
      projectRoot: fs.realpathSync(project),
      projectId: projectId(project),
      serverName: name,
      guardTool: "demo.mutate",
      projectServerDigest: projectServer.serverDigest,
      projectServer: projectServer.server,
      childArgv: projectServer.childArgv,
      childEnv: projectServer.childEnv,
      discoveryTimeoutMs: 5000,
      storePath,
      receiptsDir: path.join(path.dirname(statePath), "receipts"),
      lease: null,
    }, null, 2) + "\n");
    states[name] = statePath;
  }
  return { root, project, env, states };
}

// One activation in its own process, reporting the lease it took or the refusal
// it met. Like a real proxy, a starter that took the lease stays alive, holding
// it, until its stdin closes; the test releases the starters together.
function startActivation(statePath, env) {
  const child = spawn(process.execPath, ["-e", `
    const { activationLease } = require(${JSON.stringify(path.join(__dirname, "../spine/protection.cjs"))});
    process.stdin.resume();
    activationLease(${JSON.stringify(statePath)}, ${JSON.stringify(env)}).then(
      (state) => { process.stdout.write("ACTIVE " + state.lease.pid + " " + state.lease.generation + "\\n"); process.stdin.on("end", () => process.exit(0)); },
      (error) => { process.stdout.write("REFUSED " + error.code + "\\n" + error.message + "\\n"); process.stdin.on("end", () => process.exit(1)); },
    );
  `], { stdio: ["pipe", "pipe", "inherit"] });
  let stdout = "";
  const reported = new Promise((resolve) => {
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (/^ACTIVE .*\n$|^REFUSED [^\n]*\n[^\n]*\n$/s.test(stdout)) resolve();
    });
  });
  return { pid: child.pid, reported, release: () => child.stdin.end(), exit: waitForExit(child), output: () => stdout };
}

async function settle(starters) {
  await Promise.all(starters.map((starter) => starter.reported));
  for (const starter of starters) starter.release();
  return Promise.all(starters.map((starter) => starter.exit));
}

test("two protected servers starting in the same window both activate; a session still discovering its tools is not a live lease", async () => {
  const ctx = pendingServers(["alpha", "beta"]);
  const alpha = startActivation(ctx.states.alpha, ctx.env);
  const beta = startActivation(ctx.states.beta, ctx.env);
  const [alphaExit, betaExit] = await settle([alpha, beta]);
  assert.equal(alphaExit.code, 0, alpha.output());
  assert.equal(betaExit.code, 0, beta.output());
  assert.equal(alpha.output(), `ACTIVE ${alpha.pid} 1\n`);
  assert.equal(beta.output(), `ACTIVE ${beta.pid} 1\n`);
  for (const [name, starter] of [["alpha", alpha], ["beta", beta]]) {
    const stored = readState(ctx.states[name]);
    assert.equal(stored.state, "ACTIVE");
    assert.equal(stored.lease.pid, starter.pid);
    assert.equal(stored.lease.generation, 1);
  }
  assert.equal(fs.existsSync(lockPathFor(ctx.project, ctx.env)), false, "no startup lock survives both activations");
});

test("two starters for the same server in the same window: exactly one takes the lease and the loser is refused with the winner's real generation", async () => {
  const ctx = pendingServers(["alpha"]);
  const first = startActivation(ctx.states.alpha, ctx.env);
  const second = startActivation(ctx.states.alpha, ctx.env);
  const [firstExit, secondExit] = await settle([first, second]);
  const outcomes = [[first, firstExit], [second, secondExit]];
  const winners = outcomes.filter(([, exit]) => exit.code === 0);
  const losers = outcomes.filter(([, exit]) => exit.code === 1);
  assert.equal(winners.length, 1, `${first.output()}${second.output()}`);
  assert.equal(losers.length, 1, `${first.output()}${second.output()}`);
  const [winner] = winners[0];
  const [loser] = losers[0];
  assert.equal(winner.output(), `ACTIVE ${winner.pid} 1\n`);
  assert.equal(loser.output(), `REFUSED proxy_lease_active\nactive lease holder pid ${winner.pid}, generation 1; retry after that session exits\n`);
  const stored = readState(ctx.states.alpha);
  assert.equal(stored.state, "ACTIVE");
  assert.equal(stored.lease.pid, winner.pid);
  assert.equal(stored.lease.generation, 1);
  assert.equal(fs.existsSync(lockPathFor(ctx.project, ctx.env)), false, "no startup lock survives the race");
});
