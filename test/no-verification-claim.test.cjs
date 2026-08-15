// SPDX-License-Identifier: Apache-2.0
// Regression guard (TC-2026-08-14-01): the product binary must never claim an
// arm's-length verification. Our binary re-deriving our own receipt is not an
// outside check, and only the separately published checker may say verified.
//
// The two banned strings are built from fragments on purpose, so this guard
// file itself does not contain them — a repo-wide grep for the literals must
// stay empty even with this test present.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");
const BANNED = ["PASS" + " VERIFIED", "independ" + "ent"];

function scan(dir, hits) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { scan(full, hits); continue; }
    if (!entry.isFile()) continue;
    const text = fs.readFileSync(full, "utf8");
    for (const needle of BANNED) {
      // Skip this guard's own fragment definition (it never forms the literal).
      if (full === __filename) continue;
      if (text.includes(needle)) hits.push(`${path.relative(ROOT, full)}: ${needle}`);
    }
  }
}

test("no banned verification claim survives in bin/ spine/ contract/ test/ README.md", () => {
  const hits = [];
  for (const dir of ["bin", "spine", "contract", "test"]) scan(path.join(ROOT, dir), hits);
  // Step 0 is repository-wide for the *product claim*. README was the hole:
  // this guard used to skip it. Historical docs/ still say "independently"
  // in non-verification senses and are not this scan.
  const readme = path.join(ROOT, "README.md");
  const text = fs.readFileSync(readme, "utf8");
  for (const needle of BANNED) {
    if (text.includes(needle)) hits.push(`README.md: ${needle}`);
  }
  assert.deepEqual(hits, [], `banned verification claims found:\n${hits.join("\n")}`);
});

test("seal verify output claims re-derivation, never an outside verification", async () => {
  const { writeKernelReceipt } = require("../test-support/kernel-receipt.cjs");
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "seal-noclaim-cache-"));
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), "seal-noclaim-data-"));
  const receipt = await writeKernelReceipt(cache, dataHome);
  const out = execFileSync(process.execPath, [SEAL, "verify", receipt], {
    env: { ...process.env, SEAL_CACHE_DIR: cache, XDG_DATA_HOME: dataHome }, encoding: "utf8",
  });
  for (const needle of BANNED) assert.ok(!out.includes(needle), `seal verify printed a banned claim: ${needle}`);
  assert.match(out, /RE-DERIVED  this binary re-derived the approved decision/);
});

test("seal help claims neither an outside verification nor a passing verdict", () => {
  const help = execFileSync(process.execPath, [SEAL], { encoding: "utf8" });
  for (const needle of BANNED) assert.ok(!help.includes(needle), `seal help printed a banned claim: ${needle}`);
});
