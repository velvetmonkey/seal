// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const INDEX = readFileSync(resolve(ROOT, "index.html"), "utf8");
const ARCHITECTURE = readFileSync(resolve(ROOT, "docs/ARCHITECTURE.md"), "utf8");
const SOURCES = [
  readFileSync(resolve(ROOT, "README.md"), "utf8"),
  ...readdirSync(resolve(ROOT, "docs"), { recursive: true })
    .filter((name) => name.endsWith(".md"))
    .map((name) => readFileSync(resolve(ROOT, "docs", name), "utf8")),
].join("\n");
const NORMALIZED_SOURCES = SOURCES.replaceAll(/`([^`]+)`/g, "$1");

const SOURCED_BLOCKS = [
  "Seal puts an approval gate in front of one tool of one MCP server. You approve one exact call. Seal will not run it twice. It might not run it at all. Seal writes a receipt of the decision. Today only the demo signs its receipts, with a key it generates for that run; the protected path writes its receipts unsigned.",
  "Most MCP tools are harmless. Seal gates the dangerous one; the rest pass through.",
  "Requires Node 20+, Git, and the <code>claude</code> command for Protect (check with <code>claude --version</code>). The install creates one command and one read-only store directory under <code>~/.local</code>.",
  "Seal v0.1.1 supports Linux x86-64 only. macOS, Windows, Linux ARM and other platforms are not supported in this release.",
  "The release carries the approval contract and retry continuation through the same proxy for the demo and protected paths.",
  "The demo and the protected path run the same proxy and rule. The authorization rule is PROVED. The state machine is TESTED. On a guarded retry, Node owns handle lookup, freshness, protocol shape, and durable one-use consumption. The exact-call authorization rule runs through the pinned vendored WASM, and its answer is required before forwarding. Kernel failure or a Node/kernel disagreement refuses — there is no JavaScript authorization fallback. The kernel configuration is currently signed by an Ed25519 key generated inside the same worker that submits it. That is demo-grade self-authorization, not an externally trusted production config key.",
  "Seal is a gate, not a sandbox. It controls the path through it, and only that path; a direct local write, Bash, network access, subprocesses, other tools, and other servers are outside Seal.",
  "Protect mediates a stdio MCP server entry. Other transport shapes are outside the protected path, and Protect relies on Claude Code for its local override.",
  "Only the demo signs receipts, using a key generated for that run. The protected path writes its receipts unsigned, and the shipped checker refuses those protected-path receipts as <code>REFUSE unsealed</code>.",
];

function withoutHtmlCode(text) {
  return text.replaceAll(/<code>(.*?)<\/code>/g, "$1");
}

test("the repository landing page uses only frisked product prose", () => {
  for (const block of SOURCED_BLOCKS) {
    assert.ok(INDEX.includes(block), `index.html is missing sourced block: ${block}`);
    assert.ok(NORMALIZED_SOURCES.includes(withoutHtmlCode(block)), `README/docs do not contain landing-page block: ${block}`);
  }
  assert.doesNotMatch(INDEX, /public product-family hub|github\.com\/velvetmonkey\/seal-live-demo|github\.com\/velvetmonkey\/seal-host/);
});

test("the first architecture diagram is the shipped Node path", () => {
  const firstDiagram = ARCHITECTURE.indexOf("```mermaid");
  const nodePath = ARCHITECTURE.indexOf('claude["Claude Code');
  const rustLineage = ARCHITECTURE.indexOf('subgraph host["Enforcement — seal-host');
  assert.ok(firstDiagram >= 0);
  assert.ok(nodePath > firstDiagram, "the shipped Node path must be in the first diagram");
  assert.ok(rustLineage > nodePath, "the Rust host must follow as assurance lineage");
  for (const label of ["Claude Code", "Node proxy", "TESTED state machine", "PROVED WASM authorization rule", "Selected MCP server"]) {
    assert.ok(ARCHITECTURE.includes(label), `architecture is missing ${label}`);
  }
});
