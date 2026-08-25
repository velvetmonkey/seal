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
const { execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");
const README = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const ARTIFACT = `seal-v${VERSION}-linux-x64`;
const ARTIFACT_CLAIM_CHECK = path.join(ROOT, "scripts", "check-readme-artifact-claim.cjs");
const BANNED = ["PASS" + " VERIFIED", "independ" + "ent"];
const DOC_BANNED_CLAIMS = [
  {
    label: "two-checker independence claim",
    pattern: new RegExp(`\\btwo\\s+${BANNED[1]}\\s+checkers?\\b`, "i"),
  },
  {
    label: "published-checker independence claim",
    pattern: new RegExp(`\\b${BANNED[1]}\\s+checking\\s+belongs\\s+to\\s+separately\\s+published\\s+checker\\s+surfaces\\b`, "i"),
  },
  {
    label: "product receipt-independence claim",
    pattern: new RegExp(`product(?:'s)?[^\\n]{0,120}${BANNED[1]}ly\\s+(?:verif(?:y|ies|ied)|re-deriv(?:e|es|ed))`, "i"),
  },
  {
    label: "seal-verify independence claim",
    pattern: new RegExp(`seal verify[^\\n]{0,80}${BANNED[1]}ly\\s+(?:verif(?:y|ies|ied)|re-deriv(?:e|es|ed))`, "i"),
  },
  {
    label: "receipt verification-independence claim",
    pattern: new RegExp(`receipt[^\\n]{0,80}verify ${BANNED[1]}ly`, "i"),
  },
];

const DOC_BANNED_OVERCLAIMS = [
  {
    label: "doctor configuration-inspection claim",
    pattern: /\bif\s+Claude\s+Code\s+is\s+configured\s+to\s+answer\s+elicitation\s+prompts\s+automatically,?\s+doctor\s+refuses\b/i,
  },
  {
    label: "kernel project/server-binding claim",
    pattern: /\bthe\s+kernel\s+answers\s+exact\s+tool,\s+canonical\s+arguments,\s+issue-time\s+project\/server\s+binding\b/i,
  },
];

function checkArtifactClaim(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-readme-artifact-claim-"));
  const file = path.join(dir, "README.md");
  fs.writeFileSync(file, text);
  return spawnSync(process.execPath, [ARTIFACT_CLAIM_CHECK], {
    encoding: "utf8",
    env: { ...process.env, README_ARTIFACT_CLAIM_README: file },
  });
}

function isTemporaryDirectory(directory) {
  return path.resolve(directory) === path.resolve(os.tmpdir());
}

function scan(dir, hits) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && isTemporaryDirectory(full)) continue;
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

function scanDocs(dir, claims, hits) {
  let scanned = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && isTemporaryDirectory(full)) continue;
    if (entry.isDirectory()) { scanned += scanDocs(full, claims, hits); continue; }
    if (!entry.isFile()) continue;
    scanned++;
    const text = fs.readFileSync(full, "utf8");
    for (const { label, pattern } of claims) {
      const matches = new RegExp(pattern.source, `${pattern.flags}g`);
      for (const match of text.matchAll(matches)) {
        const line = text.slice(0, match.index).split("\n").length;
        hits.push(`${path.relative(ROOT, full)}:${line}: ${label}: ${match[0].replace(/\s+/g, " ")}`);
      }
    }
  }
  return scanned;
}

test("no banned verification claim survives in product surfaces or docs/", () => {
  const hits = [];
  for (const dir of ["bin", "spine", "contract", "test"]) scan(path.join(ROOT, dir), hits);
  const readme = path.join(ROOT, "README.md");
  const text = fs.readFileSync(readme, "utf8");
  for (const needle of BANNED) {
    if (text.includes(needle)) hits.push(`README.md: ${needle}`);
  }
  // Keep the original broad product-surface bans above. Docs use the broader
  // word legitimately in unrelated historical and design material,
  // so scan every docs/ file for the receipt-verification claims at issue.
  // This is a semantic scope, not a path exemption: no docs file is skipped.
  const scanned = scanDocs(path.join(ROOT, "docs"), DOC_BANNED_CLAIMS, hits);
  assert.ok(scanned > 0, "docs claim scan examined no files");
  assert.deepEqual(hits, [], `banned verification claims found:\n${hits.join("\n")}`);
});

test("no stale doctor or kernel allocation claim survives in docs/", () => {
  const hits = [];
  const scanned = scanDocs(path.join(ROOT, "docs"), DOC_BANNED_OVERCLAIMS, hits);
  assert.ok(scanned > 0, "docs overclaim scan examined no files");
  assert.deepEqual(hits, [], `banned overclaims found:\n${hits.join("\n")}`);
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
  assert.equal(out.includes("REFUSE"), false);
});

test("seal help claims neither an outside verification nor a passing verdict", () => {
  const help = execFileSync(process.execPath, [SEAL], { encoding: "utf8" });
  for (const needle of BANNED) assert.ok(!help.includes(needle), `seal help printed a banned claim: ${needle}`);
});

test("README artifact claim rejects builder paths and development names for a released VERSION", () => {
  const green = checkArtifactClaim(README);
  assert.equal(green.status, 0, green.stderr);

  const absolute = checkArtifactClaim(README.replace(ARTIFACT, `/home/monkey/wt/builder/dist/${ARTIFACT}`));
  assert.equal(absolute.status, 1);
  assert.match(absolute.stderr, /builder-local absolute artifact path/);

  const development = checkArtifactClaim(README.replace(ARTIFACT, `seal-v${VERSION}-dev.gdeadbee-linux-x64`));
  assert.equal(development.status, 1);
  assert.match(development.stderr, /development artifact named while VERSION is a release/);
});
