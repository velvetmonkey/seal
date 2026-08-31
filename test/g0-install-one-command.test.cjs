const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const ROOT = path.join(__dirname, "..");

function copyTree() {
  const out = testTmpdir(path.join(os.tmpdir(), "seal-g0-install-mutant-"));
  fs.cpSync(ROOT, out, { recursive: true, filter: (source) => !source.includes("/node_modules/") && !source.includes("/.family/") && !source.includes("/dist/") });
  return out;
}

function probe(root) {
  const out = testTmpdir(path.join(os.tmpdir(), "seal-g0-install-probe-"));
  const built = spawnSync(process.execPath, [path.join(root, "scripts", "build-dist.cjs"), "--out", out], { cwd: root, encoding: "utf8", timeout: 60000 });
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
  const [digest, bytes, name] = fs.readFileSync(path.join(out, "SHA256SUMS"), "utf8").trim().split(/\s+/);
  const prefix = path.join(out, "prefix");
  const installed = spawnSync(path.join(out, name), ["--sha256", digest, "--bytes", bytes, "--prefix", prefix], { encoding: "utf8", timeout: 30000 });
  assert.equal(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
  const entries = fs.readdirSync(path.join(prefix, "bin")).sort();
  assert.deepEqual(entries, ["seal"], `install one-command claim failed: prefix bin contains ${JSON.stringify(entries)}`);
  assert.equal(fs.existsSync(path.join(prefix, "sbin")), false, `install outside-bin claim failed: ${path.join(prefix, "sbin")} exists`);
}

if (process.argv[2] === "--probe") {
  try { probe(process.argv[3]); } catch (error) { console.error(error.stack || error.message); process.exit(1); }
  process.exit(0);
}

test("install creates exactly one command in the prefix bin directory", () => {
  probe(ROOT);
  const mutant = copyTree();
  const file = path.join(mutant, "scripts", "install.cjs");
  const source = fs.readFileSync(file, "utf8");
  const needle = "  writeFileDeep(launchPath, launchSrc.data, 0o555);\n";
  assert.equal(source.split(needle).length - 1, 1, "install mutation site must be unique");
  fs.writeFileSync(file, source.replace(needle, `${needle}  writeFileDeep(path.join(prefix, "bin", "seal-extra"), Buffer.from("extra"), 0o444);\n`));
  const result = spawnSync(process.execPath, [__filename, "--probe", mutant], { encoding: "utf8", timeout: 120000 });
  assert.notEqual(result.status, 0, "extra installer file mutant unexpectedly passed");
  assert.match(`${result.stdout}\n${result.stderr}`, /install one-command claim failed: prefix bin contains/);

  const outsideMutant = copyTree();
  const outsideFile = path.join(outsideMutant, "scripts", "install.cjs");
  const outsideSource = fs.readFileSync(outsideFile, "utf8");
  assert.equal(outsideSource.split(needle).length - 1, 1, "outside-bin mutation site must be unique");
  fs.writeFileSync(outsideFile, outsideSource.replace(needle, `${needle}  writeFileDeep(path.join(prefix, "sbin", "seal-extra"), Buffer.from("extra"), 0o444);\n`));
  const outsideResult = spawnSync(process.execPath, [__filename, "--probe", outsideMutant], { encoding: "utf8", timeout: 120000 });
  assert.notEqual(outsideResult.status, 0, "outside-prefix-bin mutant unexpectedly passed");
  assert.match(`${outsideResult.stdout}\n${outsideResult.stderr}`, /install outside-bin claim failed: .*sbin exists/);
});
