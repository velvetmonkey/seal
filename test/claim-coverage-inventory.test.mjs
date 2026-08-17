import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/claim-coverage-inventory.mjs");

function run(root = ROOT) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: root,
    env: { ...process.env, CLAIM_INVENTORY_ROOT: root },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function copyRoot(t, prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.cpSync(ROOT, tmp, { recursive: true, filter: (source) => !source.includes(`${path.sep}.git`) });
  return tmp;
}

test("inventory prints four counts and every unbacked claim location", (t) => {
  const result = run(copyRoot(t, "claiminventory-baseline-"));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const summary = result.stdout.match(/^total=(\d+) backed=(\d+) unbacked=(\d+) unclassified=(\d+) population=(\d+) assertions=(\d+)$/m);
  assert.ok(summary, result.stdout);
  assert.equal(Number(summary[1]), Number(summary[2]) + Number(summary[3]));
  assert.equal(Number(summary[4]), 0, result.stdout + result.stderr);
  assert.equal(Number(summary[5]), 38);
  assert.ok(Number(summary[6]) > 0);
  assert.equal((result.stdout.match(/^POPULATION /gm) || []).length, Number(summary[5]));
  assert.equal((result.stdout.match(/^BACKED /gm) || []).length, Number(summary[2]));
  assert.equal((result.stdout.match(/^UNBACKED /gm) || []).length, Number(summary[3]));
  assert.match(result.stdout, /^UNBACKED README\.md:\d+$/m);
  assert.match(result.stdout, /^UNBACKED checker\/seal-receipt-check\.mjs:\d+$/m);
});

test("repository-derived assertions find five claims the old registry missed", (t) => {
  const result = run(copyRoot(t, "claiminventory-five-"));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const expected of [
    "BACKED README.md:13 test/dist3d.test.cjs:192",
    "BACKED README.md:154 scripts/live-page-claim-guard.mjs:101",
    "BACKED docs/guide/README.md:19 test/dist3d.test.cjs:192",
    "BACKED docs/guide/choosing-what-to-protect.md:78 test/protect3b.test.cjs:144",
    "BACKED bin/seal:214 test/seal-verify.test.cjs:58",
  ]) assert.match(result.stdout, new RegExp(`^${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
});

test("an unreadable required file fails instead of disappearing", (t) => {
  const tmp = copyRoot(t, "claiminventory-unreadable-");
  fs.rmSync(path.join(tmp, "README.md"));
  const result = run(tmp);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /README\.md: unreadable/);
});

test("a new unbacked claim is counted and named", (t) => {
  const tmp = copyRoot(t, "claiminventory-new-claim-");
  const readme = path.join(tmp, "README.md");
  const original = fs.readFileSync(readme, "utf8");
  const before = run(tmp);
  const totalBefore = Number(before.stdout.match(/^total=(\d+)/m)[1]);
  const tamperLine = original.split(/\r?\n/).length;
  fs.appendFileSync(readme, "\nSeal turns seawater into gold.\n");
  fs.writeFileSync(path.join(tmp, "test", "nearby-word-decoy.test.cjs"), [
    'const assert = require("node:assert/strict");',
    'const test = require("node:test");',
    'test("Seal turns seawater into gold.", () => {',
    '  const result = { code: 0, out: "ordinary output" };',
    '  assert.equal(result.code, 0, "Seal turns seawater into gold.");',
    '});',
  ].join("\n"));
  const after = run(tmp);
  assert.equal(after.status, 0, after.stdout + after.stderr);
  assert.match(after.stdout, new RegExp(`^total=${totalBefore + 1} `, "m"));
  assert.match(after.stdout, new RegExp(`^UNBACKED README\\.md:${tamperLine + 1}$`, "m"));
  assert.doesNotMatch(after.stderr, /UNCLASSIFIED/);
});

test("an unclassifiable source shape fails", (t) => {
  const tmp = copyRoot(t, "claiminventory-unclassified-");
  fs.appendFileSync(path.join(tmp, "README.md"), "\n```text\nSeal makes an incomplete fenced claim.\n");
  const result = run(tmp);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /README\.md: unclassified Markdown \(unterminated code fence\)/);
});

test("a new Markdown surface fails until the printed population lists it", (t) => {
  const tmp = copyRoot(t, "claiminventory-population-");
  fs.writeFileSync(path.join(tmp, "docs", "NEW-CLAIMS.md"), "Seal grants wishes.\n");
  const result = run(tmp);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /unclassified Markdown outside population: docs\/NEW-CLAIMS\.md/);
});
