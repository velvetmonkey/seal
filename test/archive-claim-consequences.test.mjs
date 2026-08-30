// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const SOURCE_ROOT = resolve(import.meta.dirname, "..");

function write(root, file, source) {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

function run(root, script, env = {}) {
  return spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
}

function inventoryFixture() {
  const root = mkdtempSync(join(tmpdir(), "seal-archive-inventory-"));
  write(root, "scripts/claim-bearing-file-inventory.mjs", readFileSync(join(SOURCE_ROOT, "scripts/claim-bearing-file-inventory.mjs")));
  write(root, "scripts/claim-bearing-files.json", JSON.stringify({ files: {
    "docs/archive/WHAT-SEAL-IS.md": { allowlistReason: "fixture claim" },
    "scripts/claim-bearing-files.json": { allowlistReason: "fixture metadata" },
  } }));
  write(root, "docs/archive/WHAT-SEAL-IS.md", "Seal is a checked product.\n");
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
  return root;
}

function coverageFixture() {
  const root = mkdtempSync(join(tmpdir(), "seal-archive-coverage-"));
  write(root, "scripts/claim-coverage-inventory.mjs", readFileSync(join(SOURCE_ROOT, "scripts/claim-coverage-inventory.mjs")));
  write(root, "scripts/claim-coverage-allowlist.json", JSON.stringify({ version: 1, uncovered: ["seal/docs/archive/AUTHORIZATION-RECORD.md"] }));
  write(root, "scripts/claim-bearing-files.json", JSON.stringify({ files: {} }));
  write(root, "scripts/claims-drift.mjs", "const CLAIM_MANIFEST = [];\n");
  write(root, "docs/archive/AUTHORIZATION-RECORD.md", "This authorization record has claims.\n");
  const family = {};
  for (const name of ["seal-check", "seal-demo", "seal-live-demo", "seal-verify-action", "seal-assurance-kit", "mcp-seal-dev"]) {
    const sibling = join(root, ".family", name);
    write(sibling, "scripts/claims-drift.mjs", "const CLAIM_MANIFEST = [];\n");
    if (name === "seal-live-demo" || name === "seal-assurance-kit") {
      write(sibling, "docs/ARCHITECTURE.md", "This document records claims.\n");
    }
    family[name] = sibling;
  }
  return { root, family };
}

test("claim-bearing-file-inventory fails when WHAT-SEAL-IS.md is absent", (t) => {
  const root = inventoryFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const baseline = run(root, "scripts/claim-bearing-file-inventory.mjs");
  assert.equal(baseline.status, 0, baseline.stderr);
  rmSync(join(root, "docs/archive/WHAT-SEAL-IS.md"));
  assert.notEqual(run(root, "scripts/claim-bearing-file-inventory.mjs").status, 0);
});

test("claim-coverage-inventory fails when AUTHORIZATION-RECORD.md is absent", (t) => {
  const { root, family } = coverageFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    FAMILY_SEAL_ROOT: root,
    FAMILY_SEAL_CHECK_ROOT: family["seal-check"],
    FAMILY_SEAL_DEMO_ROOT: family["seal-demo"],
    FAMILY_SEAL_LIVE_DEMO_ROOT: family["seal-live-demo"],
    FAMILY_SEAL_VERIFY_ACTION_ROOT: family["seal-verify-action"],
    FAMILY_SEAL_ASSURANCE_KIT_ROOT: family["seal-assurance-kit"],
    FAMILY_MCP_SEAL_DEV_ROOT: family["mcp-seal-dev"],
  };
  const baseline = run(root, "scripts/claim-coverage-inventory.mjs", env);
  assert.equal(baseline.status, 0, `${baseline.stdout}${baseline.stderr}`);
  rmSync(join(root, "docs/archive/AUTHORIZATION-RECORD.md"));
  const result = run(root, "scripts/claim-coverage-inventory.mjs", env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FAIL allowlist names covered or absent files: seal\/docs\/archive\/AUTHORIZATION-RECORD\.md/);
});
