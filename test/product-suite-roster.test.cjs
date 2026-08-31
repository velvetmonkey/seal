const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const ROOT = resolve(__dirname, "..");
const DRIVER = join(ROOT, "scripts", "run-complete-product-suite.sh");
const CRITICAL_MANIFEST = join(ROOT, "scripts", "critical-property-manifest.tsv");

function fixture() {
  const root = testTmpdir(join(tmpdir(), "seal-product-suite-roster-"));
  const tests = join(root, "tests");
  mkdirSync(tests);
  for (const name of ["one", "two", "three"]) {
    writeFileSync(join(tests, `${name}.test.cjs`), "require('node:test')('fixture', () => {});\n");
  }
  const roster = join(root, "roster.txt");
  writeFileSync(roster, "one.test.cjs\ntwo.test.cjs\nthree.test.cjs\n");
  const manifest = join(root, "critical-property-manifest.tsv");
  const manifestEntries = readFileSync(CRITICAL_MANIFEST, "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("\t")[0]);
  writeFileSync(manifest, manifestEntries.map((property) => `${property}\tone.test.cjs\tfixture`).join("\n") + "\n");
  return { root, tests, roster, manifest, properties: manifestEntries };
}

function run(driver, tests, roster, manifest, extraEnv = {}) {
  const env = {
    ...process.env,
    RUNNER_TEMP: tmpdir(),
    SEAL_PRODUCT_SCRIPT_ROOT: ROOT,
    SEAL_PRODUCT_TEST_ROOT: tests,
    SEAL_PRODUCT_TEST_DIR: tests,
    SEAL_PRODUCT_TEST_ROSTER: roster,
    SEAL_CRITICAL_PROPERTY_MANIFEST: manifest,
    ...extraEnv,
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

test("a complete roster remains visible when an assertion fails", (t) => {
  const space = fixture();
  writeFileSync(join(space.tests, "two.test.cjs"), "require('node:test')('intentional assertion failure', () => { throw new Error('intentional'); });\n");
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /intentional assertion failure/);
  assert.match(result.stdout, /ROSTER: 3 of 3 declared test files ran/);
});

test("a deleted executed-file record is unreadable rather than a short roster", (t) => {
  const space = fixture();
  const copy = join(space.root, "driver-deleted-record.sh");
  writeFileSync(copy, readFileSync(DRIVER, "utf8").replace(
    "gate_status=0",
    'rm -f -- "$output_file"\ngate_status=0',
  ));
  chmodSync(copy, 0o755);
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(copy, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /ROSTER: unreadable; executed-file record unavailable .*record disappeared before reconciliation/);
  assert.doesNotMatch(result.stdout, /INCOMPLETE ROSTER|declared test file did not run/);
});

test("a changed executed-file record is unreadable rather than a short roster", (t) => {
  const space = fixture();
  const copy = join(space.root, "driver-changed-record.sh");
  writeFileSync(copy, readFileSync(DRIVER, "utf8").replace(
    "gate_status=0",
    'sed -i "/^# product-suite-executed-file /{x;/x/{x;b};x;d}" "$output_file"\ngate_status=0',
  ));
  chmodSync(copy, 0o755);
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(copy, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /ROSTER: unreadable; executed-file record unavailable .*record changed after the test process finished/);
  assert.doesNotMatch(result.stdout, /INCOMPLETE ROSTER|declared test file did not run/);
});

test("a malformed executed-file record is unreadable rather than a short roster", (t) => {
  const space = fixture();
  const copy = join(space.root, "driver-malformed-record.sh");
  writeFileSync(copy, readFileSync(DRIVER, "utf8").replace(
    'if ! record_fingerprint="$(sha256sum -- "$output_file" 2>/dev/null)"; then',
    'printf malformed >"$output_file"\nif ! record_fingerprint="$(sha256sum -- "$output_file" 2>/dev/null)"; then',
  ));
  chmodSync(copy, 0o755);
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(copy, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /ROSTER: unreadable; executed-file record unavailable .*malformed record/);
  assert.doesNotMatch(result.stdout, /INCOMPLETE ROSTER|declared test file did not run/);
});

test("a genuine short roster and a later record change are both reported", (t) => {
  const space = fixture();
  const copy = join(space.root, "driver-short-changed-record.sh");
  writeFileSync(join(space.tests, "three.test.cjs"), "this cannot parse = ;\n");
  writeFileSync(copy, readFileSync(DRIVER, "utf8").replace(
    "gate_status=0",
    'printf \'# late change\\n\' >>"$output_file"\ngate_status=0',
  ));
  chmodSync(copy, 0o755);
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(copy, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /ROSTER: at least 2 of 3 declared test files ran; .*three\.test\.cjs did not run; floor comes from the suite's self-written executed-file record, which is untrusted .*record changed after the test process finished, so the count may be low/);
});

test("a stable partial record whose entry count is short is unreadable", (t) => {
  const space = fixture();
  const copy = join(space.root, "driver-truncated-record.sh");
  writeFileSync(copy, readFileSync(DRIVER, "utf8").replace(
    'if ! record_fingerprint="$(sha256sum -- "$output_file" 2>/dev/null)"; then',
    'sed -i \'0,/^# product-suite-executed-file /{/^# product-suite-executed-file /d;}\' "$output_file"\nif ! record_fingerprint="$(sha256sum -- "$output_file" 2>/dev/null)"; then',
  ));
  chmodSync(copy, 0o755);
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(copy, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /ROSTER: unreadable; executed-file record unavailable .*executed-file count says 3 but record contains 2 entries/);
  assert.doesNotMatch(result.stdout, /ROSTER: [0-9]+ of|INCOMPLETE ROSTER|declared test file did not run/);
});

test("a genuine short roster and a stable partial record are both reported", (t) => {
  const space = fixture();
  const copy = join(space.root, "driver-short-truncated-record.sh");
  writeFileSync(join(space.tests, "three.test.cjs"), "this cannot parse = ;\n");
  writeFileSync(copy, readFileSync(DRIVER, "utf8").replace(
    'if ! record_fingerprint="$(sha256sum -- "$output_file" 2>/dev/null)"; then',
    'sed -i \'0,/^# product-suite-executed-file /{/^# product-suite-executed-file /d;}\' "$output_file"\nif ! record_fingerprint="$(sha256sum -- "$output_file" 2>/dev/null)"; then',
  ));
  chmodSync(copy, 0o755);
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(copy, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /ROSTER: at least 1 of 3 declared test files ran; .*three\.test\.cjs did not run; floor comes from the suite's self-written executed-file record, which is untrusted .*executed-file count says 3 but record contains 2 entries, so the count may be low/);
});

test("an unwritable record directory fails before the test phase", (t) => {
  const space = fixture();
  const recordDirectory = join(space.root, "record");
  mkdirSync(recordDirectory);
  chmodSync(recordDirectory, 0o555);
  t.after(() => {
    chmodSync(recordDirectory, 0o755);
    rmSync(space.root, { recursive: true, force: true });
  });
  const result = run(DRIVER, space.tests, space.roster, space.manifest, { RUNNER_TEMP: recordDirectory });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /ROSTER: unreadable; executed-file record unavailable .*record directory mode 555 has no write permissions/);
  assert.doesNotMatch(result.stdout, /TAP version|# tests|fixture/);
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
  assert.match(result.stdout, /INCOMPLETE ROSTER: declared test file did not run: .*three\.test\.cjs/);
});

test("an exact duplicate declaration is a named red finding with measured counts", (t) => {
  const space = fixture();
  writeFileSync(space.roster, "one.test.cjs\ntwo.test.cjs\ntwo.test.cjs\nthree.test.cjs\n");
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /ROSTER: 0 of 3 declared test files ran; refusing incomplete roster/);
  assert.match(result.stdout, /duplicate declaration: two\.test\.cjs/);
});

test("zero executed files prints a measured zero roster and names every declaration", (t) => {
  const space = fixture();
  const copy = join(space.root, "driver-zero.sh");
  writeFileSync(copy, readFileSync(DRIVER, "utf8").replace(
    'node --test --test-reporter="$script_root/scripts/product-suite-tap-reporter.mjs" "${run_tests[@]}" 2>&1 | tee "$output_file"',
    'printf \'# product-suite-executed-file-count 0\\nTAP version 13\\n1..0\\n# tests 0\\n# pass 0\\n# fail 0\\n# skipped 0\\n# todo 0\\n\' | tee "$output_file"',
  ));
  chmodSync(copy, 0o755);
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(copy, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /ROSTER: 0 of 3 declared test files ran; refusing incomplete roster/);
  for (const name of ["one", "two", "three"]) {
    assert.match(result.stdout, new RegExp(`INCOMPLETE ROSTER: declared test file did not run: .*${name}\\.test\\.cjs`));
  }
  assert.doesNotMatch(result.stdout + result.stderr, /unbound variable/);
});

test("duplicate executed-file evidence is counted rather than deduplicated", (t) => {
  const space = fixture();
  const copy = join(space.root, "driver-duplicate-executed.sh");
  const one = join(space.tests, "one.test.cjs");
  const two = join(space.tests, "two.test.cjs");
  const three = join(space.tests, "three.test.cjs");
  const synthetic = [
    "# product-suite-executed-file-count 4",
    `# product-suite-executed-file ${one}`,
    `# product-suite-executed-file ${two}`,
    `# product-suite-executed-file ${two}`,
    `# product-suite-executed-file ${three}`,
    "# tests 3", "# pass 3", "# fail 0", "# skipped 0", "# todo 0",
  ].join("\\n") + "\\n";
  writeFileSync(copy, readFileSync(DRIVER, "utf8").replace(
    'node --test --test-reporter="$script_root/scripts/product-suite-tap-reporter.mjs" "${run_tests[@]}" 2>&1 | tee "$output_file"',
    `printf '%b' '${synthetic}' | tee "$output_file"`,
  ));
  chmodSync(copy, 0o755);
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(copy, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /ROSTER: 4 of 3 declared test files ran; refusing incomplete roster/);
  assert.match(result.stdout, /duplicate executed-file evidence: .*two\.test\.cjs/);
});

test("SIGTERM during the node phase prints an explicitly unknown roster", async (t) => {
  const space = fixture();
  const copy = join(space.root, "driver-signal.sh");
  writeFileSync(join(space.tests, "two.test.cjs"), "require('node:test')('stay alive for signal', async () => { await new Promise((resolve) => setTimeout(resolve, 750)); });\n");
  writeFileSync(copy, readFileSync(DRIVER, "utf8").replace(
    "set +e\nnode --test",
    "set +e\necho 'DRIVER NODE PHASE STARTED'\nnode --test",
  ));
  chmodSync(copy, 0o755);
  t.after(() => rmSync(space.root, { recursive: true, force: true }));

  const env = {
    ...process.env,
    RUNNER_TEMP: tmpdir(),
    SEAL_PRODUCT_SCRIPT_ROOT: ROOT,
    SEAL_PRODUCT_TEST_ROOT: space.tests,
    SEAL_PRODUCT_TEST_DIR: space.tests,
    SEAL_PRODUCT_TEST_ROSTER: space.roster,
    SEAL_CRITICAL_PROPERTY_MANIFEST: space.manifest,
  };
  delete env.NODE_TEST_CONTEXT;
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn("bash", [copy], { cwd: ROOT, env });
    let stdout = "";
    let stderr = "";
    let signalled = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!signalled && stdout.includes("DRIVER NODE PHASE STARTED")) {
        signalled = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status, signal) => resolveResult({ status, signal, stdout, stderr, signalled }));
  });
  assert.equal(result.signalled, true, result.stdout + result.stderr);
  assert.equal(result.signal, null, result.stdout + result.stderr);
  assert.equal(result.status, 143, result.stdout + result.stderr);
  assert.match(result.stdout, /ROSTER: unknown; driver died at SIGTERM/);
  assert.doesNotMatch(result.stdout, /ROSTER: [0-9]+ of [0-9]+/);
  assert.equal(result.stdout.split("\n").filter((line) => line.startsWith("ROSTER:")).length, 1, result.stdout + result.stderr);
});

