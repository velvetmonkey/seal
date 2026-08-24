const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const ROOT = path.join(__dirname, "..");
function copyTree() { const out = fs.mkdtempSync(path.join(os.tmpdir(), "seal-g0-engine-mutant-")); fs.cpSync(ROOT, out, { recursive: true, filter: (source) => !source.includes("/node_modules/") && !source.includes("/.family/") && !source.includes("/dist/") }); return out; }
function probe(root) { const data = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")); assert.equal(data.engines?.node, ">=20", `node engine claim failed: package.json engines.node is ${JSON.stringify(data.engines?.node)}`); }
if (process.argv[2] === "--probe") { try { probe(process.argv[3]); } catch (error) { console.error(error.stack || error.message); process.exit(1); } process.exit(0); }
test("package declares the supported Node engine exactly", () => {
  probe(ROOT); const mutant = copyTree(); const file = path.join(mutant, "package.json"); const source = fs.readFileSync(file, "utf8");
  assert.equal(source.split('"node": ">=20"').length - 1, 1, "package engine mutation site must be unique"); fs.writeFileSync(file, source.replace('"node": ">=20"', '"node": ">=18"'));
  const result = spawnSync(process.execPath, [__filename, "--probe", mutant], { encoding: "utf8" }); assert.notEqual(result.status, 0, "wrong Node engine mutant unexpectedly passed"); assert.match(`${result.stdout}\n${result.stderr}`, /node engine claim failed: package\.json engines\.node is \">=18\"/);
});
