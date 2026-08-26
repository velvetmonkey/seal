// SPDX-License-Identifier: Apache-2.0
// The executable assertion inventory is outside the test it protects so removal
// of a linkcheck assertion is a failing product-suite result, not a silent
// reduction in coverage.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const LINKCHECK_TEST = path.resolve(import.meta.dirname, "linkcheck.test.mjs");
const CONTROL_DOCUMENT = path.resolve(import.meta.dirname, "../docs/assurance/linkcheck-population-control.md");

const REQUIRED_ASSERTIONS = [
  ["family prerequisite finding", 'assert.equal(existsSync(family), false, "partial .family tree is a named prerequisite finding")'], ["absent family root is non-failing unverified", '"absent family root must be counted as unverified without failing"'], ["present family root exposes missing target", '"missing file beneath a present family root must be broken"'], ["family outcome diagnostic distinction", '"family diagnostics must distinguish absent root from missing target"'],
  ["linkcheck process success", "assert.equal(result.status, 0, result.stdout + result.stderr)"],
  ["reported target list", 'assert.ok(targetLine, "link checker must report the targets that actually reached check()")'],
  ["cross-check target equality", 'assert.deepEqual(scanned, expectedTargets(), "every reference-parsed live target must reach check()")'],
  ["structured stdout rejects parser residue", '"link checker stdout must contain only structured diagnostic and summary lines"'],
  ["completed zero-unverified zero-broken summary with family roots present", "^link-check: \\d+ internal links, \\d+ external links, \\d+ required live links, 0 unverified, 0 broken$"],
  ["tight path matcher", "assert.deepEqual([...contents.matchAll(pathString)].map((match) => match[1]), [])"],
  ["unknown-extension path matcher", '"docs/assurance/RELEASE-NOTES-v0.2.0-rc.2.txt"'],
  ["inline-code parser exclusion", "assert.deepEqual(markdownDestinations(fixture), [])"],
  ["HTML attribute destinations", '"assets/seal-logo.png",'],
  ["escaped-backtick destination", '"escaped-not-code.md", "docs/start/install.md"'],
  ["CommonMark boundary cases", "assert.deepEqual(markdownDestinations(item.markdown), item.links, item.name)"],
];

test("linkcheck assertion inventory refuses a removed assertion by name", () => {
  const source = readFileSync(LINKCHECK_TEST, "utf8");
  for (const [name, fragment] of REQUIRED_ASSERTIONS) {
    assert.ok(source.includes(fragment), `linkcheck assertion missing: ${name}`);
  }
  const actualCount = (source.match(/assert\.(?:equal|notEqual|ok|match|doesNotMatch|deepEqual|throws|rejects)\(/gu) || []).length;
  assert.equal(actualCount, 18, `linkcheck assertion inventory changed: expected 18 assertions, found ${actualCount}`);
  const control = readFileSync(CONTROL_DOCUMENT, "utf8");
  assert.match(control, /separate-source\s+cross-check/u, "population-control document must name the cross-check"); // CLAIM-COVERAGE: docs/assurance/linkcheck-population-control.md
  assert.match(control, /shared rules can hide a target from both routes/u, "population-control document must state the shared blind spot");
});
