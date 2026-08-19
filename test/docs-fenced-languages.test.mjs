// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const GUARD = join(ROOT, "docs", "check-fenced-languages.mjs");

function run(target) {
  return spawnSync(process.execPath, [GUARD, target], { cwd: ROOT, encoding: "utf8" });
}

test("all docs fences declare a language", () => {
  const result = run(join(ROOT, "docs"));
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("an unlabeled fence names its file and line", (t) => {
  const root = mkdtempSync(join(tmpdir(), "seal-doc-fence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "example.md");
  writeFileSync(file, "before\n```\noutput\n```\n");
  const result = run(file);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, new RegExp(`${file}:2: fenced block has no language`));
});

test("an indented unlabeled fence names its file and line", (t) => {
  const root = mkdtempSync(join(tmpdir(), "seal-doc-fence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "example.md");
  writeFileSync(file, "before\n  ```\noutput\n  ```\n");
  const result = run(file);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, new RegExp(`${file}:2: fenced block has no language`));
});

test("a guide output block mislabeled as bash names the role conflict", (t) => {
  const root = mkdtempSync(join(tmpdir(), "seal-doc-fence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "docs", "guide", "example.md");
  mkdirSync(join(root, "docs", "guide"), { recursive: true });
  writeFileSync(file, "```bash\nProtection: ACTIVE example.tool\n```\n");
  const result = run(file);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, new RegExp(`${file}:1: bash fence contains product output`));
});

test("an absent directory is a named failure", (t) => {
  const root = mkdtempSync(join(tmpdir(), "seal-doc-fence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const absent = join(root, "absent");
  const result = run(absent);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, new RegExp(`${absent}: path does not exist`));
});

test("an empty file is a named failure", (t) => {
  const root = mkdtempSync(join(tmpdir(), "seal-doc-fence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const empty = join(root, "empty.md");
  writeFileSync(empty, "");
  const result = run(empty);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, new RegExp(`${empty}: file is empty`));
});

test("an unreadable file is a named failure", (t) => {
  const root = mkdtempSync(join(tmpdir(), "seal-doc-fence-"));
  const unreadable = join(root, "unreadable.md");
  writeFileSync(unreadable, "```text\noutput\n```\n");
  chmodSync(unreadable, 0o000);
  t.after(() => {
    chmodSync(unreadable, 0o600);
    rmSync(root, { recursive: true, force: true });
  });
  const result = run(unreadable);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, new RegExp(`${unreadable}: cannot read path`));
});
