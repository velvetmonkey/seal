const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  STATES,
  acquireProjectLock,
  activationLease,
  lockPathFor,
  lockOwnerIsLive,
  parseMacosProcessStartWitness,
  parseMacosProcessStartWitnessBounds,
  processStartWitness,
  projectId,
  protectionView,
  statePathFor,
} = require("../spine/protection.cjs");
const { createJournal, openJournal } = require("../spine/store.cjs");
const { platformSupport } = require("../spine/platform.cjs");
const { requireMatchingVersion } = require("../spine/version.cjs");

const CLI = path.join(__dirname, "../bin/seal");

const SCRATCH = path.join(
  process.env.SEAL_TEST_SCRATCH ||
    process.env.RUNNER_TEMP ||
    process.env.TMPDIR ||
    process.cwd(),
  "seal-proxy-lock-nonlinux",
);

test.after(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

function withSimulatedDarwin(fn) {
  const previousPlatform = process.env.SEAL_SPINE_PLATFORM;
  const previousArch = process.env.SEAL_SPINE_ARCH;
  process.env.SEAL_SPINE_PLATFORM = "darwin";
  process.env.SEAL_SPINE_ARCH = "arm64";
  const restore = () => {
    if (previousPlatform === undefined) delete process.env.SEAL_SPINE_PLATFORM;
    else process.env.SEAL_SPINE_PLATFORM = previousPlatform;
    if (previousArch === undefined) delete process.env.SEAL_SPINE_ARCH;
    else process.env.SEAL_SPINE_ARCH = previousArch;
  };
  try {
    const result = fn();
    if (result && typeof result.then === "function") return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function workspace(prefix) {
  fs.mkdirSync(SCRATCH, { recursive: true, mode: 0o700 });
  const root = fs.mkdtempSync(path.join(SCRATCH, `${prefix}-`));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  const dataHome = path.join(root, "data");
  fs.mkdirSync(project);
  fs.mkdirSync(home);
  return { root, project, home, dataHome, env: { HOME: home, XDG_DATA_HOME: dataHome } };
}

function ownedActiveState(ctx) {
  const projectRoot = fs.realpathSync(ctx.project);
  const gitRoot = spawnSync("git", ["-C", projectRoot, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const localRoot = gitRoot.status === 0 && gitRoot.stdout.trim()
    ? fs.realpathSync(gitRoot.stdout.trim())
    : projectRoot;
  const statePath = statePathFor(projectRoot, ctx.env);
  const definition = { type: "stdio", command: "/seal", args: ["__proxy", "--protect-state", statePath], env: {} };
  fs.writeFileSync(path.join(ctx.home, ".claude.json"), JSON.stringify({
    projects: { [localRoot]: { mcpServers: { db: definition } } },
  }, null, 2) + "\n");
  return {
    schema: "seal.protect/v1",
    sealVersion: requireMatchingVersion(),
    state: STATES.ACTIVE,
    projectRoot,
    projectId: projectId(projectRoot),
    serverName: "db",
    guardTool: "write",
    localOverride: {
      installed: true,
      scope: "local",
      serverName: "db",
      projectRoot,
      claudeProjectRoot: localRoot,
      projectId: projectId(projectRoot),
      definition,
    },
    lease: { pid: process.pid, startWitness: null, generation: 5 },
  };
}

test("Darwin is install- and Protect-supported", () => {
  withSimulatedDarwin(() => {
    const support = platformSupport();
    assert.equal(support.installSupported, true);
    assert.equal(support.protectSupported, true);
    assert.equal(support.supported, true, "legacy supported answer remains the install/demo answer");
  });
});

test("macOS witness parser accepts only a successful non-epoch helper line", () => {
  const bounds = { bootSeconds: 1700000000, nowSeconds: 1800000000 };
  assert.equal(parseMacosProcessStartWitness({ status: 0, stdout: "1787834912.322160\n" }, bounds), "1787834912.322160");
  assert.equal(parseMacosProcessStartWitness({ status: 0, stdout: "" }, bounds), null);
  assert.equal(parseMacosProcessStartWitness({ status: 1, stdout: "1787834912.322160\n" }, bounds), null);
  assert.equal(parseMacosProcessStartWitness({ status: 0, stdout: "0.322160\n" }, bounds), null);
  assert.equal(parseMacosProcessStartWitness({ status: 0, stdout: "not-a-witness\n" }, bounds), null);
  assert.equal(parseMacosProcessStartWitness({ status: 0, stdout: "999999999999999999999999.000000\n" }, bounds), null);
  assert.equal(parseMacosProcessStartWitness({ status: 0, stdout: "1800000001.000000\n" }, bounds), null);
  assert.equal(parseMacosProcessStartWitness({ status: 0, stdout: "1699999999.000000\n" }, bounds), null);
  assert.equal(parseMacosProcessStartWitness({ status: 0, stdout: "1787834912.32216\n" }, bounds), null);
  assert.equal(parseMacosProcessStartWitness({ status: 0, stdout: "1787834912.322160\nextra\n" }, bounds), null);
  assert.equal(parseMacosProcessStartWitness({ status: 0, stdout: "1787834912.322160\n" }), null);
});

test("macOS boot-time witness bounds refuse malformed and implausible sysctl output", () => {
  const nowSeconds = 1800000000;
  assert.deepEqual(
    parseMacosProcessStartWitnessBounds("{ sec = 1700000000 , usec = 322160 } Thu Nov 14 00:00:00 2023\\n", nowSeconds),
    { bootSeconds: 1700000000, nowSeconds },
  );
  assert.deepEqual(
    parseMacosProcessStartWitnessBounds("{ sec = 1700000000, usec = 322160 } Thu Nov 14 00:00:00 2023\\n", nowSeconds),
    { bootSeconds: 1700000000, nowSeconds },
  );
  for (const output of [
    "{ sec = 1.7e9 , usec = 0 }\\n",
    "{ sec = 1700000000. , usec = 0 }\\n",
    "{ sec = +1700000000 , usec = 0 }\\n",
    "{ sec = 1700000000  , usec = 0 }\\n",
    "{ sec = 1e9 , usec = 0 }\\n",
    "{ sec = -1700000000 , usec = 0 }\\n",
    "{ sec = 1700000000 , usec = 0 } sec = 1700000000\\n",
    "{ sec = 1800000001 , usec = 0 }\\n",
    "{ sec = 1 , usec = 0 }\\n",
  ]) {
    assert.equal(parseMacosProcessStartWitnessBounds(output, nowSeconds), null, output);
  }
});

test("macOS without the helper keeps the process witness fail-closed", () => {
  withSimulatedDarwin(() => {
    assert.equal(processStartWitness(process.pid), null);
    assert.throws(
      () => lockOwnerIsLive({ pid: process.pid, startWitness: "unavailable" }),
      (error) => error.code === "process_witness_unavailable",
    );
  });
});

test("seal protect on simulated Darwin reaches ordinary product validation before changing project files", () => {
  const ctx = workspace("protect-refusal");
  const result = spawnSync(process.execPath, [CLI, "protect", "db", "write"], {
    cwd: ctx.project,
    env: {
      ...process.env,
      ...ctx.env,
      SEAL_SPINE_PLATFORM: "darwin",
      SEAL_SPINE_ARCH: "arm64",
    },
    encoding: "utf8",
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(output, /^seal: REFUSE project_server_absent:/m);
  assert.doesNotMatch(output, /unsupported_platform/);
  assert.equal(fs.readdirSync(ctx.project).length, 0, "Protect refusal must not change project files");
  assert.equal(fs.existsSync(path.join(ctx.home, ".claude.json")), false, "Protect refusal must not change the user configuration");
  assert.equal(fs.existsSync(ctx.dataHome), false, "Protect refusal must not create protection state");
});

test("direct protectionView refuses when the live lease witness is unavailable", () => {
  withSimulatedDarwin(() => {
    const ctx = workspace("view");
    assert.throws(
      () => protectionView(ownedActiveState(ctx), ctx.project, ctx.env),
      (error) => error.code === "process_witness_unavailable" &&
        /cannot establish process-start witness/.test(error.message),
    );
  });
});

test("direct activationLease refuses when the live lease witness is unavailable", async () => {
  await withSimulatedDarwin(async () => {
    const ctx = workspace("activation");
    const state = ownedActiveState(ctx);
    const statePath = statePathFor(ctx.project, ctx.env);
    fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });

    await assert.rejects(
      activationLease(statePath, ctx.env),
      (error) => error.code === "process_witness_unavailable" &&
        /cannot establish process-start witness/.test(error.message),
    );
  });
});

test("direct acquireProjectLock refuses when the live lock witness is unavailable", () => {
  withSimulatedDarwin(() => {
    const ctx = workspace("lock");
    const lockPath = lockPathFor(ctx.project, ctx.env);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startWitness: null }) + "\n", { mode: 0o600 });

    assert.throws(
      () => acquireProjectLock(ctx.project, ctx.env),
      (error) => error.code === "process_witness_unavailable" &&
        /cannot establish process-start witness/.test(error.message),
    );
  });
});

test("direct acquireProjectLock refuses its first acquire when its witness is unavailable", () => {
  withSimulatedDarwin(() => {
    const ctx = workspace("first-lock");
    assert.throws(
      () => acquireProjectLock(ctx.project, ctx.env),
      (error) => error.code === "process_witness_unavailable" &&
        /cannot establish process-start witness/.test(error.message),
    );
    assert.equal(fs.existsSync(lockPathFor(ctx.project, ctx.env)), false, "refusal must not write a null-witness lock");
  });
});

test("journal lock refuses when a live owner has no process-start witness", () => {
  withSimulatedDarwin(() => {
    const ctx = workspace("journal-lock");
    const journalPath = path.join(ctx.root, "approval.ndjson");
    createJournal(journalPath);
    fs.writeFileSync(
      `${journalPath}.lock`,
      JSON.stringify({ pid: process.pid, startWitness: null }) + "\n",
      { mode: 0o600 },
    );

    assert.throws(
      () => openJournal(journalPath).withLock(() => assert.fail("journal lock must refuse before its callback")),
      (error) => error.code === "process_witness_unavailable" &&
        /cannot establish process-start witness/.test(error.message),
    );
  });
});

test("journal lock refuses its first acquire when its witness is unavailable", () => {
  withSimulatedDarwin(() => {
    const ctx = workspace("journal-first-lock");
    const journalPath = path.join(ctx.root, "approval.ndjson");
    createJournal(journalPath);
    let callbackRan = false;
    assert.throws(
      () => openJournal(journalPath).withLock(() => { callbackRan = true; }),
      (error) => error.code === "process_witness_unavailable" &&
        /cannot establish process-start witness/.test(error.message),
    );
    assert.equal(callbackRan, false, "journal callback must not run after a null-witness refusal");
    assert.equal(fs.existsSync(`${journalPath}.lock`), false, "refusal must not write a null-witness lock");
  });
});
