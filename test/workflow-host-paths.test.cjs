#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { findForbiddenHostPaths } = require("../scripts/check-workflow-host-paths.cjs");

const ROOT = path.resolve(__dirname, "..");

function fixture(contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-workflow-host-path-"));
  fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(root, ".github", "workflows", "ci.yml"), contents);
  return root;
}

test("workflow host-path guard rejects a development-box executable", (t) => {
  const root = fixture("steps:\n  - run: " + "/home/" + "monkey/bin/anything\n");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(findForbiddenHostPaths(root), [
    ".github/workflows/ci.yml:2:- run: " + "/home/" + "monkey/bin/anything",
  ]);
});

test("workflow host-path guard accepts portable commands", (t) => {
  const root = fixture("steps:\n  - run: node scripts/seal-reproduce.cjs build-pinned-kernel v0.2.0 --output out.wasm\n");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(findForbiddenHostPaths(root), []);
});

test("both kernel workflows delegate the rebuild recipe to seal-reproduce", () => {
  const expected = /run: node scripts\/seal-reproduce\.cjs build-pinned-kernel "\$(?:GITHUB_REF_NAME|RELEASE_TAG)" --output "\$RUNNER_TEMP\/rebuilt-seal\.wasm"/u;
  for (const relative of [".github/workflows/release.yml", ".github/workflows/published-kernel.yml"]) {
    const workflow = fs.readFileSync(path.join(ROOT, relative), "utf8");
    assert.match(workflow, expected); // CLAIM-COVERAGE: .github/workflows/published-kernel.yml#published-kernel
    assert.doesNotMatch(workflow, /provision_toolchain|install_pinned_elan|build_runtime_wasm/u);
  }
});
