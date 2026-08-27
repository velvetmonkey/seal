const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

const {
  acquireProjectLock,
  lockPathFor,
  lockOwnerIsLive,
  processStartWitness,
} = require("../spine/protection.cjs");

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "seal-proxy-lock-"));

function project() {
  const root = fs.mkdtempSync(path.join(SCRATCH, "test-"));
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
  assert.match(secondStderr, /^proxy_lease_active\nactive lease holder pid \d+, generation unknown; retry after that session exits/);
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

test("independent live Linux processes have distinct process-start witnesses", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    const parentWitness = processStartWitness(process.pid);
    const childWitness = processStartWitness(child.pid);
    assert.notEqual(childWitness, parentWitness);
  } finally {
    child.kill("SIGKILL");
    await waitForExit(child);
  }
});

test("the shared owner predicate reads live and dead Linux owners correctly", () => {
  const liveOwner = { pid: process.pid, startWitness: processStartWitness(process.pid) };
  assert.equal(lockOwnerIsLive(liveOwner), true);
  assert.equal(lockOwnerIsLive({ pid: 999999, startWitness: "dead" }), false);
});
