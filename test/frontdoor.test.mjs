// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const VERSION = readFileSync(resolve(ROOT, "VERSION"), "utf8").trim();
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
  "Seal puts an approval gate in front of one tool of one MCP server. You approve one exact call. Seal will not run it twice. It might not run it at all. Seal writes a signed receipt of the decision. The demo generates a temporary signing key for its run; the protected path creates or reuses a machine-local signing key.",
  "Most MCP tools are harmless. Seal gates the dangerous one; the rest pass through.",
  "Requires Node 20+, Git, and the <code>claude</code> command for Protect (check with <code>claude --version</code>). The install creates one command and one read-only store directory under <code>~/.local</code>.",
  `Seal v${VERSION} supports Linux x86-64 only. macOS, Windows, Linux ARM and other platforms are not supported in this release.`,
  "The release carries the approval contract and retry continuation through the same proxy for the demo and protected paths.",
  "The demo and the protected path run the same proxy and rule. The authorization rule is PROVED. The state machine is TESTED. On a guarded retry, Node owns handle lookup, freshness, protocol shape, and durable one-use consumption. The exact-call authorization rule runs through the pinned vendored WASM, and its answer is required before forwarding. Kernel failure or a Node/kernel disagreement refuses — there is no JavaScript authorization fallback. The kernel configuration is currently signed by an Ed25519 key generated inside the same worker that submits it. That is demo-grade self-authorization, not an externally trusted production config key.",
  "Seal is a gate, not a sandbox. It controls the path through it, and only that path; a direct local write, Bash, network access, subprocesses, other tools, and other servers are outside Seal.",
  "Protect mediates a stdio MCP server entry. Other transport shapes are outside the protected path, and Protect relies on Claude Code for its local override.",
  "Both paths write signed receipt files. The demo's key is generated fresh for that run; the protected path creates or reuses a machine-local Ed25519 key under the Seal data directory. The checker accepts a receipt only against the public key you supply and only when the recorded decision, tool, arguments and signature match the sealed commitments.",
];

function withoutHtmlCode(text) {
  return text.replaceAll(/<code>(.*?)<\/code>/g, "$1");
}

test("the repository landing page uses only frisked product prose", () => {
  for (const block of SOURCED_BLOCKS) {
    assert.ok(INDEX.includes(block), `index.html is missing sourced block: ${block}`);
    assert.ok(NORMALIZED_SOURCES.includes(withoutHtmlCode(block)), `README/docs do not contain landing-page block: ${block}`);
  }
  assert.doesNotMatch(INDEX, /public product-family hub|seal-live-demo|(?:deployed\s+)?Rust\s+host/i);
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
