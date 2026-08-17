import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const SVG_PATH = resolve(ROOT, "assets/seal-flow.svg");
// CLAIM-COVERAGE: assets/seal-flow.svg
const svg = readFileSync(SVG_PATH, "utf8");
const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");

test("README places the process graphic immediately before Install", () => {
  assert.match(readme, /!\[[^\]]*\]\(assets\/seal-flow\.svg\)\n\n## 1\. Install/);
});

test("critical diagram labels remain searchable SVG text", () => {
  const labels = [
    "AGENT",
    "CONFIG · READ, NOT OWNED",
    "SEAL",
    "pinned WASM decides.",
    "Node cannot overrule",
    "REPLAY blocked · counter stays 1",
    "MCP SERVER",
    "demo.mutate",
    "db.read",
    "fs.list",
    "call really runs",
    "UNPROTECTED MCP",
  ];
  for (const label of labels) {
    assert.match(svg, new RegExp(`<text[^>]*>${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</text>`));
  }
});

test("one guarded and two bypass routes terminate on the three server bars", () => {
  assert.match(svg, /d="M866 167h244" class="accent-stroke" marker-end="url\(#arrow-accent\)"/);
  assert.match(svg, /d="M88 122V24H1062V221H1110" class="muted-stroke" marker-end="url\(#arrow-muted\)"/);
  assert.match(svg, /d="M126 212V640H1422V276H1296" class="muted-stroke" marker-end="url\(#arrow-muted\)"/);
  assert.match(svg, /<rect x="1110" y="143" width="184" height="46" rx="8" class="accent-stroke"/);
  assert.match(svg, /<rect x="1110" y="198" width="184" height="46" rx="8" class="muted-stroke"/);
  assert.match(svg, /<rect x="1110" y="253" width="184" height="46" rx="8" class="muted-stroke"/);
});

test("the resource effect is one and explicitly outside the gate", () => {
  assert.match(svg, /<text x="1320" y="151"[^>]*>1<\/text>/);
  assert.match(svg, />call really runs<\/text>/);
  assert.match(svg, />outside Seal<\/text>/);
});

test("receipt mark is neutral and the pin is a drawing pin", () => {
  assert.match(svg, /<text x="840" y="402"[^>]*>S<\/text>/);
  assert.doesNotMatch(svg, /M1007 240l9 9 18-22/);
  assert.doesNotMatch(svg, /♀/);
  assert.match(svg, /M615 121h25M620 121v10l-6 7h28l-6-7v-10M628 138v20/);
});

test("configuration ownership and non-sandbox limits stay explicit", () => {
  for (const label of ["Seal reads", "+ hashes", "Claude Code", "writes", "entry changed:", "REFUSE"]) {
    assert.match(svg, new RegExp(`>${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</text>`));
  }
  assert.match(svg, /ALSO OUTSIDE SEAL: Bash · network · subprocesses · other tools · other servers/);
});
