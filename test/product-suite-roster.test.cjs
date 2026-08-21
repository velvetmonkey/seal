const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = resolve(__dirname, "..");
const DRIVER = join(ROOT, "scripts", "run-complete-product-suite.sh");
const CRITICAL_MANIFEST = join(ROOT, "scripts", "critical-property-manifest.tsv");

test("the fresh-build pin requires a recorded merge refresh", () => {
  const checker = spawnSync(process.execPath, [join(ROOT, "scripts", "check-tree-refresh.cjs")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(checker.status, 0, checker.stdout + checker.stderr);
  assert.match(checker.stdout, /INSTALLED TREE PIN CHECK OK/);
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "seal-product-suite-roster-"));
  const tests = join(root, "tests");
  mkdirSync(tests);
  for (const name of ["one", "two", "three"]) {
    writeFileSync(join(tests, `${name}.test.cjs`), "require('node:test')('fixture', () => {});\n");
  }
  const roster = join(root, "roster.txt");
  writeFileSync(roster, "one.test.cjs\ntwo.test.cjs\nthree.test.cjs\n");
  const manifest = join(root, "critical-property-manifest.tsv");
  const properties = readFileSync(CRITICAL_MANIFEST, "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("\t")[0]);
  writeFileSync(manifest, properties.map((property) => `${property}\tone.test.cjs\tfixture`).join("\n") + "\n");
  return { root, tests, roster, manifest, properties };
}

function run(driver, tests, roster, manifest) {
  const env = {
    ...process.env,
    RUNNER_TEMP: tmpdir(),
    SEAL_PRODUCT_SCRIPT_ROOT: ROOT,
    SEAL_PRODUCT_TEST_ROOT: tests,
    SEAL_PRODUCT_TEST_DIR: tests,
    SEAL_PRODUCT_TEST_ROSTER: roster,
    SEAL_CRITICAL_PROPERTY_MANIFEST: manifest,
  };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync("bash", [driver], {
    cwd: ROOT,
    encoding: "utf8",
    env,
  });
}

test("the suite driver reports its runtime declared roster", (t) => {
  const space = fixture();
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /ROSTER: 3 of 3 declared test files ran/);
  assert.match(result.stdout, new RegExp(`CRITICAL PROPERTY MANIFEST entries: ${space.properties.length}`));
});

test("a failing present but undeclared test is a red finding", (t) => {
  const space = fixture();
  const omitted = join(space.tests, "omitted.test.cjs");
  writeFileSync(omitted, "require('node:test')('omitted failure', () => { throw new Error('intentional'); });\n");
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`present but undeclared: .*${omitted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("a passing present but undeclared test is also a red finding", (t) => {
  const space = fixture();
  const omitted = join(space.tests, "omitted.test.cjs");
  writeFileSync(omitted, "require('node:test')('omitted pass', () => {});\n");
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`present but undeclared: .*${omitted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("a failing nested present but undeclared test is a red finding", (t) => {
  const space = fixture();
  const nested = join(space.tests, "nested");
  mkdirSync(nested);
  const omitted = join(nested, "omitted.test.cjs");
  writeFileSync(omitted, "require('node:test')('nested omitted failure', () => { throw new Error('intentional'); });\n");
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`present but undeclared: .*${omitted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("a passing nested present but undeclared test is also a red finding", (t) => {
  const space = fixture();
  const nested = join(space.tests, "nested");
  mkdirSync(nested);
  const omitted = join(nested, "omitted.test.cjs");
  writeFileSync(omitted, "require('node:test')('nested omitted pass', () => {});\n");
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`present but undeclared: .*${omitted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("a declared nested test is reconciled and runs", (t) => {
  const space = fixture();
  const nested = join(space.tests, "nested");
  mkdirSync(nested);
  const relative = join("nested", "declared.test.cjs");
  writeFileSync(join(space.tests, relative), "require('node:test')('nested declared ran', () => {});\n");
  writeFileSync(space.roster, readFileSync(space.roster, "utf8") + `${relative}\n`);
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /nested declared ran/);
});

test("a declared nested non-candidate is absent from the discovered test set", (t) => {
  const space = fixture();
  const nested = join(space.tests, "nested");
  mkdirSync(nested);
  const relative = join("nested", "declared.cjs");
  const declared = join(space.tests, relative);
  writeFileSync(declared, "require('node:test')('not a candidate', () => {});\n");
  writeFileSync(space.roster, readFileSync(space.roster, "utf8") + `${relative}\n`);
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`declared but absent from test directory: .*${declared.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("a strict subset of the declared roster is a red finding", (t) => {
  const space = fixture();
  const copy = join(space.root, "driver.sh");
  writeFileSync(copy, readFileSync(DRIVER, "utf8").replace(
    'run_tests=("${declared_tests[@]}")',
    'run_tests=("${declared_tests[@]:0:2}")',
  ));
  chmodSync(copy, 0o755);
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(copy, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /ROSTER: 2 of 3 declared test files ran; refusing incomplete roster/);
  assert.match(result.stdout, /declared but not executed: .*three\.test\.cjs/);
});

test("a declared file that registers zero test cases is a named red finding", (t) => {
  const space = fixture();
  writeFileSync(join(space.tests, "two.test.cjs"), "// intentionally assertionless\n");
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /declared test file registered zero test cases: .*two\.test\.cjs/);
});

test("a critical property names its exact test case when that proof does not run", (t) => {
  const space = fixture();
  writeFileSync(join(space.tests, "one.test.cjs"), "require('node:test')('replacement', () => {});\n");
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`property "${space.properties[0]}" lost its proof`));
  assert.match(result.stdout, /test case "fixture" did not run and pass/);
});

test("coordinated test and roster removal still names the property that lost proof", (t) => {
  const space = fixture();
  rmSync(join(space.tests, "one.test.cjs"));
  writeFileSync(space.roster, "two.test.cjs\nthree.test.cjs\n");
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`property "${space.properties[0]}" lost its proof`));
  assert.match(result.stdout, /test file is not declared: .*one\.test\.cjs/);
});

test("an unreadable declared roster is a red finding", (t) => {
  const space = fixture();
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const missing = join(space.root, "missing");
  const result = run(DRIVER, missing);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /cannot read declared product-test roster/);
});

test("an empty declared roster is a named red finding", (t) => {
  const space = fixture();
  writeFileSync(space.roster, "");
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /declared product-test roster under .* is empty/);
});

test("a mode-000 declared roster is a named red finding", (t) => {
  const space = fixture();
  chmodSync(space.roster, 0o000);
  t.after(() => {
    chmodSync(space.roster, 0o600);
    rmSync(space.root, { recursive: true, force: true });
  });
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /declared product-test roster is unreadable .*mode 000 has no read permissions/);
});

test("an absent critical-property manifest is a named red finding", (t) => {
  const space = fixture();
  const absent = join(space.root, "absent-manifest.tsv");
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster, absent);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /CRITICAL PROPERTY MANIFEST entries: UNAVAILABLE/);
  assert.match(result.stdout, /critical-property manifest is absent/);
});

test("an empty critical-property manifest is a named red finding", (t) => {
  const space = fixture();
  writeFileSync(space.manifest, "");
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /CRITICAL PROPERTY MANIFEST entries: 0/);
  assert.match(result.stdout, /critical-property manifest: manifest is empty/);
});

test("a mode-000 critical-property manifest is a named red finding", (t) => {
  const space = fixture();
  chmodSync(space.manifest, 0o000);
  t.after(() => {
    chmodSync(space.manifest, 0o600);
    rmSync(space.root, { recursive: true, force: true });
  });
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /CRITICAL PROPERTY MANIFEST entries: UNAVAILABLE/);
  assert.match(result.stdout, /critical-property manifest is unreadable .*mode 000 has no read permissions/);
});

test("an absent operator-supplied RUNNER_TEMP is refused without creating it", (t) => {
  const space = fixture();
  const absent = join(space.root, "operator-typo");
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    RUNNER_TEMP: absent,
    SEAL_PRODUCT_TEST_ROOT: space.tests,
    SEAL_PRODUCT_TEST_DIR: space.tests,
  };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync("bash", [DRIVER], { cwd: ROOT, encoding: "utf8", env });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`RUNNER_TEMP operator-supplied path does not exist: ${absent}`));
  assert.match(result.stdout, /suite will not create it/);
  assert.equal(require("node:fs").existsSync(absent), false);
});
