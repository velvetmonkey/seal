// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { hasSealProtectInvocation, workflowRunValues } = require("../scripts/workflow-run-values.cjs");

const ROOT = process.env.SEAL_RELEASE_NOTES_ROOT ?? path.join(__dirname, "..");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const NOTES_RELATIVE = `docs/assurance/RELEASE-NOTES-v${VERSION}.md`;
const RC3_NOTES_RELATIVE = "docs/assurance/RELEASE-NOTES-v0.2.0-rc.3.md"; // CLAIM-COVERAGE: docs/assurance/RELEASE-NOTES-v0.2.0-rc.3.md#release-notes-rc3
const FINAL_NOTES_RELATIVE = "docs/assurance/RELEASE-NOTES-v0.2.0.md"; // CLAIM-COVERAGE: docs/assurance/RELEASE-NOTES-v0.2.0.md#release-notes-final
const RC3_NOTES = path.join(ROOT, RC3_NOTES_RELATIVE);

const NOTES = path.join(ROOT, NOTES_RELATIVE);

test("the current VERSION has a release note with the same identity", () => {
  assert.equal(NOTES_RELATIVE, FINAL_NOTES_RELATIVE);
  assert.equal(path.basename(NOTES), `RELEASE-NOTES-v${VERSION}.md`);
  assert.match(fs.readFileSync(NOTES, "utf8"), new RegExp(`^# Seal v${VERSION.replaceAll(".", "\\.")} release notes$`, "m"));
});

test("current release notes state the platform, receipt format, and verifier trust ceiling", () => {
  const notes = fs.readFileSync(NOTES, "utf8");

  assert.match(notes, /supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64\/arm64\./);
  const helperProvenance = "native macOS process-start witness helper is release-produced, not independ" + "ently reproduced.";
  assert.ok(notes.includes(helperProvenance));
  assert.match(notes, /macOS Protect execution is not exercised in CI\./);
  for (const citation of ["spine/platform.cjs", "test/darwin-readiness.test.cjs", "test/release-matrix.test.mjs"]) {
    assert.match(notes, new RegExp(citation.replaceAll(".", "\\.")), `release notes cite ${citation}`);
  }
  assert.match(notes, /one `seal\.receipt\/v2` envelope/);
  assert.match(notes, /refuses `authorityRoot` and `occurrenceWitness` inputs/);
  assert.match(notes, /Positive VERIFY is unreachable in this release/);
  assert.match(notes, /formatted result is `UNVERIFIED`/);
  assert.doesNotMatch(notes, /\bPROVED\b/, "the final release note must make zero PROVED claims");
});

