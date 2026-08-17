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

test("README presents the approved three-step explanation", () => {
  assert.match(
    readme,
    /## How it works\n\n1\. \*\*Protect once\.\*\*[\s\S]*2\. \*\*Approve per call\.\*\*[\s\S]*3\. \*\*Keep the receipt\.\*\*/,
  );
  assert.match(readme, /Other tools on the protected server are not approval-gated, but still pass through Seal's forwarding checks\./);
  assert.match(readme, /Seal writes a signed receipt for every guarded decision\./);
  assert.doesNotMatch(readme, /other tools remain outside Seal|other tools OUTSIDE Seal/);
});

test("critical diagram labels remain searchable SVG text", () => {
  const labels = [
    "AGENT",
    "CONFIG",
    "DRIFT",
    "SEAL",
    "one tool of one server",
    "THE GATE",
    "pinned WASM decides.",
    "Node cannot overrule",
    "ONE USE",
    "REPLAY REFUSED",
    "FORWARDED",
    "MCP SERVER",
    "demo.mutate",
    "db.read",
    "fs.list",
    "THE REAL EFFECT",
    "PROTECTED PATH",
    "NOT APPROVAL-GATED",
  ];
  for (const label of labels) {
    assert.match(svg, new RegExp(`<text[^>]*>${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</text>`));
  }
});

test("one guarded and two not-approval-gated routes pass through Seal to the server bars", () => {
  assert.match(svg, /d="M1177 331h142" class="accent" marker-end="url\(#arrow-accent\)"/);
  assert.match(svg, /d="M166 368c37 0 56 6 56 43v38c0 24 12 35 39 35h209" class="muted" marker-end="url\(#arrow-muted\)"/);
  assert.match(svg, /d="M497 484h680v-148h142" class="muted" marker-end="url\(#arrow-muted\)"/);
  assert.match(svg, /d="M166 392c21 0 31 12 31 39v100c0 21 13 31 36 31h239" class="muted" marker-end="url\(#arrow-muted\)"/);
  assert.match(svg, /d="M497 562h680v-107h142" class="muted" marker-end="url\(#arrow-muted\)"/);
  assert.match(svg, /<rect x="1344" y="188" width="168" height="39" fill="#a23e22"/);
  assert.match(svg, /<rect x="1344" y="316" width="168" height="41" fill="#66645f"/);
  assert.match(svg, /<rect x="1344" y="434" width="168" height="42" fill="#66645f"/);
});

test("the resource effect is one and explicitly outside the gate", () => {
  assert.match(svg, /<text x="1717" y="309"[^>]*>1<\/text>/);
  assert.match(svg, />THE REAL EFFECT<\/text>/);
  assert.match(svg, />changes, once\.<\/text>/);
  assert.match(svg, />outside Seal<\/text>/);
  assert.doesNotMatch(svg, /class="muted"[^>]*marker-end[^>]*M1512 208/);
});

test("receipt uses a neutral wax seal and kernel uses an anchor", () => {
  assert.match(svg, /<circle cx="1108" cy="404" r="14" fill="#a23e22"/);
  assert.doesNotMatch(svg, /M1007 240l9 9 18-22/);
  assert.doesNotMatch(svg, /♀/);
  assert.match(svg, /M731 358c0 17 30 17 30 0/);
});

test("configuration ownership and non-sandbox limits stay explicit", () => {
  for (const label of ["Seal read it", "and hashed it.", "never edits it", "Claude Code", "override."]) {
    assert.match(svg, new RegExp(`>${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</text>`));
  }
  assert.match(svg, />REFUSE<\/tspan>/);
  assert.match(svg, /NOT APPROVAL-GATED/);
  assert.match(svg, /passes through Seal/);
  assert.doesNotMatch(svg, /never sees Seal|never touches Seal/);
});
