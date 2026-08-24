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
const FUNCTION_WORD = /^(?:a|an|the|also|its|their|local|current|ready|run|one|of|for|to|and|or|at|most|that|are|not|by|your|after|then|when|was|same|it|this|those|other)$/;

function proseSentences(text) {
  const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*/gm, "");
  return prose.split(/\n\s*\n/).flatMap((paragraph) => {
    const spans = [];
    const masked = paragraph.replace(/`[^`]*`/g, (span) => `@@CODE${spans.push(span) - 1}@@`);
    return (masked.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) || [])
      .map((sentence) => sentence.replace(/@@CODE(\d+)@@/g, (_, index) => spans[Number(index)]));
  }).map((sentence) => sentence.trim()).filter((sentence) => /\b(?:prints?|reports?|printed)\b/i.test(sentence));
}

function claimsFromSentence(sentence) {
  const active = sentence.match(/\b(?:prints?|reports?)\b\s+(.+)/i)?.[1] || sentence;
  const claims = [...active.matchAll(/`([^`]+)`/g)].map((match) => ({ text: match[1], terms: [match[1].toLowerCase()] }));
  const plain = active.replace(/`[^`]+`/g, " ");
  for (const piece of plain.split(/[,;]|\band\b/gi)) {
    const atMost = piece.match(/\bat most\s+(\d+)\b/i);
    if (atMost) {
      claims.push({ text: piece.trim(), atMost: Number(atMost[1]), terms: [] });
      continue;
    }
    const terms = (piece.toLowerCase().match(/[a-z0-9]+/g) || []).filter((word) => word.length > 2 && !FUNCTION_WORD.test(word));
    if (terms.length) claims.push({ text: piece.trim(), terms });
  }
  return claims;
}

function claimIsProduced(claim, output) {
  if (claim.atMost !== undefined) {
    return output.split("\n").some((line) => {
      const list = line.match(/:\s+(.+?)(?:\s+\(\+\d+ more\))?$/)?.[1];
      return list && list.split(",").length <= claim.atMost;
    });
  }
  return claim.terms.some((term) => output.toLowerCase().includes(term));
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

test("every README prose printed-output claim is produced by a documented command", () => {
  const readme = fs.readFileSync(README, "utf8");
  const sentences = proseSentences(readme);
  assert.ok(sentences.length > 1, "README must yield every prose printed-output sentence, not only the first one");
  assertClaimsProduced(readme, documentedOutputs());
});

test("an unseen false prose output claim fails and names the claim", () => {
  const readme = fs.readFileSync(README, "utf8");
  const changed = readme.replace("local `State:` path.", "local `State:` path and the operator's name.");
  const missing = missingClaims(changed, documentedOutputs());
  assert.ok(missing.some((claim) => claim.text.includes("operator's name")), `missing claims must name operator's name: ${JSON.stringify(missing)}`);
});

test("a false code-span output claim fails and names the claim", () => {
  const readme = fs.readFileSync(README, "utf8");
  const changed = readme.replace("local `State:` path.", "local `State:` path and `Digest:`.");
  const missing = missingClaims(changed, documentedOutputs());
  assert.ok(missing.some((claim) => claim.text === "Digest:"), `missing claims must name Digest:: ${JSON.stringify(missing)}`);
});

test("a true added output claim passes", () => {
  const readme = fs.readFileSync(README, "utf8");
  assertClaimsProduced(readme.replace("local `State:` path.", "local `State:` path and `Protection:`."), documentedOutputs());
});

test("a true State restatement passes", () => {
  const readme = fs.readFileSync(README, "utf8");
  assertClaimsProduced(readme.replace("The command also prints a local `State:` path.", "The command prints a `State:` path identifying its local state location."), documentedOutputs());
});
