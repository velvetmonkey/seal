// SPDX-License-Identifier: Apache-2.0
// Standing rule "proven means strict", ruled 2026-08-27.
// Declaration: the exact assertion locks the first README line matching
// /^authorization rule /. It does not cover demo stdout, extra README lines,
// docs/assurance/architecture.md, docs/assurance/RELEASE-NOTES-*.md,
// `seal --help` output, checker output, or receipt fields. This control
// deliberately does not scan prose; those surfaces are a declared queue item,
// not covered here.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const EXPECTED_README_LINE = "Lean proves non-bypass and default-deny properties of the authorization decision model; correspondence to the shipped authorization path is TESTED.";

function assertExactSurfaces(readme) {
  const readmeLine = readme.match(/^Lean proves non-bypass and default-deny properties of the authorization decision model; correspondence to the shipped authorization path is TESTED\.$/mu)?.[0];
  assert.equal(readmeLine, EXPECTED_README_LINE, "README must carry the strict shipped-assurance sentence");
}

test("the exact README authorization claim surface stays strict", () => {
  assertExactSurfaces(fs.readFileSync(path.join(ROOT, "README.md"), "utf8"));
});

test("the exact README surface goes red when physically tampered", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  const tamperedReadme = readme.replace(EXPECTED_README_LINE, "The authorization rule is TESTED.");
  assert.throws(() => assertExactSurfaces(tamperedReadme), /README must carry the strict shipped-assurance sentence/);
  console.log("RED README assurance line tamper: strict shipped-assurance sentence changed");
});
