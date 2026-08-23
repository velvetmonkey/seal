import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
// CLAIM-COVERAGE: assets/seal-flow.svg
// CLAIM-COVERAGE: scripts/seal-flow-layout.svg
const SVG_PATH = resolve(ROOT, "assets/seal-flow.svg");
const svg = readFileSync(SVG_PATH, "utf8");
const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");

test("README shows the terminal approval capture instead of the process graphic", () => {
  assert.doesNotMatch(readme, /assets\/seal-flow\.svg/);
  assert.match(readme, /INPUT REQUIRED[\s\S]*?BLOCKED/);
});

test("renderer reproduces the committed SVG bytes", () => {
  const before = readFileSync(SVG_PATH);
  const result = spawnSync(process.execPath, [resolve(ROOT, "scripts/render-seal-flow.mjs")], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.deepEqual(readFileSync(SVG_PATH), before);
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
    const pattern = new RegExp(`<text[^>]*>${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</text>`);
    assert.ok(pattern.test(svg), `SVG missing searchable text label: ${label}`);
  }
});

test("one guarded and two not-approval-gated routes pass through Seal to the server bars", () => {
  assert.match(svg, /d="M1177 331h142" class="accent" marker-end="url\(#arrow-accent\)"/);
  assert.match(svg, /data-clearance="16" d="M186 368c27 0 35 12 35 39v138c0 27 12 40 39 40h241"/);
  assert.match(svg, /data-clearance="16" d="M510 585h690c17 0 25-8 25-25V336h65"/);
  assert.match(svg, /data-clearance="16" d="M186 392c17 0 23 12 23 39v144c0 27 12 40 39 40h253"/);
  assert.match(svg, /data-clearance="16" d="M510 615h715c17 0 25-8 25-25V455h40"/);
  assert.match(svg, /<rect data-padding="16" x="1330" y="180" width="195" height="55" fill="#a23e22"/);
  assert.match(svg, /<rect data-padding="16" x="1330" y="306" width="195" height="61" fill="#66645f"/);
  assert.match(svg, /<rect data-padding="16" x="1330" y="424" width="195" height="62" fill="#66645f"/);
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
  for (const label of ["claude mcp add", "installs same-name", "local entry;", "shadows project", "after restart", "never modified", "project server entry", "recorded digest", "REFUSED"]) {
    assert.match(svg, new RegExp(`>${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</text>`));
  }
  assert.match(svg, />-&gt; FORWARDING<\/text>/);
  assert.match(svg, /NOT APPROVAL-GATED/);
  assert.match(svg, /passes through Seal/);
  assert.doesNotMatch(svg, /never sees Seal|never touches Seal/);
});

test("generated layout has uniform connector clearance and no geometric collisions", () => {
  assert.equal([...svg.matchAll(/<rect data-padding="16"/g)].length, 9, "every content box must carry the 16px padding invariant");
  const result = spawnSync(process.execPath, [resolve(ROOT, "scripts/check-seal-flow-layout.mjs")], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /no text\/text, text\/connector, or text\/icon overlaps/);
  assert.match(result.stdout, /keep >=16px from every text and icon/);
});
