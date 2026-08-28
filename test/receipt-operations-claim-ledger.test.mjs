import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { claims } from "../scripts/receipt-operations-claims.mjs";
import { claimFiles, declaredClaimKeys, nonBehavioralSentences } from "../scripts/receipt-operations-claim-scope.mjs";

const ROOT = new URL("../", import.meta.url);
const normalize = (value) => value.replace(/\*\*/gu, "").replace(/\s+/gu, " ").trim();

function proseSentences(markdown) {
  const prose = markdown
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/^\s*<!--.*?-->\s*$/gmu, "")
    .replace(/^\s*#.*$/gmu, "")
    .replace(/^\s*[-*]\s+/gmu, "")
    .replace(/\n+/gu, " ");
  return prose.split(/(?<=[.!?:])\s+(?=[A-Z`*])/u).map(normalize).filter(Boolean);
}

test("every behavioral sentence in both receipt operations files is CHECKED or DECLARED", () => {
  const expected = new Map(claims.map((claim) => [`${claim.file}\0${normalize(claim.text)}`, claim]));
  assert.equal(expected.size, claims.length, "claim ledger must not duplicate a file/sentence row");
  for (const claim of claims) {
    assert.ok(["CHECKED", "DECLARED"].includes(claim.status), `${claim.file}: invalid status`);
    if (claim.status === "DECLARED") assert.ok(claim.reason && claim.reason.length > 20, `${claim.file}: declared claim needs a substantive reason`);
  }

  assert.deepEqual([...new Set(claims.map((claim) => claim.file))].sort(), [...claimFiles].sort(), "claim ledger files must equal the fixed receipt-operations scope");
  const checkedReasons = new Set(claims.filter((claim) => claim.status === "CHECKED").map((claim) => claim.reason));
  for (const claim of claims.filter((claim) => claim.status === "DECLARED")) {
    assert.ok(!checkedReasons.has(claim.reason), `${claim.file}: downgrading a checked claim requires a new declared reason`);
    assert.ok(declaredClaimKeys.has(`${claim.file}\0${normalize(claim.text)}`), `${claim.file}: downgrading a checked claim requires a new reviewed claim identity`);
  }

  const found = [];
  for (const file of claimFiles) {
    const sentences = proseSentences(readFileSync(new URL(file, ROOT), "utf8"));
    for (const sentence of sentences) if (!nonBehavioralSentences.has(sentence)) found.push({ file, sentence });
  }
  for (const file of claimFiles) {
    const expectedFile = claims.filter((claim) => claim.file === file);
    const foundFile = found.filter((claim) => claim.file === file);
    assert.equal(foundFile.length, expectedFile.length, `${file}: behavioral sentence count changed without a ledger row`);
    for (let index = 0; index < expectedFile.length; index += 1) {
      const expectedClaim = expectedFile[index];
      const foundClaim = foundFile[index];
      // A declared gap is deliberately not text-bound: falsifying its prose
      // must stay green because no executable claim is being made for it.
      if (expectedClaim.status === "CHECKED") {
        assert.equal(foundClaim.sentence, normalize(expectedClaim.text), `${file}: checked claim text changed without updating its check`);
      }
    }
  }
});
