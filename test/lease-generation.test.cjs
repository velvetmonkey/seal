const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const SEAL = path.join(__dirname, "../bin/seal");
const { createApprovalContract, REFUSALS } = require("../contract/contract.cjs");
const { createJournal, openJournal } = require("../spine/store.cjs");
const {
  activationLease,
  processStartWitness,
  projectId,
  readProjectServer,
  statePathFor,
} = require("../spine/protection.cjs");
const { requireMatchingVersion } = require("../spine/version.cjs");

const ACCEPT = { approval: { action: "accept", content: { approve: true } } };

function setupLeaseState() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-generation-"));
  const project = path.join(root, "project");
  const dataHome = path.join(root, "data");
  fs.mkdirSync(project);
  const dataFile = path.join(root, "server-data.txt");
  const server = { command: process.execPath, args: [SEAL, "__demo-server", dataFile] };
  fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: { db: server } }) + "\n");
  const projectServer = readProjectServer(project, "db");
  const statePath = statePathFor(project, "db", { XDG_DATA_HOME: dataHome });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({
    schema: "seal.protect/v1",
    sealVersion: requireMatchingVersion(),
    state: "PENDING RESTART",
    projectRoot: fs.realpathSync(project),
    projectId: projectId(project),
    serverName: "db",
    guardTool: "demo.mutate",
    projectServerDigest: projectServer.serverDigest,
    projectServer: projectServer.server,
    childArgv: projectServer.childArgv,
    childEnv: projectServer.childEnv,
    discoveryTimeoutMs: 5000,
    storePath: path.join(path.dirname(statePath), "approvals.journal"),
    receiptsDir: path.join(path.dirname(statePath), "receipts"),
    lease: null,
  }, null, 2) + "\n");
  return { root, project, dataHome, statePath };
}

test("a dead lease is replaceable and increments the generation", async () => {
  const setup = setupLeaseState();
  const state = JSON.parse(fs.readFileSync(setup.statePath, "utf8"));
  state.lease = { pid: 999999, startWitness: "dead", generation: 7 };
  fs.writeFileSync(setup.statePath, JSON.stringify(state) + "\n");

  const activated = await activationLease(setup.statePath, { XDG_DATA_HOME: setup.dataHome });
  assert.equal(activated.lease.generation, 8);
  assert.equal(activated.lease.pid, process.pid);
  assert.equal(activated.lease.startWitness, processStartWitness(process.pid));
});

test("a live lease is not replaced and a second starter is refused", async () => {
  const setup = setupLeaseState();
  const first = await activationLease(setup.statePath, { XDG_DATA_HOME: setup.dataHome });
  await assert.rejects(
    activationLease(setup.statePath, { XDG_DATA_HOME: setup.dataHome }),
    (error) => error.code === "proxy_lease_active" && error.message.includes(`pid ${first.lease.pid}, generation ${first.lease.generation}`),
  );
  const stored = JSON.parse(fs.readFileSync(setup.statePath, "utf8"));

  assert.equal(stored.lease.pid, first.lease.pid);
  assert.equal(stored.lease.generation, first.lease.generation);
  assert.equal(Object.hasOwn(stored.lease, "conflict"), false);
});

test("stale in-memory contract refuses to consume after the lease generation moves", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-generation-contract-"));
  const storePath = path.join(dir, "approvals.journal");
  createJournal(storePath);
  let generation = 4;
  let moveOnFirstFence = false;
  const contract = createApprovalContract({
    store: openJournal(storePath),
    leaseFence: () => {
      if (moveOnFirstFence) {
        moveOnFirstFence = false;
        generation = 5;
        return { ok: true };
      }
      return generation === 4 ? { ok: true } : { ok: false };
    },
    kernelAdapter: { authorize: () => ({ verdict: "ALLOW", raw: "test" }) },
  });
  const requestState = contract.begin({ tool: "db.demo.mutate", args: { line: "fence" } }).result.requestState;
  moveOnFirstFence = true;
  const result = contract.retry({ tool: "db.demo.mutate", args: { line: "fence" }, requestState, inputResponses: ACCEPT });
  assert.equal(result.refusal, REFUSALS.LEASE_GENERATION_MISMATCH);
  assert.doesNotMatch(fs.readFileSync(storePath, "utf8"), /"status":"consumed"/);
});

test("a single proxy restart cannot replay a consumed approval", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-generation-restart-"));
  const storePath = path.join(dir, "approvals.journal");
  createJournal(storePath);
  const options = { kernelAdapter: { authorize: () => ({ verdict: "ALLOW", raw: "test" }) } };
  const first = createApprovalContract({ ...options, store: openJournal(storePath) });
  const requestState = first.begin({ tool: "db.demo.mutate", args: { line: "once" } }).result.requestState;
  assert.equal(first.retry({ tool: "db.demo.mutate", args: { line: "once" }, requestState, inputResponses: ACCEPT }).kind, "allow");

  const restarted = createApprovalContract({ ...options, store: openJournal(storePath) });
  const replay = restarted.retry({ tool: "db.demo.mutate", args: { line: "once" }, requestState, inputResponses: ACCEPT });
  assert.equal(replay.refusal, REFUSALS.ALREADY_CONSUMED);
});
