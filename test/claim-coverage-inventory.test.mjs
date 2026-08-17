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
  const summary = result.stdout.match(/^total=(\d+) backed=(\d+) unbacked=(\d+) unclassified=(\d+)$/m);
  assert.ok(summary, result.stdout);
  assert.equal(Number(summary[1]), Number(summary[2]) + Number(summary[3]));
  assert.equal(Number(summary[4]), 0, result.stdout + result.stderr);
  assert.equal((result.stdout.match(/^BACKED /gm) || []).length, Number(summary[2]));
  assert.equal((result.stdout.match(/^UNBACKED /gm) || []).length, Number(summary[3]));
  assert.match(result.stdout, /^UNBACKED README\.md:\d+$/m);
  assert.match(result.stdout, /^UNBACKED checker\/seal-receipt-check\.mjs:\d+$/m);
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
