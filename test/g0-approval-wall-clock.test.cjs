const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const ACCEPT = { approval: { action: "accept", content: { approve: true } } };

function copyTree() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "seal-g0-clock-mutant-"));
  fs.cpSync(ROOT, out, { recursive: true, filter: (source) => !source.includes("/node_modules/") && !source.includes("/.family/") && !source.includes("/dist/") });
  return out;
}

function probe(root) {
  const { createApprovalContract } = require(path.join(root, "contract", "contract.cjs"));
  const originalNow = Date.now;
  const clocks = [0, 120001];
  Date.now = () => clocks.shift() ?? 120001;
  const contract = createApprovalContract({ ttlMs: 120000, kernelAdapter: { authorize: () => ({ verdict: "ALLOW" }) } });
  const opened = contract.begin({ tool: "demo.mutate", args: { line: "clock" } });
  const result = contract.retry({
    tool: "demo.mutate",
    args: { line: "clock" },
    requestState: opened.result.requestState,
    inputResponses: ACCEPT,
  });
  Date.now = originalNow;
  assert.equal(result.kind, "refuse", `approval wall-clock claim failed: expected EXPIRED, got ${JSON.stringify(result)}`);
  assert.equal(result.refusal, "expired", `approval wall-clock claim failed: expected EXPIRED, got ${JSON.stringify(result)}`);
}

function probeNoAdvance(root) {
  const { createApprovalContract } = require(path.join(root, "contract", "contract.cjs"));
  const originalNow = Date.now; Date.now = () => 0;
  try {
    const contract = createApprovalContract({ ttlMs: 120000, kernelAdapter: { authorize: () => ({ verdict: "ALLOW" }) } });
    const opened = contract.begin({ tool: "demo.mutate", args: { line: "no advance" } });
    const result = contract.retry({ tool: "demo.mutate", args: { line: "no advance" }, requestState: opened.result.requestState, inputResponses: ACCEPT });
    assert.notEqual(result.refusal, "expired", `approval no-advance claim failed: retry without advancing the clock was EXPIRED (${JSON.stringify(result)})`);
  } finally { Date.now = originalNow; }
}

if (process.argv[2] === "--probe-no-advance") {
  try { probeNoAdvance(process.argv[3]); } catch (error) { console.error(error.stack || error.message); process.exit(1); }
  process.exit(0);
}

if (process.argv[2] === "--probe") {
  try { probe(process.argv[3]); } catch (error) { console.error(error.stack || error.message); process.exit(1); }
  process.exit(0);
}

test("approval retry past the TTL is EXPIRED", () => {
  probe(ROOT);
  probeNoAdvance(ROOT);
  const mutant = copyTree();
  const file = path.join(mutant, "contract", "contract.cjs");
  const source = fs.readFileSync(file, "utf8");
  const needle = "  now = () => Date.now(),";
  assert.equal(source.split(needle).length - 1, 1, "clock mutation site must be unique");
  fs.writeFileSync(file, source.replace(needle, "  now = () => 0,"));
  const result = spawnSync(process.execPath, [__filename, "--probe", mutant], { encoding: "utf8", timeout: 30000 });
  assert.notEqual(result.status, 0, "fixed wall-clock mutant unexpectedly passed");
  assert.match(`${result.stdout}\n${result.stderr}`, /approval wall-clock claim failed: expected EXPIRED/);

  const alwaysExpiredMutant = copyTree();
  const alwaysExpiredFile = path.join(alwaysExpiredMutant, "contract", "contract.cjs");
  const alwaysExpiredSource = fs.readFileSync(alwaysExpiredFile, "utf8");
  const expiryNeedle = "    if (record.status === \"expired\" || now() > record.expires_at) {";
  assert.equal(alwaysExpiredSource.split(expiryNeedle).length - 1, 1, "always-expired mutation site must be unique");
  fs.writeFileSync(alwaysExpiredFile, alwaysExpiredSource.replace(expiryNeedle, "    if (true || now() > record.expires_at) {"));
  const alwaysExpiredResult = spawnSync(process.execPath, [__filename, "--probe-no-advance", alwaysExpiredMutant], { encoding: "utf8" });
  assert.notEqual(alwaysExpiredResult.status, 0, "always-EXPIRED mutant unexpectedly passed");
  assert.match(`${alwaysExpiredResult.stdout}\n${alwaysExpiredResult.stderr}`, /approval no-advance claim failed: retry without advancing the clock was EXPIRED/);
});
