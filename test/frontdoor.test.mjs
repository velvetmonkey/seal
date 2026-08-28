// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  checkDocsRouteTable,
  checkReadmeFrontDoor,
  DOCS_ROUTE_TABLE,
  README_SECTIONS,
} from "../test-support/front-door-invariants.mjs";

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

const TRUTH_GATE = resolve(ROOT, "scripts", "launch-truth-gate.mjs");
const LANGUAGE_GUARD = resolve(ROOT, "scripts", "public-page-language-guard.mjs");

test("README carries the eleven front-door sections in order", () => {
  const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
  assert.doesNotThrow(() => checkReadmeFrontDoor(readme));
  assert.throws(() => checkReadmeFrontDoor(readme.replace(README_SECTIONS[5], "")), /required section absent or out of order/);
  const reordered = readme.replace(README_SECTIONS[5], "TEMP_SECTION")
    .replace(README_SECTIONS[6], README_SECTIONS[5])
    .replace("TEMP_SECTION", README_SECTIONS[6]);
  assert.throws(() => checkReadmeFrontDoor(reordered), /required section absent or out of order/);
});

test("docs/README contains only its heading and three-route table", () => {
  const routes = readFileSync(resolve(ROOT, "docs/README.md"), "utf8");
  assert.doesNotThrow(() => checkDocsRouteTable(routes)); // CLAIM-COVERAGE: docs/README.md
  assert.throws(() => checkDocsRouteTable(`${DOCS_ROUTE_TABLE}\nStray paragraph.\n`), /must contain only/);
});

test("public pages use the banked language discipline", (t) => {
  const green = spawnSync(process.execPath, [LANGUAGE_GUARD], { cwd: ROOT, encoding: "utf8" });
  assert.equal(green.status, 0, green.stdout + green.stderr);

  const dir = mkdtempSync(join(tmpdir(), "seal-public-language-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "page.md"), "This product is production-ready.\n");
  writeFileSync(join(dir, "scope.json"), JSON.stringify({ pages: ["page.md"] }));
  const red = spawnSync(process.execPath, [LANGUAGE_GUARD], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, SEAL_PUBLIC_PAGE_ROOT: dir, SEAL_PUBLIC_PAGE_SCOPE: join(dir, "scope.json") },
  });
  assert.notEqual(red.status, 0);
  assert.match(red.stderr, /page\.md:1 contains banned phrase: production-ready/);

  writeFileSync(join(dir, "page.md"), 'Quoted: "production-ready". Blocked substring: unproduction-readyish.\n');
  const quoted = spawnSync(process.execPath, [LANGUAGE_GUARD], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, SEAL_PUBLIC_PAGE_ROOT: dir, SEAL_PUBLIC_PAGE_SCOPE: join(dir, "scope.json") },
  });
  assert.equal(quoted.status, 0, quoted.stdout + quoted.stderr);

  writeFileSync(join(dir, "page.md"), `The checker is ${"indepen" + "dent"}.\n`);
  const bareIndependent = spawnSync(process.execPath, [LANGUAGE_GUARD], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, SEAL_PUBLIC_PAGE_ROOT: dir, SEAL_PUBLIC_PAGE_SCOPE: join(dir, "scope.json") },
  });
  assert.notEqual(bareIndependent.status, 0);
  assert.match(bareIndependent.stderr, /bare indepen(?:dent) description/);

  writeFileSync(join(dir, "page.md"), `The checker is ${"indepen" + "dent"} of its producer implementation.\n`);
  const qualifiedIndependent = spawnSync(process.execPath, [LANGUAGE_GUARD], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, SEAL_PUBLIC_PAGE_ROOT: dir, SEAL_PUBLIC_PAGE_SCOPE: join(dir, "scope.json") },
  });
  assert.equal(qualifiedIndependent.status, 0, qualifiedIndependent.stdout + qualifiedIndependent.stderr);

});

const SOURCED_BLOCKS = [
  "Seal puts an approval gate in front of a named set of tools on one MCP server. You approve one exact call. Seal will not run it twice. It might not run it at all. Seal writes a signed receipt of the decision. The demo generates a temporary signing key for its run; the protected path creates or reuses a machine-local signing key.",
  "Requires Node 20+ and the <code>claude</code> command for Protect. The install creates one command and one read-only store directory under <code>~/.local</code>.",
  "macOS source portability is CI-exercised for install, demo and receipt checking. Protect is not supported on macOS yet.",
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
  assert.match(NORMALIZED_SOURCES, /Seal is a local approval boundary for AI-agent tool calls\./);
  assert.match(NORMALIZED_SOURCES, /Claude can ask\. Seal decides whether that exact call may cross the boundary\./);
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

test("README claim: Seal holds one exact call and permits at most one execution", () => {
  const claim = "Seal holds each exact call, asks once, permits at most one execution, and writes a signed receipt.";
  const dir = mkdtempSync(join(tmpdir(), "seal-readme-claim-")); let output;
  assert.doesNotThrow(() => {
    output = execFileSync(process.execPath, [SEAL, "demo", "--dir", dir], {
      input: "y\n", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
  }, claim); // CLAIM-COVERAGE: README.md
  assert.match(output, /INPUT REQUIRED.*approval/s, claim);
  assert.match(output, /BLOCKED.*already_consumed/s, claim);
  assert.equal(readFileSync(join(dir, "child", "data.txt.count"), "utf8").trim(), "1", claim);
});

test("public proved-class claims fail and explicit denials pass", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "seal-public-proved-class-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const scope = join(dir, "scope.json");
  writeFileSync(scope, JSON.stringify({ pages: ["page.md"] }));
  const runGuard = (text) => {
    writeFileSync(join(dir, "page.md"), `${text}\n`);
    return spawnSync(process.execPath, [LANGUAGE_GUARD], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, SEAL_PUBLIC_PAGE_ROOT: dir, SEAL_PUBLIC_PAGE_SCOPE: scope },
    });
  };
  for (const claim of [
    "The decision rule is proved.",
    "The authorization rule is proven in Lean.",
    "The kernel is machine-checked.",
    "The seal-host kernel is proven, and so is this product's shipped authorization path.",
    "The policy-language model is machine-checked, and this product's shipped authorization path is proven.",
    "BudgetCore is proven, and Seal's shipped authorization rule is proved end to end.",
    "The V1 model is machine-checked, but this product's shipped decision path is proven.",
    "The seal-host policy is proved; Seal's shipped approval binding is machine-checked.",
  ]) {
    const red = runGuard(claim);
    assert.notEqual(red.status, 0, claim);
    assert.match(red.stderr, /unscoped proved-class claim/);
    console.log(`RED proved-class claim: ${claim}\nexit=${red.status}\nstdout=${red.stdout.trimEnd()}\nstderr=${red.stderr.trimEnd()}`);
  }
  for (const allowed of [
    "This Node CLI's authorization binding is TESTED, not PROVEN.",
    "The TCB is trusted, not proven.",
    "The policy-language apparatus uses one typed seam, and the seam's enumeration is machine-checked.",
  ]) {
    const green = runGuard(allowed);
    assert.equal(green.status, 0, green.stdout + green.stderr);
    console.log(`PASS proved-class control: ${allowed}\nexit=${green.status}\nstdout=${green.stdout.trimEnd()}\nstderr=${green.stderr.trimEnd()}`);
  }
});

