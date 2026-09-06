// SPDX-License-Identifier: Apache-2.0
// Standing rule "proven means strict", ruled 2026-08-27.
// Declaration: the exact assertions lock the retired demo status sentence's
// absence and the first README line matching /^authorization rule /. They do
// not cover demo stdout non-status lines, extra README lines,
// docs/assurance/architecture.md, docs/assurance/RELEASE-NOTES-*.md,
// `seal --help` output, checker output, or receipt fields. This control
// deliberately does not scan prose; those surfaces are a declared queue item,
// not covered here.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");
const RETIRED_DEMO_STATUS = "authorization rule tested; product state and forwarding tested; client and machine trusted.";
const EXPECTED_README_LINE = "Lean proves non-bypass and default-deny properties of the authorization decision model; correspondence to the shipped authorization path is TESTED.";

function assertExactSurfaces(output, readme) {
  assert.doesNotMatch(output, new RegExp(RETIRED_DEMO_STATUS.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")), "seal demo must not print the retired authorization status sentence");
  const readmeLine = readme.match(/^Lean proves non-bypass and default-deny properties of the authorization decision model; correspondence to the shipped authorization path is TESTED\.$/mu)?.[0];
  assert.equal(readmeLine, EXPECTED_README_LINE, "README must carry the strict shipped-assurance sentence");
}

function runDemo() {
  const dir = testTmpdir(path.join(os.tmpdir(), "seal-authorization-status-control-"));
  try {
    return execFileSync(process.execPath, [SEAL, "demo", "--dir", dir], {
      cwd: ROOT, input: "y\n", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("the exact authorization claim surfaces stay strict", () => {
  assertExactSurfaces(runDemo(), fs.readFileSync(path.join(ROOT, "README.md"), "utf8"));
});

test("the exact authorization surfaces go red when physically tampered", () => {
  const output = runDemo();
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  const tamperedOutput = `${output}\n${RETIRED_DEMO_STATUS}\n`;
  assert.throws(() => assertExactSurfaces(tamperedOutput, readme), /seal demo must not print the retired authorization status sentence/);
  console.log("RED demo status tamper: retired authorization status sentence added");

  const tamperedReadme = readme.replace(EXPECTED_README_LINE, "The authorization rule is TESTED.");
  assert.throws(() => assertExactSurfaces(output, tamperedReadme), /README must carry the strict shipped-assurance sentence/);
  console.log("RED README assurance line tamper: strict shipped-assurance sentence changed");
});
