const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { makeProtectFixture } = require("../test-support/protect-output-fixture.cjs");

const ROOT = path.join(__dirname, "..");
const README = path.join(ROOT, "README.md");
const SEAL = path.join(ROOT, "bin", "seal");

function proseSentences(text) {
  const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*/gm, "");
  return prose.split(/\n\s*\n/).flatMap((paragraph) => {
    const spans = [];
    const masked = paragraph.replace(/`[^`]*`/g, (span) => `@@CODE${spans.push(span) - 1}@@`);
    return (masked.replace(/\s+/g, " ").match(/[^.!?:]+(?:[.!?]+|:(?=\s*$))/g) || [])
      .map((sentence) => sentence.replace(/@@CODE(\d+)@@/g, (_, index) => spans[Number(index)]));
  }).map((sentence) => sentence.trim()).filter((sentence) => /\b(?:prints?|reports?|printed|output from)\b/i.test(sentence));
}

function claimsFromSentence(sentence) {
  const activeMatch = sentence.match(/\b(?:prints?|reports?)\b\s+(.+)/i)?.[1];
  const beforePassive = sentence.match(/^(.+?)\s+printed\s+by\b/i)?.[1];
  let passiveObject = beforePassive?.slice(beforePassive.lastIndexOf(",") + 1).trim();
  if (passiveObject && !beforePassive.includes(",")) passiveObject = passiveObject.split(/\s+/).slice(-3).join(" ");
  const active = activeMatch || passiveObject || sentence;
  const claims = [...active.matchAll(/`([^`]+)`/g)].map((match) => ({ text: match[1], exact: match[1].toLowerCase() }));
  const plain = active.replace(/`[^`]+`/g, " ");
  for (const piece of plain.split(/[,;]|\band\b/gi)) {
    const atMost = piece.match(/\bat most\s+(\d+)\b/i);
    if (atMost) {
      claims.push({ text: piece.trim(), atMost: Number(atMost[1]), terms: [] });
      continue;
    }
    if (/\bat most\s+\d+\b/i.test(active) && /\bcount\w*\b/i.test(piece)) continue;
    const terms = (piece.toLowerCase().match(/[a-z0-9]+/g) || []).filter((word) => /^\d+$/.test(word) || word.length > 2);
    if (terms.length) claims.push({ text: piece.trim(), terms });
  }
  return claims;
}

function claimIsProduced(claim, output) {
  if (claim.exact !== undefined) return output.toLowerCase().includes(claim.exact);
  if (claim.atMost !== undefined) {
    return output.split("\n").some((line) => {
      const list = line.match(/:\s+(.+?)\s+\(\+\d+ more\)$/)?.[1];
      return list && list.split(",").length <= claim.atMost;
    });
  }
  const normalize = (word) => word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word;
  const outputTerms = new Set((output.toLowerCase().match(/[a-z0-9]+/g) || []).map(normalize));
  const produced = claim.terms.filter((term) => outputTerms.has(normalize(term)));
  return produced.length >= Math.max(1, Math.ceil(claim.terms.length / 2));
}

function missingClaims(text, output) {
  return proseSentences(text).flatMap(claimsFromSentence).filter((claim) => !claimIsProduced(claim, output));
}

function documentedOutputs() {
  const root = fs.mkdtempSync(path.join(os.homedir(), "scratch-claimed-output-"));
  const toolNames = ["demo.mutate", ...Array.from({ length: 21 }, (_, index) => `other_${index}`)].join(",");
  const fixture = makeProtectFixture(root, toolNames);
  const protect = fixture.run(["protect", "db", "demo.mutate"]);
  const status = spawnSync(process.execPath, [SEAL, "status"], { cwd: root, encoding: "utf8" });
  assert.equal(status.status, 0, status.stdout + status.stderr);
  const unprotect = fixture.run(["unprotect", "db"]);
  const demoDir = path.join(root, "demo");
  const demo = spawnSync(process.execPath, [SEAL, "demo", "--dir", demoDir], { input: "y\n", encoding: "utf8" });
  assert.equal(demo.status, 0, demo.stdout + demo.stderr);
  return [protect, status.stdout, unprotect, demo.stdout].join("\n");
}

function assertClaimsProduced(readme, output) {
  const missing = missingClaims(readme, output);
  assert.deepEqual(missing, [], `README printed-output claims missing from output: ${missing.map((claim) => claim.text).join(", ")}`);
}

if (process.env.SEAL_README_OUTPUT_PROBE) {
  const readme = fs.readFileSync(README, "utf8");
  const changed = appendClaim(readme, process.env.SEAL_README_OUTPUT_PROBE);
  const missing = missingClaims(changed, documentedOutputs());
  if (missing.length) {
    process.stderr.write(`README printed-output claims missing from output: ${missing.map((claim) => claim.text).join(", ")}\n`);
    process.exit(1);
  }
  process.stdout.write(`README printed-output claim produced: ${process.env.SEAL_README_OUTPUT_PROBE}\n`);
  process.exit(0);
}

if (process.env.SEAL_README_OUTPUT_RESTATEMENT_PROBE) {
  const readme = fs.readFileSync(README, "utf8");
  const changed = readme.replace("The demo prints its temporary\ndirectory.", "Its temporary directory is\nprinted by the demo.");
  assert.notEqual(changed, readme, "restatement fixture must change the README text in memory");
  assertClaimsProduced(changed, documentedOutputs());
  process.stdout.write("README printed-output restatement produced: Its temporary directory is printed by the demo.\n");
  process.exit(0);
}

test("every README prose printed-output claim is produced by a documented command", () => {
  const readme = fs.readFileSync(README, "utf8");
  const sentences = proseSentences(readme);
  assert.equal(sentences.length, 9, `README printed-output sentence population changed: ${JSON.stringify(sentences)}`);
  assert.ok(sentences.some((sentence) => sentence.includes("receipt and public-key paths printed by your demo:")), "colon-ended printed-path assertion must be examined");
  assert.ok(sentences.some((sentence) => sentence.includes("real output from `seal demo`")), "output-from assertion must be examined");
  assertClaimsProduced(readme, documentedOutputs());
});

function appendClaim(readme, sentence) {
  return `${readme.trimEnd()}\n\n${sentence}\n`;
}

function assertFalseClaimIsNamed(readme, sentence, name) {
  const missing = missingClaims(appendClaim(readme, sentence), documentedOutputs());
  assert.ok(missing.some((claim) => claim.text.includes(name)), `missing claims must name ${name}: ${JSON.stringify(missing)}`);
}

test("a false plain prose object fails and names the claim", () => {
  const readme = fs.readFileSync(README, "utf8");
  assertFalseClaimIsNamed(readme, "The command prints a zirconium compass.", "zirconium compass");
});

test("a false possessive claim fails and names the claim", () => {
  const readme = fs.readFileSync(README, "utf8");
  assertFalseClaimIsNamed(readme, "The command reports the custodian's constellation.", "custodian's constellation");
});

test("a false numeric and ordering claim fails and names the claim", () => {
  const readme = fs.readFileSync(README, "utf8");
  assertFalseClaimIsNamed(readme, "The command reports 37 quasar tokens in heliotrope-prior sequence.", "37 quasar tokens in heliotrope-prior sequence");
});

test("a false spelled-out count and ordering claim fails and names the claim", () => {
  const readme = fs.readFileSync(README, "utf8");
  assertFalseClaimIsNamed(readme, "The command prints exactly seventeen quasar tokens before any preamble.", "exactly seventeen quasar tokens before any preamble");
});

test("all extracted claim components must be produced", () => {
  const readme = fs.readFileSync(README, "utf8");
  assertFalseClaimIsNamed(readme, "The command prints `State:` and a zirconium compass.", "zirconium compass");
});

test("a true Protection output claim passes", () => {
  const readme = fs.readFileSync(README, "utf8");
  assertClaimsProduced(appendClaim(readme, "The command prints `Protection:`."), documentedOutputs());
});

test("a true PENDING RESTART output claim passes", () => {
  const readme = fs.readFileSync(README, "utf8");
  assertClaimsProduced(appendClaim(readme, "The command reports `PENDING RESTART db.demo.mutate`."), documentedOutputs());
});

test("a true temporary-directory restatement passes", () => {
  const readme = fs.readFileSync(README, "utf8");
  const changed = readme.replace("The demo prints its temporary\ndirectory.", "Its temporary directory is\nprinted by the demo.");
  assert.notEqual(changed, readme, "restatement fixture must change the README text in memory");
  assertClaimsProduced(changed, documentedOutputs());
});
