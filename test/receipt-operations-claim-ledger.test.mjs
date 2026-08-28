import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { claims, claimFiles } from "../scripts/receipt-operations-claims.mjs";

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

function behavioral(sentence) {
  return /\b(?:is|are|describes|parses|makes|executes|asserts|performs|establishes|loads|recomputes|compares|applies|emits|may|returns|refuses|has|accepting|tested|checked|covers|does not|owns|remain(?:s|ed)?|rendered)\b/i.test(sentence);
}

test("every behavioral sentence in both receipt operations files is CHECKED or DECLARED", () => {
  const expected = new Map(claims.map((claim) => [`${claim.file}\0${normalize(claim.text)}`, claim]));
  assert.equal(expected.size, claims.length, "claim ledger must not duplicate a file/sentence row");
  for (const claim of claims) {
    assert.ok(["CHECKED", "DECLARED"].includes(claim.status), `${claim.file}: invalid status`);
    if (claim.status === "DECLARED") assert.ok(claim.reason && claim.reason.length > 20, `${claim.file}: declared claim needs a substantive reason`);
  }

  const found = [];
  for (const file of claimFiles) {
    const sentences = proseSentences(readFileSync(new URL(file, ROOT), "utf8"));
    for (const sentence of sentences) if (behavioral(sentence)) found.push({ file, sentence });
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
