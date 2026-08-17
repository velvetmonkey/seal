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
  });
}

function copyRoot(t, prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.cpSync(ROOT, tmp, { recursive: true, filter: (source) => !source.includes(`${path.sep}.git`) });
  return tmp;
}

function summary(stdout) {
  const match = stdout.match(/^total=(\d+) backed=(\d+) unbacked=(\d+) unclassified=(\d+) population=(\d+)$/m);
  assert.ok(match, stdout);
  return match.slice(1).map(Number);
}

test("inventory prints every sentence and its assertion or UNBACKED", (t) => {
  const result = run(copyRoot(t, "claiminventory-baseline-"));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const [total, backed, unbacked, unclassified, populations] = summary(result.stdout);
  assert.equal(total, 33);
  assert.equal(total, backed + unbacked);
  assert.equal(unclassified, 0);
  assert.equal(populations, 2);
  assert.equal((result.stdout.match(/^POPULATION /gm) ?? []).length, 2);
  const lines = result.stdout.trim().split("\n");
  const claimIndexes = lines.flatMap((line, index) => line.startsWith("CLAIM ") ? [index] : []);
  assert.equal(claimIndexes.length, total);
  for (const index of claimIndexes) assert.match(lines[index + 1], /^(?:UNBACKED|ASSERTION \S+:\d+ assert\.)/);
  assert.doesNotMatch(result.stdout, /^CLAIM (?:docs\/|checker\/)/m);
  assert.doesNotMatch(result.stdout, /^CLAIM README\.md:(?:1[7-9]|[2-9]\d)/m);
});

test("behavior assertions, not README wording assertions, establish claims", (t) => {
  const result = run(copyRoot(t, "claiminventory-behavior-"));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /CLAIM README\.md:7 Seal will not run it twice\.\nASSERTION test\/spine-retry\.test\.cjs:245 /);
  assert.match(result.stdout, /CLAIM README\.md:7 It might not run it at all\.\nASSERTION test\/approval-contract\.test\.cjs:\d+ /);
  assert.match(result.stdout, /CLAIM README\.md:7 Seal writes a signed receipt of the decision\.\nASSERTION test\/receiptkey\.test\.cjs:99 /);
  assert.doesNotMatch(result.stdout, /ASSERTION test\/at-most-once-claim\.test\.cjs/);
});

test("an unreadable required file fails instead of disappearing", (t) => {
  const tmp = copyRoot(t, "claiminventory-unreadable-");
  fs.rmSync(path.join(tmp, "README.md"));
  const result = run(tmp);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /README\.md: unreadable/);
});

test("a new README claim before Install is listed and remains unbacked despite nearby test prose", (t) => {
  const tmp = copyRoot(t, "claiminventory-new-readme-");
  const readme = path.join(tmp, "README.md");
  const original = fs.readFileSync(readme, "utf8");
  const before = run(tmp);
  const [totalBefore, , unbackedBefore] = summary(before.stdout);
  const marker = "## 1. Install";
  const prefix = original.slice(0, original.indexOf(marker));
  const tamperLine = prefix.split(/\r?\n/).length;
  fs.writeFileSync(readme, original.replace(marker, "Seal turns seawater into gold.\n\n" + marker));
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
  const [totalAfter, , unbackedAfter] = summary(after.stdout);
  assert.equal(totalAfter, totalBefore + 1);
  assert.equal(unbackedAfter, unbackedBefore + 1);
  assert.match(after.stdout, new RegExp(`CLAIM README\\.md:${tamperLine} Seal turns seawater into gold\\.\\nUNBACKED`));
});

test("a new bin/seal refusal message is listed", (t) => {
  const tmp = copyRoot(t, "claiminventory-new-refusal-");
  const seal = path.join(tmp, "bin", "seal");
  fs.appendFileSync(seal, '\nthrow new protection.ProtectionError("usage", "Seal grants wishes.");\n');
  const result = run(tmp);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /CLAIM bin\/seal:\d+ Seal grants wishes\.\nUNBACKED/);
  assert.equal(summary(result.stdout)[0], 34);
});

test("an unclassifiable README fence before Install fails", (t) => {
  const tmp = copyRoot(t, "claiminventory-unclassified-");
  const readme = path.join(tmp, "README.md");
  const original = fs.readFileSync(readme, "utf8");
  fs.writeFileSync(readme, original.replace("## 1. Install", "```text\nIncomplete fenced text.\n\n## 1. Install"));
  const result = run(tmp);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /README\.md: unclassified Markdown \(unterminated code fence before Install\)/);
});
