const assert = require("node:assert/strict");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { PAYLOAD_PATHS } = require("../scripts/build-dist.cjs");
const { checkPayloadRequireGraph, resolveLocalImport } = require("../scripts/check-payload-require-graph.cjs");

const ROOT = path.join(__dirname, "..");
const CHECKER = path.join(ROOT, "scripts", "check-payload-require-graph.cjs");

test("the shipped payload require graph is closed", () => {
  const output = execFileSync(process.execPath, [CHECKER], { cwd: ROOT, encoding: "utf8" });
  assert.match(output, /^PASS payload require graph:/);
  assert.match(output, /bin\/seal -> spine\/presentation\.cjs/);
});

test("the graph names an omitted transitive payload", () => {
  assert.throws(
    () => checkPayloadRequireGraph(PAYLOAD_PATHS.filter((file) => file !== "spine/store.cjs")),
    /REFUSE payload_require_unshipped: spine\/demo\.cjs requires spine\/store\.cjs/,
  );
});

test("the graph follows a dynamic file URL import", () => {
  assert.throws(
    () => checkPayloadRequireGraph(PAYLOAD_PATHS.filter((file) => file !== "runtime/kernel/kernel.js")),
    /REFUSE payload_require_unshipped: contract\/pinned-kernel\.cjs imports runtime\/kernel\/kernel\.js/,
  );
});

test("the graph follows the worker dynamic configuration import", () => {
  assert.throws(
    () => checkPayloadRequireGraph(PAYLOAD_PATHS.filter((file) => file !== "runtime/kernel/seal-config.js")),
    /REFUSE payload_require_unshipped: contract\/kernel-authorization-worker\.cjs imports runtime\/kernel\/seal-config\.js/,
  );
});

test("an unresolved dynamic import refuses by name", () => {
  assert.throws(
    () => resolveLocalImport("specifier", path.join(ROOT, "contract", "kernel-authorization-worker.cjs"), 0, true),
    /REFUSE payload_require_dynamic: contract\/kernel-authorization-worker\.cjs:1: specifier/,
  );
});

test("the graph follows a static import", () => {
  assert.throws(
    () => checkPayloadRequireGraph(PAYLOAD_PATHS.filter((file) => file !== "runtime/kernel/receipt-format.js")),
    /REFUSE payload_require_unshipped: runtime\/kernel\/kernel\.js imports runtime\/kernel\/receipt-format\.js/,
  );
});

test("the graph checks the spawned worker declaration", () => {
  assert.throws(
    () => checkPayloadRequireGraph(PAYLOAD_PATHS.filter((file) => file !== "contract/kernel-authorization-worker.cjs")),
    /REFUSE payload_require_unshipped: contract\/kernel-authorization\.cjs spawnSync loads contract\/kernel-authorization-worker\.cjs/,
  );
});

test("the graph checks the runtime file declaration", () => {
  assert.throws(
    () => checkPayloadRequireGraph(PAYLOAD_PATHS.filter((file) => file !== "runtime/kernel/wasm/seal.js")),
    /REFUSE payload_require_unshipped: runtime\/kernel\/decision-runner\.cjs readFileSync loads runtime\/kernel\/wasm\/seal\.js/,
  );
});

test("the config signing test runner is not shipped", () => {
  const files = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).files;
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "runtime-manifest.json"), "utf8"));
  assert.ok(!PAYLOAD_PATHS.includes("runtime/kernel/runner.cjs"), "PAYLOAD_PATHS ships the config signing runner");
  assert.ok(!files.includes("runtime/kernel/runner.cjs"), "package files ships the config signing runner");
  assert.ok(!Object.hasOwn(manifest.files, "kernel/runner.cjs"), "runtime manifest pins the config signing runner");
  for (const file of PAYLOAD_PATHS) assert.notEqual(path.basename(file), "runner.cjs", file);
});
