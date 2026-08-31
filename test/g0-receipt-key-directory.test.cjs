const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");
const ROOT = path.join(__dirname, "..");
function copyTree() { const out = testTmpdir(path.join(os.tmpdir(), "seal-g0-key-dir-mutant-")); fs.cpSync(ROOT, out, { recursive: true, filter: (source) => !source.includes("/node_modules/") && !source.includes("/.family/") && !source.includes("/dist/") }); return out; }
function probe(root) { const { receiptKeyPaths } = require(path.join(root, "spine", "protection.cjs")); const dataHome = testTmpdir(path.join(os.tmpdir(), "seal-g0-key-dir-data-")); const env = { ...process.env, XDG_DATA_HOME: dataHome }; const expected = path.join(dataHome, "seal", "keys"); const actual = receiptKeyPaths(env).directory; assert.equal(actual, expected, `receipt key directory claim failed: expected ${expected}, got ${actual}`); }
if (process.argv[2] === "--probe") { try { probe(process.argv[3]); } catch (error) { console.error(error.stack || error.message); process.exit(1); } process.exit(0); }
test("receipt key directory follows XDG_DATA_HOME", () => {
  probe(ROOT); const mutant = copyTree(); const file = path.join(mutant, "spine", "protection.cjs"); const source = fs.readFileSync(file, "utf8"); const needle = '  const directory = path.join(dataHome(env), "seal", "keys");';
  assert.equal(source.split(needle).length - 1, 1, "receipt key directory mutation site must be unique"); fs.writeFileSync(file, source.replace(needle, '  const directory = path.join(dataHome(env), "seal", "rotated-keys");'));
  const result = spawnSync(process.execPath, [__filename, "--probe", mutant], { encoding: "utf8" }); assert.notEqual(result.status, 0, "wrong receipt key directory mutant unexpectedly passed"); assert.match(`${result.stdout}\n${result.stderr}`, /receipt key directory claim failed: expected .*seal[\\/]keys, got .*rotated-keys/);
});
