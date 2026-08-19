// SPDX-License-Identifier: Apache-2.0
// A documentation paste that names an installed store must name the tree a
// fresh artifact builds. Keep this separate from the artifact-byte pin: the
// two values can drift separately.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { tmpdir, track } = require("../test-support/tmpdir.cjs");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "scripts", "build-dist.cjs");
const TREE = /\btree:?\s+([0-9a-f]{64})\b/g;
const STORE = /\/store\/([0-9a-f]{64})(?=\/|\b)/g;

function quotedTreeHashes(text) {
  return [...text.matchAll(TREE), ...text.matchAll(STORE)].map((match) => match[1]);
}

function trackedFiles() {
  const listed = spawnSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stdout + listed.stderr);
  return listed.stdout.trim().split("\n").filter(Boolean);
}

test("quoted installed-tree hashes match a freshly built artifact", () => {
  const out = tmpdir("seal-installed-tree-pin-");
  const built = spawnSync(process.execPath, [BUILD, "--out", out], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stdout + built.stderr);

  const metaPath = fs.readdirSync(out).find((name) => name.endsWith(".meta.json"));
  assert.ok(metaPath, `build did not write metadata\n${built.stdout}`);
  const expected = JSON.parse(fs.readFileSync(path.join(out, metaPath), "utf8")).treeSha256;
  assert.match(expected, /^[0-9a-f]{64}$/);

  let quoted = 0;
  for (const relative of trackedFiles()) {
    const hashes = quotedTreeHashes(fs.readFileSync(path.join(ROOT, relative), "utf8"));
    for (const actual of hashes) {
      quoted += 1;
      assert.equal(actual, expected, `${relative} installed-tree hash mismatch: quoted ${actual}, fresh build ${expected}`);
    }
  }
  assert.ok(quoted > 0, "the repository must quote at least one installed-tree hash");
});
