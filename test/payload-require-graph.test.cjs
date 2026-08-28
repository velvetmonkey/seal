const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { PAYLOAD_PATHS } = require("../scripts/build-dist.cjs");
const { checkPayloadRequireGraph } = require("../scripts/check-payload-require-graph.cjs");

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
