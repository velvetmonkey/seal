// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SEAL = resolve(ROOT, "bin", "seal");
const VERSION = readFileSync(resolve(ROOT, "VERSION"), "utf8").trim();
const INDEX = readFileSync(resolve(ROOT, "docs", "assurance", "index.html"), "utf8");
const ARCHITECTURE = readFileSync(resolve(ROOT, "docs/assurance/architecture.md"), "utf8");
const SOURCES = [
  readFileSync(resolve(ROOT, "README.md"), "utf8"),
  ...readdirSync(resolve(ROOT, "docs"), { recursive: true })
    .filter((name) => name.endsWith(".md"))
    .map((name) => readFileSync(resolve(ROOT, "docs", name), "utf8")),
].join("\n");
const NORMALIZED_SOURCES = SOURCES.replaceAll(/`([^`]+)`/g, "$1");
const CUT_CLAIMS = [
  "Most MCP tools are harmless.",
  "Seal gates the dangerous one.",
  "Requires Git",
  "The authorization rule is PROVED.",
  "PROVED WASM authorization rule",
];

const SOURCED_BLOCKS = [
  "Seal puts an approval gate in front of a named set of tools on one MCP server. You approve one exact call. Seal will not run it twice. It might not run it at all. Seal writes a signed receipt of the decision. The demo generates a temporary signing key for its run; the protected path creates or reuses a machine-local signing key.",
  "Requires Node 20+ and the <code>claude</code> command for Protect. The install creates one command and one read-only store directory under <code>~/.local</code>.",
  `Seal v${VERSION} supports Linux x86-64 only. macOS, Windows, Linux ARM and other platforms are not supported in this release.`,
  "The release carries the approval contract and retry continuation through the same proxy for the demo and protected paths.",
  "The demo and the protected path run the same proxy and rule. The state machine is TESTED for the single-tool case. On a guarded retry, Node owns handle lookup, freshness, protocol shape, and durable one-use consumption. The exact-call authorization rule runs through the pinned vendored WASM, and its answer is required before forwarding. Kernel failure or a Node/kernel disagreement refuses — there is no JavaScript authorization fallback. The kernel configuration is currently signed by an Ed25519 key generated inside the same worker that submits it. That is demo-grade self-authorization, not an externally trusted production config key.",
  "Seal is a gate, not a sandbox. It controls the path through it, and only that path; a direct local write, Bash, network access, subprocesses, other tools, and other servers are outside Seal.",
  "Protect mediates a stdio MCP server entry. Other transport shapes are outside the protected path, and Protect relies on Claude Code for its local override.",
  "Both paths write signed receipt files. The demo's key is generated fresh for that run; the protected path creates or reuses a machine-local Ed25519 key under the Seal data directory. The checker accepts a receipt only against the public key you supply and only when the recorded decision, tool, arguments and signature match the sealed commitments.",
];

function withoutHtmlCode(text) {
  return text.replaceAll(/<code>(.*?)<\/code>/g, "$1");
}

test("the repository landing page uses only frisked product prose", () => {
  for (const block of SOURCED_BLOCKS) assert.ok(INDEX.includes(block), `index.html is missing sourced block: ${block}`);
  assert.match(NORMALIZED_SOURCES, /One exact call\. One approval\. One use\./);
  assert.match(NORMALIZED_SOURCES, /Seal controls calls that pass through the protected MCP server path\./);
  for (const claim of CUT_CLAIMS) {
    assert.equal(INDEX.includes(claim), false, `index.html contains cut claim: ${claim}`);
    assert.equal(NORMALIZED_SOURCES.includes(claim), false, `README/docs contain cut claim: ${claim}`);
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
  for (const label of ["Claude Code", "Node proxy", "TESTED state machine", "Selected MCP server"]) {
    assert.ok(ARCHITECTURE.includes(label), `architecture is missing ${label}`);
  }
});

test("README claim: Seal intercepts one call, asks approval, and refuses its replay", () => {
  const claim = "Seal is a proxy that intercepts one MCP tool call, asks you to approve it, and refuses to replay it without a new approval.";
  const dir = mkdtempSync(join(tmpdir(), "seal-readme-claim-"));
  let output;
  assert.doesNotThrow(() => {
    output = execFileSync(process.execPath, [SEAL, "demo", "--dir", dir], {
      input: "y\n", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
  }, claim);
  assert.match(output, /INPUT REQUIRED.*approval/s, claim);
  assert.match(output, /BLOCKED.*already_consumed/s, claim); // CLAIM-COVERAGE: README.md
  assert.equal(readFileSync(join(dir, "child", "data.txt.count"), "utf8").trim(), "1", claim);
});
