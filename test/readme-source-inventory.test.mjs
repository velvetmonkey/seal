import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts/readme-source-inventory.mjs");

test("an empty README source population is a refusal", (t) => {
  const bin = mkdtempSync(join(tmpdir(), "seal-readme-source-empty-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const git = join(bin, "git");
  writeFileSync(git, "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(git, 0o755);
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /README source population is empty/);
});
