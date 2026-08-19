const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = resolve(__dirname, "..");
const DRIVER = join(ROOT, "scripts", "run-complete-product-suite.sh");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "seal-product-suite-roster-"));
  const tests = join(root, "tests");
  mkdirSync(tests);
  for (const name of ["one", "two", "three"]) {
    writeFileSync(join(tests, `${name}.test.cjs`), "require('node:test')('fixture', () => {});\n");
  }
  const roster = join(root, "roster.txt");
  writeFileSync(roster, "one.test.cjs\ntwo.test.cjs\nthree.test.cjs\n");
  return { root, tests, roster };
}

function run(driver, tests, roster) {
  const env = {
    ...process.env,
    RUNNER_TEMP: tmpdir(),
    SEAL_PRODUCT_TEST_ROOT: tests,
    SEAL_PRODUCT_TEST_DIR: tests,
    SEAL_PRODUCT_TEST_ROSTER: roster,
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
  const result = run(DRIVER, space.tests, space.roster);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS  product suite ran all 3 declared test files/);
});

test("a failing present but undeclared test is a red finding", (t) => {
  const space = fixture();
  const omitted = join(space.tests, "omitted.test.cjs");
  writeFileSync(omitted, "require('node:test')('omitted failure', () => { throw new Error('intentional'); });\n");
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`present but undeclared: .*${omitted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("a passing present but undeclared test is also a red finding", (t) => {
  const space = fixture();
  const omitted = join(space.tests, "omitted.test.cjs");
  writeFileSync(omitted, "require('node:test')('omitted pass', () => {});\n");
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`present but undeclared: .*${omitted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
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
  const result = run(copy, space.tests, space.roster);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /product suite roster disagrees with executed test files/);
  assert.match(result.stdout, /declared but not executed: .*three\.test\.cjs/);
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
  const result = run(DRIVER, space.tests, space.roster);
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
  const result = run(DRIVER, space.tests, space.roster);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /declared product-test roster is unreadable .*mode 000 has no read permissions/);
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