test("rc.3 release-note identity and platform boundary remain immutable", () => {
  const notes = fs.readFileSync(RC3_NOTES, "utf8");
  assert.match(notes, /^# Seal v0\.2\.0-rc\.3 release notes$/m);
  assert.match(notes, /macOS source portability is CI-exercised for install, demo and receipt checking\./);
  assert.match(notes, /Protect is not supported on macOS yet\./);
  assert.doesNotMatch(notes, /supports Linux x86-64 and macOS x64\/arm64/);
});

test("replacement rc.3 citations retain their specific evidence", () => {
  const approvalContract = fs.readFileSync(path.join(ROOT, "test", "approval-contract.test.cjs"), "utf8");
  assert.match(approvalContract, /replayed approval already consumed; child stays at exactly 1/);
  assert.match(approvalContract, /expired approval; child receives nothing/);

  const distribution = fs.readFileSync(path.join(ROOT, "docs", "assurance", "distribution.md"), "utf8");
  assert.match(distribution, /supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64\/arm64\./);

  const noVerification = fs.readFileSync(path.join(ROOT, "test", "no-verification-claim.test.cjs"), "utf8");
  assert.match(noVerification, /arm's-length verification/);

  const architecture = fs.readFileSync(path.join(ROOT, "docs", "assurance", "architecture.md"), "utf8");
  assert.match(architecture, /Shipped Node product path/);
  assert.match(architecture, /This diagram describes the Seal family product, not the Node CLI shipped by this repository\./);
});

test("v0.2.0-rc.2 release notes retain the immutable tag's Linux-only platform claim", () => {
  const notes = fs.readFileSync(path.join(ROOT, "docs", "assurance", "RELEASE-NOTES-v0.2.0-rc.2.md"), "utf8");
  assert.match(notes, /Seal v0\.2\.0-rc\.2 supports Linux x86-64 only\. macOS, Windows, Linux ARM, and other platforms are not supported in this release\./);
  assert.doesNotMatch(notes, /v0\.2\.0-rc\.2 supports Linux x86-64 and macOS/);
});

test("current product and release surfaces state macOS Protect parity", () => {
  const claimSites = [
    ".github/workflows/release.yml",
    "README.md",
    "bin/seal",
    "docs/assurance/README.md",
    "docs/assurance/RELEASE-NOTES-v0.2.0.md",
    "docs/assurance/distribution.md",
    "docs/assurance/index.html",
    "docs/guide/README.md",
    "docs/guide/when-something-looks-wrong.md",
    "scripts/install.cjs",
    "scripts/seal-launch.cjs",
    "spine/platform.cjs",
  ];
  for (const file of claimSites) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const productParity = file === "docs/guide/when-something-looks-wrong.md"
      ? /supports install, demo and receipt checking on Linux x86-64 and macOS x64\/arm64\. Protect is supported on Linux x86-64 and macOS x64\/arm64;/
      : /supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64\/arm64\./;
    assert.match(text.replace(/\s+/g, " "), productParity, `${file}: product parity`);
    assert.doesNotMatch(text, /Protect is not supported on macOS yet\./, `${file}: retired exclusion`);
  }
});

test("the macOS workflow does not claim Protect execution", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "macos.yml"), "utf8");
  assert.equal(workflowRunValues(workflow).filter(hasSealProtectInvocation).length, 0);
});

test("the macOS workflow guard checks YAML run values only", () => {
  const mentions = [
    "# seal protect is not run here",
    "name: seal protect",
    "description: this text mentions seal protect",
  ].join("\n");
  assert.equal(workflowRunValues(mentions).filter(hasSealProtectInvocation).length, 0);

  for (const workflow of [
    "run: seal protect",
    "run: \tseal protect --path target",
    "run: |\n  seal protect --path target",
    "run: bin/seal protect now",
    "run: |\n  seal \\\n  protect",
  ]) {
    assert.equal(workflowRunValues(workflow).filter(hasSealProtectInvocation).length, 1, workflow);
  }
  assert.equal(hasSealProtectInvocation("$SEAL protect"), false);
});

test("every release-note commit and repository-path citation resolves", () => {
  const notesPath = NOTES;
  const notes = fs.readFileSync(notesPath, "utf8");
  const links = [...notes.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
  const shas = [...new Set(notes.match(/\b[0-9a-f]{7,40}\b/g) ?? [])];
  const repositoryPaths = links
    .filter((link) => !/^[a-z]+:/i.test(link))
    .map((link) => path.relative(ROOT, path.resolve(path.dirname(notesPath), link)));

  for (const sha of shas) {
    assert.doesNotThrow(
      () => childProcess.execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: ROOT }),
      `release-note SHA does not resolve: ${sha}`,
    );
  }

  for (const repositoryPath of repositoryPaths) {
    assert.ok(!repositoryPath.startsWith(".."), `release-note path escapes repository: ${repositoryPath}`);
    assert.doesNotThrow(
      () => childProcess.execFileSync("git", ["cat-file", "-e", `HEAD:${repositoryPath}`], { cwd: ROOT }),
      `release-note path does not resolve at HEAD: ${repositoryPath}`,
    );
  }
});
