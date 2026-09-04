const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");
const ROOT = path.join(__dirname, "..");
function copyTree() { const out = testTmpdir(path.join(os.tmpdir(), "seal-g0-key-reuse-mutant-")); fs.cpSync(ROOT, out, { recursive: true, filter: (source) => !source.includes("/node_modules/") && !source.includes("/.family/") && !source.includes("/dist/") }); return out; }
function probe(root) { const { loadReceiptSigner } = require(path.join(root, "spine", "protection.cjs")); const env = { ...process.env, XDG_DATA_HOME: testTmpdir(path.join(os.tmpdir(), "seal-g0-key-reuse-data-")) }; const first = loadReceiptSigner(env); const second = loadReceiptSigner(env); assert.equal(second.publicKeyHex, first.publicKeyHex, `receipt signer identity claim failed: repeated load changed publicKeyHex from ${first.publicKeyHex} to ${second.publicKeyHex}`); }
if (process.argv[2] === "--probe") { try { probe(process.argv[3]); } catch (error) { console.error(error.stack || error.message); process.exit(1); } process.exit(0); }
test("receipt signer reuse returns the same public identity", () => {
  probe(ROOT); const mutant = copyTree(); const file = path.join(mutant, "spine", "protection.cjs"); const source = fs.readFileSync(file, "utf8"); const needle = "  return { privateKey, publicKey, publicKeyHex: publicHex };\n";
  assert.equal(source.split(needle).length - 1, 1, "receipt key reuse mutation site must be unique"); fs.writeFileSync(file, source.replace(needle, '  return require("./receipt-v2.cjs").generateSigner();\n'));
  const result = spawnSync(process.execPath, [__filename, "--probe", mutant], { encoding: "utf8" }); assert.notEqual(result.status, 0, "receipt signer rotation mutant unexpectedly passed"); assert.match(`${result.stdout}\n${result.stderr}`, /receipt signer identity claim failed: repeated load changed publicKeyHex/);
});
