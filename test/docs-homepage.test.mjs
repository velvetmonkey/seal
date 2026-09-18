// SPDX-License-Identifier: Apache-2.0
//
// The docs-site homepage (docs/src/pages/index.astro) is a claim-bearing page
// registered in scripts/claim-bearing-files.json. This test is that page's
// coverage: it fixes the mandated hero copy, scope sentence and proof-status
// note from the docs-site specification so an edit cannot silently drop or
// reword them.
// CLAIM-COVERAGE: docs/src/pages/index.astro#homepage
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const HOMEPAGE = readFileSync(resolve(ROOT, "docs/src/pages/index.astro"), "utf8");

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

const REQUIRED_STRINGS = [
  "Seal — approval for selected AI-agent tool calls",
  "Approve the exact tool call.",
  "Seal is a local approval gate for selected Claude Code MCP tool calls. Review the exact request, allow at most one execution per approval, and inspect a signed decision receipt.",
  "Seal is a gate, not a sandbox. Calls and effects outside the configured Seal route remain outside its control.",
  "The companion tools let you check recorded evidence separately from the running Seal deployment. The browser checker and CLI share kernel and receipt-format dependencies, so their agreement can also reflect a shared defect. A passing receipt check establishes only the properties it reports; it does not by itself establish operator identity or prove that a tool effect occurred.",
  "Lean proofs cover specified decision-model properties. Seal currently documents that correspondence between its proved authorization model and shipped authorization path is neither tested nor proved.",
];

test("homepage carries the mandated hero, scope and proof-status copy", () => {
  const normalized = normalize(HOMEPAGE);
  for (const required of REQUIRED_STRINGS) {
    assert.ok(normalized.includes(normalize(required)), `homepage is missing required copy: ${required}`);
  }
});

test("homepage does not show a fabricated verdict or badge", () => {
  assert.doesNotMatch(HOMEPAGE, /\bPASS\b/, "homepage must not print an unlabeled sample PASS result");
  assert.doesNotMatch(HOMEPAGE, /verified badge|Verified ✓|✓ Verified/i, "homepage must not show a whole-product verified badge");
});

test("homepage template hides the sidebar and table of contents (Starlight splash)", () => {
  assert.match(HOMEPAGE, /template:\s*'splash'/, "homepage must use Starlight's splash template so the sidebar/TOC do not appear");
});
