const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  STATES,
  acquireProjectLock,
  activationLease,
  lockPathFor,
  projectId,
  protectionView,
  statePathFor,
} = require("../spine/protection.cjs");
const { requireMatchingVersion } = require("../spine/version.cjs");

const SCRATCH = path.join(
  process.env.SEAL_TEST_SCRATCH ||
    process.env.RUNNER_TEMP ||
    process.env.TMPDIR ||
    process.cwd(),
  "seal-proxy-lock-nonlinux",
);

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
  const statePath = statePathFor(projectRoot, ctx.env);
  const definition = { type: "stdio", command: "/seal", args: ["__proxy", "--protect-state", statePath], env: {} };
  fs.writeFileSync(path.join(ctx.home, ".claude.json"), JSON.stringify({
    projects: { [projectRoot]: { mcpServers: { db: definition } } },
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
      projectId: projectId(projectRoot),
      definition,
    },
    lease: { pid: process.pid, startWitness: null, generation: 5 },
  };
}

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
