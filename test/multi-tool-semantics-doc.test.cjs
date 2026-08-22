// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const DOC = path.join(ROOT, "docs/reference/multi-tool-semantics.md");
const PROTECTION = path.join(ROOT, "spine/protection.cjs");

function codeDeclaresCompleteSet(source) {
  return /const requestedTools = \[\.\.\.new Set\([\s\S]*?const existing = readState\(statePath\);[\s\S]*?existing\.state !== STATES\.UNPROTECTED[\s\S]*?throw new ProtectionError\("already_protected"/.test(source) &&
    new RegExp("guard" + "Tools: requestedTools").test(source);
}

test("multi-tool semantics document and protection code agree on declared-set behavior", () => {
  const document = fs.readFileSync(DOC, "utf8");
  const source = fs.readFileSync(PROTECTION, "utf8");
  const documentedAnswer = "Protection is declared as the complete set for one server; a later\n`seal protect` refuses while that server is protected instead of adding tools.";

  assert.ok(document.includes(documentedAnswer), "the documented declared-set answer changed or disappeared");
  assert.ok(codeDeclaresCompleteSet(source), "protection code no longer implements the documented declared-set refusal");

  const additiveMutation = source.replace(
    'throw new ProtectionError("already_protected", `project is already ${existing.state}`);',
    "return existing; // synthetic additive-semantics drift control",
  );
  assert.notEqual(additiveMutation, source, "synthetic drift control did not alter the load-bearing refusal");
  assert.equal(codeDeclaresCompleteSet(additiveMutation), false, "drift check must reject code with the load-bearing refusal removed");
});