test("launch truth gate compares the complete self-repository path", () => {
  const dir = mkdtempSync(join(tmpdir(), "seal-launch-truth-"));
  const required = [
    "README.md",
    ".github/workflows/ci.yml",
    "docs/assurance/evaluator-start.md",
    "docs/archive/WHY-DIFFERENT.md",
    "docs/assurance/index.html",
  ];
  const paths = required.map((name) => join(dir, name));
  for (const file of paths) {
    const relative = file.slice(dir.length + 1);
    const parent = file.slice(0, file.lastIndexOf("/"));
    if (parent !== dir) mkdirSync(parent, { recursive: true });
    writeFileSync(file, readFileSync(resolve(ROOT, relative)));
  }
  const run = (link) => {
    writeFileSync(paths[0], `${readFileSync(resolve(ROOT, "README.md"))}\n${link}\n`);
    return spawnSync(process.execPath, [TRUTH_GATE, ...paths], { encoding: "utf8" });
  };
  for (const link of [
    "https://github.com/velvetmonkey/seal",
    "https://github.com/velvetmonkey/seal.git/",
    "https://github.com/velvetmonkey/seal?tab=readme#top",
    "//github.com/velvetmonkey/seal.git",
    "git@github.com:velvetmonkey/seal.git",
    "https://github.com:443/velvetmonkey/seal.git",
  ]) assert.equal(run(link).status, 0, link);
  for (const link of [
    "https://github.com/extra/velvetmonkey/seal.git",
    "https://xn--githb-3we.com/velvetmonkey/seal.git",
    "https://github.com:444/velvetmonkey/seal.git",
    "https://github.com//velvetmonkey/seal",
    "https://github.com@evil.example/velvetmonkey/seal.git",
    "https://github.com/one/two/three/four/five/velvetmonkey/seal",
    "https://github.com/velvetmonkey/\nseal-unseen-sibling",
    "https://github.com:443@evil.example/velvetmonkey/seal.git",
    "https://github.com/velvetmonkey//seal.git",
    "https://github.com/velvetmonkey/seal.git/%2e%2e/seal-sapphire-reef.git",
    "https://github.com/velvetmonkey/seal.git%2Fextra",
  ]) assert.notEqual(run(link).status, 0, link);
  rmSync(dir, { recursive: true, force: true });
});

test("README installer check executes the command without restoring the installed-tree transcript", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "seal-frontdoor-installer-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const readmePath = join(dir, "README.md");
  const artifact = join(dir, "fixture-installer");
  const tree = "a".repeat(64);
  writeFileSync(readmePath, readFileSync(resolve(ROOT, "README.md"), "utf8"));
  writeFileSync(artifact, `#!/bin/sh\nprintf 'installed seal 0.2.0-rc.3 linux-x64\\nstore: %s/.local/lib/seal/store/${tree}\\ncommand: %s/.local/bin/seal\\ntree: ${tree}\\nNext:\\n  export PATH=%s/.local/bin:$PATH\\n  seal demo\\n' "$HOME" "$HOME" "$HOME"\n`, { mode: 0o755 });
  const env = {
    ...process.env,
    SEAL_INSTALL_TRANSCRIPT_README: readmePath,
    SEAL_INSTALL_TRANSCRIPT_ARTIFACT: artifact,
  };
  const green = spawnSync(process.execPath, [resolve(ROOT, "scripts/check-readme-install-transcript.cjs")], { cwd: ROOT, env, encoding: "utf8" });
  assert.equal(green.status, 0, green.stdout + green.stderr);
  assert.match(green.stdout, /installed-tree transcript stays off the front page/);

  writeFileSync(readmePath, `${readFileSync(readmePath, "utf8")}\n<!-- Seal installed-tree pin role: published-asset -->\n`);
  const red = spawnSync(process.execPath, [resolve(ROOT, "scripts/check-readme-install-transcript.cjs")], { cwd: ROOT, env, encoding: "utf8" });
  assert.equal(red.status, 1, red.stdout + red.stderr);
  assert.match(red.stderr, /must not carry an installed-tree transcript/);
});
