// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CHECK = resolve(ROOT, "scripts/check-macos-protect-claims.mjs");

function scratch(t) {
  const directory = mkdtempSync(join(tmpdir(), "seal-macos-protect-claims-"));
  cpSync(ROOT, join(directory, "seal"), { recursive: true, filter: (source) => !source.includes("/.git") && !source.includes("/node_modules") });
  const copy = join(directory, "seal");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return copy;
}

function run(root) {
  return spawnSync(process.execPath, [CHECK], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, SEAL_MACOS_PROTECT_CLAIMS_ROOT: root },
  });
}

test("macOS Protect scanner rejects a new contradictory prose file", (t) => {
  const root = scratch(t);
  writeFileSync(join(root, "docs", "new-macos-protect-claim.md"), "Protect is not supported on macOS yet.\n");
  const result = run(root);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /new-macos-protect-claim\.md#1 contradicts darwin Protect support/);
});

test("macOS Protect scanner reads the Darwin platform table", (t) => {
  const root = scratch(t);
  const platform = join(root, "spine", "platform.cjs");
  writeFileSync(platform, readFileSync(platform, "utf8").replace('  "darwin-x64": "macos-sysctl3-process-and-boot-witness",\n', ""));
  const result = run(root);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /platform table disagrees for darwin-x64 \(false\) and darwin-arm64 \(true\)/);
});

test("macOS Protect scanner rejects a missing install-guide support sentence", (t) => {
  const root = scratch(t);
  const install = join(root, "docs", "start", "install.md");
  writeFileSync(install, readFileSync(install, "utf8").replace("This checkout supports Protect on Linux x86-64 and macOS x64/arm64. ", ""));
  const result = run(root);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /docs\/start\/install\.md must state current macOS Protect support twice; found 1/);
});

test("macOS Protect scanner rejects known word-pattern phrasings for execution evidence", (t) => {
  const root = scratch(t);
  writeFileSync(join(root, "docs", "new-macos-protect-backing.md"), [
    "macOS Protect runs correctly because the Darwin integration test passed.",
    "A CI job confirms that Protect can execute on macOS.",
    "Successful checks demonstrate working macOS Protect on both Darwin architectures.",
  ].join("\n\n"));
  const result = run(root);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /new-macos-protect-backing\.md#1 matches a known word-pattern phrasing that cites testing as backing for macOS Protect execution/);
  assert.match(result.stderr, /new-macos-protect-backing\.md#2 matches a known word-pattern phrasing that cites testing as backing for macOS Protect execution/);
  assert.match(result.stderr, /new-macos-protect-backing\.md#3 matches a known word-pattern phrasing that cites testing as backing for macOS Protect execution/);
});

test("macOS Protect scanner allows table and helper-readiness evidence", (t) => {
  const root = scratch(t);
  writeFileSync(join(root, "docs", "legitimate-macos-protect-evidence.md"), [
    "The platform table is backed by tests for macOS Protect support.",
    "Tests confirm that the macOS helper is ready for Protect.",
  ].join("\n\n"));
  const result = run(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stderr, /legitimate-macos-protect-evidence\.md/);
});
