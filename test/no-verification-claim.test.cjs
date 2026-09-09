// SPDX-License-Identifier: Apache-2.0
// Docs guard (TC-2026-08-14-01): checks labelled claims throughout docs/.
// README and the existing verify/help output assertions remain below. Emitted
// product lines are checked elsewhere by the claim channel (PR #295, which
// must land before this retirement).
// Claims in comments and test titles in bin/, spine/, contract/ and test/ are
// checked by NOTHING: a genuine "independently verified" claim there gets no
// automated routing. The claim channel reads emitted lines, not source prose.
// Ben ruled the source scan retired on 2026-09-09; this file no longer guards
// the source tree. No replacement control covers that residual gap.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");
const { testTmpdir } = require("../scripts/temp-root.cjs");

const ROOT = path.join(__dirname, "..");
const SEAL = path.join(ROOT, "bin", "seal");
const README = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
const PUBLISHED_VERSION = README.match(/^SEAL_VERSION=v([^\s]+)$/m)?.[1];
assert.ok(PUBLISHED_VERSION, "README must declare the published release identity");
const ARTIFACT = `seal-v${PUBLISHED_VERSION}-linux-x64`;
const ARTIFACT_CLAIM_CHECK = path.join(ROOT, "scripts", "check-readme-artifact-claim.cjs");
const BANNED = ["PASS" + " VERIFIED"];
const INDEPENDENCE = "independent";
const DOC_BANNED_CLAIMS = [
  {
    label: "two-checker independence claim",
    pattern: new RegExp(`\\btwo\\s+${INDEPENDENCE}\\s+checkers?\\b`, "i"),
  },
  {
    label: "published-checker independence claim",
    pattern: new RegExp(`\\b${INDEPENDENCE}\\s+checking\\s+belongs\\s+to\\s+separately\\s+published\\s+checker\\s+surfaces\\b`, "i"),
  },
  {
    label: "product receipt-independence claim",
    pattern: new RegExp(`product(?:'s)?[^\\n]{0,120}${INDEPENDENCE}ly\\s+(?:verif(?:y|ies|ied)|re-deriv(?:e|es|ed))`, "i"),
  },
  {
    label: "seal-verify independence claim",
    pattern: new RegExp(`seal verify[^\\n]{0,80}${INDEPENDENCE}ly\\s+(?:verif(?:y|ies|ied)|re-deriv(?:e|es|ed))`, "i"),
  },
  {
    label: "receipt verification-independence claim",
    pattern: new RegExp(`receipt[^\\n]{0,80}verify ${INDEPENDENCE}ly`, "i"),
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
  const dir = testTmpdir(path.join(os.tmpdir(), "seal-readme-artifact-claim-"));
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

test("no banned verification claim survives in README or labelled docs/ claims", () => {
  const hits = [];
  const readme = path.join(ROOT, "README.md");
  const text = fs.readFileSync(readme, "utf8");
  for (const needle of BANNED) {
    if (text.includes(needle)) hits.push(`README.md: ${needle}`);
  }
  // Docs use the broader word legitimately in historical and design material,
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
  const cache = testTmpdir(path.join(os.tmpdir(), "seal-noclaim-cache-"));
  const dataHome = testTmpdir(path.join(os.tmpdir(), "seal-noclaim-data-"));
  const receipt = await writeKernelReceipt(cache, dataHome);
  const result = spawnSync(process.execPath, [SEAL, "verify", receipt], {
    env: { ...process.env, SEAL_CACHE_DIR: cache, XDG_DATA_HOME: dataHome }, encoding: "utf8",
  });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  const out = `${result.stdout}${result.stderr}`;
  for (const needle of BANNED) assert.ok(!out.includes(needle), `seal verify printed a banned claim: ${needle}`);
  assert.equal(out.includes("REFUSE"), false);
});

test("seal help claims neither an outside verification nor a passing verdict", () => {
  const help = execFileSync(process.execPath, [SEAL], { encoding: "utf8" });
  for (const needle of BANNED) assert.ok(!help.includes(needle), `seal help printed a banned claim: ${needle}`);
});

test("README artifact claim rejects builder paths and development names in published-release copy", () => {
  const green = checkArtifactClaim(README);
  assert.equal(green.status, 0, green.stderr);

  const absolute = checkArtifactClaim(README.replace(ARTIFACT, `/home/monkey/wt/builder/dist/${ARTIFACT}`));
  assert.equal(absolute.status, 1);
  assert.match(absolute.stderr, /builder-local absolute artifact path/);

  const development = checkArtifactClaim(README.replace(ARTIFACT, `seal-v${PUBLISHED_VERSION}-dev.gdeadbee-linux-x64`));
  assert.equal(development.status, 1);
  assert.match(development.stderr, /development artifact named in published-release copy/);
});
