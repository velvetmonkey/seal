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
  ["family prerequisite finding", 'assert.equal(existsSync(family), false, "partial .family tree is a named prerequisite finding")'],
  ["linkcheck process success", "assert.equal(result.status, 0, result.stdout + result.stderr)"],
  ["reported target list", 'assert.ok(targetLine, "link checker must report the targets that actually reached check()")'],
  ["cross-check target equality", 'assert.deepEqual(scanned, expectedTargets(), "every reference-parsed live target must reach check()")'],
  ["clean occurrence totals", "assert.match(result.stdout, new RegExp(`link-check: ${expectedPopulation.internalOccurrences} internal links, ${expectedPopulation.externalOccurrences} external links, 1 required live links, 0 broken`))"],
  ["phantom P-pattern exclusion", "assert.doesNotMatch(result.stdout, /P-\\[A-Z\\]\\+/)"],
  ["tight path matcher", "assert.deepEqual([...contents.matchAll(pathString)].map((match) => match[1]), [])"],
  ["unknown-extension path matcher", '"docs/assurance/RELEASE-NOTES-v0.2.0-rc.2.txt"'],
  ["inline-code parser exclusion", "assert.deepEqual(markdownDestinations(fixture), [])"],
  ["HTML attribute destinations", '"assets/seal-logo.png",'],
  ["escaped-backtick destination", '"escaped-not-code.md", "docs/start/install.md"'],
  ["CommonMark boundary cases", "assert.deepEqual(markdownDestinations(item.markdown), item.links, item.name)"],
  ["compensated swap refusal", "a compensated cross-file swap is refused by per-file population counts"],
  ["per-file refusal names the lost occurrence", 'file: "docs/assurance/README.md"'],
];

test("linkcheck assertion inventory refuses a removed assertion by name", () => {
  const source = readFileSync(LINKCHECK_TEST, "utf8");
  for (const [name, fragment] of REQUIRED_ASSERTIONS) {
    assert.ok(source.includes(fragment), `linkcheck assertion missing: ${name}`);
  }
  const control = readFileSync(CONTROL_DOCUMENT, "utf8");
  assert.match(control, /separate-source\s+cross-check/u, "population-control document must name the cross-check"); // CLAIM-COVERAGE: docs/assurance/linkcheck-population-control.md
  assert.match(control, /shared rules can hide a target from both routes/u, "population-control document must state the shared blind spot");
  const actualCount = (source.match(/assert\.(?:equal|notEqual|ok|match|doesNotMatch|deepEqual|throws|rejects)\(/gu) || []).length;
  assert.equal(actualCount, 17, `linkcheck assertion inventory changed: expected 17 assertions, found ${actualCount}`);
  const writeSource = readFileSync(LINKCHECK_WRITE_TEST, "utf8");
  for (const name of REQUIRED_WRITE_TESTS) {
    assert.ok(writeSource.includes(name), `linkcheck write test missing: ${name}`);
  }
  const writeTestCount = (writeSource.match(/^test\("/gmu) || []).length;
  assert.equal(writeTestCount, 19, `linkcheck write inventory changed: expected 19 tests, found ${writeTestCount}`);
});

const LINKCHECK_WRITE_TEST = path.resolve(import.meta.dirname, "linkcheck-write.test.mjs");
const REQUIRED_WRITE_TESTS = [
  "defect 1: a named shrink does not sequentially re-baseline an unflagged write",
  "defect 2: comments and duplicate keys cannot poison a recorded file count",
  "defect 3: a compensating swap refuses and names the file that lost a link",
  "defect 4: an absent, empty, or wrong-typed record refuses",
  "defect 5: a record that omits a recorded link-bearing file refuses",
  "defect 6: a recorded file whose links fall to zero refuses without authorization",
  "defect 7: omitted key plus compensated partial shrink refuses and names the file",
  "content rule: the per-file record is complete",
  "content rule: the per-file record has no stranger keys",
  "content rule: per-file counts are non-negative integers",
  "content rule: the per-file record has no duplicate keys",
  "pass path: no-op exits zero without rewriting the record",
  "pass path: one added link exits zero",
  "pass path: a new page with links exits zero",
  "pass path: a new page without links exits zero",
  "pass path: two writes in a row are idempotent",
  "pass path: a named shrink retires a deleted page key",
  "a bare or unused allow-shrink authorization refuses",
  "the fixture cleanup removes every scratch mutation",
];
