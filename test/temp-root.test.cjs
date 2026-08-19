// SPDX-License-Identifier: Apache-2.0
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const HELPER = path.join(ROOT, "scripts", "temp-root.cjs");

function run(script, env) {
  return spawnSync(process.execPath, ["-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env, NODE_TEST_CONTEXT: undefined },
  });
}

test("temp-root points os.tmpdir away from /tmp when TMPDIR is the OS default", () => {
  const result = run(`
    const os = require("node:os");
    const fs = require("node:fs");
    const path = require("node:path");
    const { install } = require(${JSON.stringify(HELPER)});
    delete process.env.TMPDIR;
    delete process.env.TMP;
    delete process.env.TEMP;
    delete process.env.TMPGUARD_RUN_ROOT;
    delete process.env.TMPGUARD_CLEANUP_HOOKED;
    process.env.KEEP_TMP = "1";
    const root = install(${JSON.stringify(ROOT)}, "tmpguard-unit");
    const probe = path.join(os.tmpdir(), "probe");
    fs.writeFileSync(probe, "x");
    if (root === "/tmp" || root.startsWith("/tmp/")) process.exit(2);
    if (os.tmpdir() !== root) process.exit(3);
    if (!probe.startsWith(root + path.sep)) process.exit(4);
    process.stdout.write(root);
  `, { KEEP_TMP: "1" });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const root = result.stdout.trim();
  assert.ok(root.length > 0);
  assert.notEqual(root, "/tmp");
  assert.ok(!root.startsWith("/tmp/"));
  assert.equal(fs.existsSync(path.join(root, "probe")), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("temp-root honours an owned TMPDIR parent and still avoids /tmp", () => {
  const scratch = path.join("/home/monkey/scratch", "tmpguard-owned-parents");
  fs.mkdirSync(scratch, { recursive: true });
  const parent = fs.mkdtempSync(path.join(scratch, "tmpguard-owned-"));
  const result = run(`
    const os = require("node:os");
    const { install } = require(${JSON.stringify(HELPER)});
    delete process.env.TMPGUARD_RUN_ROOT;
    delete process.env.TMPGUARD_CLEANUP_HOOKED;
    process.env.KEEP_TMP = "1";
    const root = install(${JSON.stringify(ROOT)}, "tmpguard-owned");
    if (!root.startsWith(process.env.TMPDIR_PARENT + require("node:path").sep)) process.exit(2);
    if (root === "/tmp" || root.startsWith("/tmp/")) process.exit(3);
    process.stdout.write(root);
  `, { TMPDIR: parent, TMPDIR_PARENT: parent, KEEP_TMP: "1" });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const root = result.stdout.trim();
  assert.ok(root.startsWith(parent + path.sep));
  fs.rmSync(parent, { recursive: true, force: true });
});

test("temp-root refuses to treat /tmp as an owned parent", () => {
  const result = run(`
    const { firstOwnedParent } = require(${JSON.stringify(HELPER)});
    const owned = firstOwnedParent(["/tmp", "/tmp/nested", "  ", "", null]);
    if (owned !== null) process.exit(2);
  `, {});
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

test("--make creates a new child even when TMPGUARD_RUN_ROOT is already set", () => {
  const scratch = path.join("/home/monkey/scratch", "tmpguard-owned-parents");
  fs.mkdirSync(scratch, { recursive: true });
  const parent = fs.mkdtempSync(path.join(scratch, "tmpguard-nested-"));
  const existing = fs.mkdtempSync(path.join(parent, "existing-"));
  const result = spawnSync(process.execPath, [HELPER, "--make", ROOT, "s"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      TMPDIR: parent,
      TMPGUARD_RUN_ROOT: existing,
      NODE_TEST_CONTEXT: undefined,
    },
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const created = result.stdout.trim();
  assert.notEqual(created, existing);
  assert.ok(created.startsWith(parent + path.sep));
  fs.rmSync(parent, { recursive: true, force: true });
});
