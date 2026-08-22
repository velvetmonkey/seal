// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/linkcheck.mjs");

function run(cwd = ROOT) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
}

test("clean tree linkcheck exits 0 and names family allowlist entries as external [network required]", () => {
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /EXTERNAL  scripts\/claim-coverage-allowlist\.json -> seal-check\/FINDINGS\.md/);
  assert.match(result.stdout, /link-check: 259 internal links, 50 external links, 1 required live links, 0 broken/);
  assert.doesNotMatch(result.stdout, /BROKEN  scripts\/claim-coverage-allowlist\.json -> seal-check\/FINDINGS\.md/);
});

test("path matcher stays tight around versions, digests, and ordinary prose", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "seal-linkcheck-tight-"));
  try {
    const contents = [
      "version 0.2.0",
      "sha 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "we shipped 0.2.0.",
      "plain ordinary prose",
    ].join("\n");
    const source = readFileSync(SCRIPT, "utf8");
    const body = source.match(/const pathString = (\/.*\/gm);/s)?.[1];
    assert.ok(body, "pathString regex literal must be present");
    const pathString = Function(`return ${body};`)();
    assert.deepEqual([...contents.matchAll(pathString)].map((match) => match[1]), []);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
