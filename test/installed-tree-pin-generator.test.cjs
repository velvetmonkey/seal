// SPDX-License-Identifier: Apache-2.0
// Generator-side discovery behavior. The external gate intentionally does
// not import this helper; its population comes from the declared site manifest.
const assert = require("node:assert/strict");
const test = require("node:test");
const { isJsonRecords, quotedTreeHashHits } = require("../scripts/installed-tree-pin.cjs");

function assertNamedRefuse(fn, code) {
  let failed = null;
  try {
    fn();
  } catch (error) {
    failed = error;
  }
  assert.ok(failed, `expected REFUSE ${code}, but the pin accepted the artifact`);
  assert.match(String(failed.message), new RegExp(`^REFUSE ${code}:`));
}

test("published-asset markers govern four download shapes without prose inference", () => {
  const publishedShape = "a".repeat(64);
  const shapes = [
    "$ gh release download v0.2.0-rc.2 --pattern 'seal-*-linux-x64'",
    "$ cp /srv/internal-release-mirror/seal/v0.2.0-rc.2/linux-x64 ./seal",
    "$ gh api repos/velvetmonkey/seal/releases/assets/123456 > ./seal",
    "$ release-cache get velvetmonkey/seal v0.2.0-rc.2 linux-x64 > ./seal",
  ];
  for (const prose of shapes) {
    const text = [
      prose,
      "**Seal installed-tree pin role:** `published-asset`",
      "```output",
      `store: /home/x/.local/lib/seal/store/${publishedShape}`,
      "```",
    ].join("\n");
    const hits = quotedTreeHashHits(text, "shape.md");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].role, "published-asset");
  }
});

test("a fresh-build marker wins when prose incidentally mentions releases/download", () => {
  const freshShape = "b".repeat(64);
  const text = [
    "Unlike releases/download/, this builds the checkout.",
    "**Seal installed-tree pin role:** `fresh-build`",
    "```text",
    `node "/scratch/.local/lib/seal/store/${freshShape}/checker/seal-receipt-v2.mjs" receipt.json`,
    "```",
  ].join("\n");
  const hits = quotedTreeHashHits(text, "fresh.md");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].role, "fresh-build");
});

test("two role markers before one fenced pin are a named ambiguity", () => {
  const text = [
    "<!-- Seal installed-tree pin role: published-asset -->",
    "<!-- Seal installed-tree pin role: fresh-build -->",
    "```output",
    `tree: ${"e".repeat(64)}`,
    "```",
  ].join("\n");
  assertNamedRefuse(() => quotedTreeHashHits(text, "ambiguous.md"), "role_marker_ambiguous");
  assert.throws(
    () => quotedTreeHashHits(text, "ambiguous.md"),
    /ambiguous\.md:1 and ambiguous\.md:2 precede fenced block at ambiguous\.md:3/,
  );
});

test("an unmarked store hash is a named refusal with file, line, and required markers", () => {
  const text = ["```output", `store: /store/${"c".repeat(64)}`, "```"].join("\n");
  assertNamedRefuse(() => quotedTreeHashHits(text, "unmarked.md"), "role_marker_absent");
  assert.throws(
    () => quotedTreeHashHits(text, "unmarked.md"),
    /unmarked\.md:2.*Seal installed-tree pin role:.*published-asset.*Seal installed-tree pin role:.*fresh-build/,
  );
});

test("an unrecognised store-hash role is a named refusal", () => {
  const text = [
    "**Seal installed-tree pin role:** `release-cache`",
    "```output",
    `tree: ${"d".repeat(64)}`,
    "```",
  ].join("\n");
  assertNamedRefuse(() => quotedTreeHashHits(text, "unknown.md"), "role_marker_unknown");
  assert.throws(() => quotedTreeHashHits(text, "unknown.md"), /unknown\.md:1 unknown store-hash role "release-cache"/);
});

test("record content, not filename or digest, separates captures from documentation", () => {
  const hash = "a".repeat(64);
  const records = [JSON.stringify({ text: `/store/${hash}` }), JSON.stringify({ count: 2 })].join("\r\n");
  for (const file of ["future.jsonl", "renamed.md", "extensionless"]) {
    assert.equal(isJsonRecords(records), true);
    assertNamedRefuse(() => quotedTreeHashHits(records, file), "pin_source_not_documentation");
    assert.throws(() => quotedTreeHashHits(records, file), /is a JSON record stream, not a documentation page; recorded store paths are not installed-tree pins/);
  }
  const doc = ["<!-- Seal installed-tree pin role: fresh-build -->", "```output", `/store/${hash}`, "```"].join("\n");
  assert.equal(isJsonRecords(doc), false);
  assert.equal(quotedTreeHashHits(doc, "mistaken.jsonl")[0].hash, hash);
  const unmarked = doc.split("\n").slice(1).join("\n");
  assertNamedRefuse(() => quotedTreeHashHits(unmarked, "mistaken.jsonl"), "role_marker_absent");
  for (const text of ["", "\n", '{"text":', records + "\nprose"]) {
    assert.equal(isJsonRecords(text), false, text);
  }
  for (const text of [JSON.stringify([`/store/${hash}`]), JSON.stringify(`/store/${hash}`), "null", "42", "true"]) {
    assert.equal(isJsonRecords(text), true, text);
  }
  // A JSON example inside a documentation fence is still a documentation pin.
  const fencedRecords = doc.replace(`/store/${hash}`, JSON.stringify({ text: `/store/${hash}` }));
  assert.equal(isJsonRecords(fencedRecords), false);
  assert.equal(quotedTreeHashHits(fencedRecords, "example.md").length, 1);
});
