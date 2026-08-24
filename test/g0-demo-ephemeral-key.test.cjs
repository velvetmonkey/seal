const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

function copyTree() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "seal-g0-demo-mutant-"));
  fs.cpSync(ROOT, out, { recursive: true, filter: (source) => !source.includes("/node_modules/") && !source.includes("/.family/") && !source.includes("/dist/") });
  return out;
}

function runDemo(root, dir) {
  return spawnSync(process.execPath, [path.join(root, "bin", "seal"), "demo", "--dir", dir], {
    input: "y\n",
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, HOME: path.join(dir, "home"), XDG_DATA_HOME: path.join(dir, "xdg") },
  });
}

function probe(root) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "seal-g0-demo-probe-"));
  const keys = [];
  for (const name of ["one", "two"]) {
    const dir = path.join(work, name);
    const result = runDemo(root, dir);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    keys.push(fs.readFileSync(path.join(dir, "receipt-signer.pub"), "utf8").trim());
  }
  assert.notEqual(keys[0], keys[1], `demo ephemeral key claim failed: two runs emitted the same public key ${keys[0]}`);
}

if (process.argv[2] === "--probe") {
  try { probe(process.argv[3]); } catch (error) { console.error(error.stack || error.message); process.exit(1); }
  process.exit(0);
}

test("demo uses a fresh ephemeral signing key for each run", () => {
  probe(ROOT);
  assert.match(fs.readFileSync(path.join(ROOT, "README.md"), "utf8"), /The demo's key is generated fresh for that run\./);

  const mutant = copyTree();
  const file = path.join(mutant, "spine", "demo.cjs");
  const source = fs.readFileSync(file, "utf8");
  const needle = "  const signer = generateSigner();";
  assert.equal(source.split(needle).length - 1, 1, "demo signer mutation site must be unique");
  fs.writeFileSync(file, source.replace(needle, '  const signer = (() => { const generated = generateSigner(); return { ...generated, publicKeyHex: "00".repeat(32) }; })();'));
  const result = spawnSync(process.execPath, [__filename, "--probe", mutant], { encoding: "utf8", timeout: 60000 });
  assert.notEqual(result.status, 0, "fixed demo signer mutant unexpectedly passed");
  assert.match(`${result.stdout}\n${result.stderr}`, /demo ephemeral key claim failed: two runs emitted the same public key/);
});