test("a symlink and its target declare one canonical file", (t) => {
  const space = fixture();
  const target = join(space.tests, "three.test.cjs");
  const alias = join(space.tests, "three-alias.test.cjs");
  require("node:fs").symlinkSync(target, alias);
  writeFileSync(space.roster, "one.test.cjs\ntwo.test.cjs\nthree.test.cjs\nthree-alias.test.cjs\n");
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /ROSTER: 3 of 3 declared test files ran/);
  assert.doesNotMatch(result.stdout, /declared but absent|present but undeclared/);
});

test("a load failure and an assertion failure each remain visible with the short roster", (t) => {
  const space = fixture();
  writeFileSync(join(space.tests, "two.test.cjs"), "require('node:test')('intentional assertion failure', () => { throw new Error('intentional'); });\n");
  writeFileSync(join(space.tests, "three.test.cjs"), "this cannot parse = ;\n");
  t.after(() => rmSync(space.root, { recursive: true, force: true }));
  const result = run(DRIVER, space.tests, space.roster, space.manifest);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /intentional assertion failure/);
  assert.match(result.stdout, /ROSTER: 2 of 3 declared test files ran; refusing incomplete roster/);
  assert.match(result.stdout, /INCOMPLETE ROSTER: declared test file did not run: .*three\.test\.cjs/);
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
