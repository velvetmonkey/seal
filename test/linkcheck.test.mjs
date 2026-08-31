// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import tempRoot from "../scripts/temp-root.cjs";
const { testTmpdir } = tempRoot;

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/linkcheck.mjs");

const FAMILY = [
  ["seal-check", "master"],
  ["seal-demo", "main"],
  ["seal-live-demo", "master"],
  ["seal-verify-action", "main"],
  ["seal-assurance-kit", "main"],
  ["mcp-seal-dev", "main"],
];

function familyEnvironment() {
  const existing = FAMILY.every(([repo]) => existsSync(path.join(ROOT, ".family", repo)));
  if (existing) return { env: process.env, cleanup: () => {} };

  const family = path.join(ROOT, ".family");
  assert.equal(existsSync(family), false, "partial .family tree is a named prerequisite finding");
  mkdirSync(family);
  for (const [repo, branch] of FAMILY) {
    const clone = spawnSync("git", ["clone", "--depth", "1", "--branch", branch,
      `https://github.com/velvetmonkey/${repo}`, path.join(family, repo)], {
      cwd: ROOT, encoding: "utf8",
    });
    assert.equal(clone.status, 0, `${clone.stdout}${clone.stderr}`);
  }
  const env = { ...process.env };
  for (const [repo] of FAMILY) {
    env[`FAMILY_${repo.replaceAll("-", "_").toUpperCase()}_ROOT`] = path.join(family, repo);
  }
  return { env, cleanup: () => rmSync(family, { recursive: true, force: true }) };
}

function run(cwd = ROOT, env = process.env) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: "utf8",
    env,
  });
}

function walk(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(path.resolve(dir, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${name.name}` : name.name;
    const full = path.resolve(dir, relative);
    // Keep the separate population oracle aligned with the product rule:
    // an in-checkout system temporary directory is runtime state, not source.
    if (name.isDirectory() && name.name !== ".git" && full !== path.resolve(tmpdir())) out.push(...walk(dir, relative));
    else if (name.isFile()) out.push(relative);
  }
  return out;
}

// This separate-source cross-check does not use linkcheck's CommonMark walk. It
// masks Markdown code constructs, then scans the remaining source. Its
// overlapping discovery and extraction rules can share
// blind spots with the product checker. See docs/assurance/linkcheck-population-control.md.
function referenceMarkdownDestinations(text) {
  const visible = [];
  let fence = null;
  for (const line of text.split("\n")) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
    if (marker && !fence) {
      fence = marker[0];
      visible.push("");
      continue;
    }
    if (marker && fence === marker[0]) {
      fence = null;
      visible.push("");
      continue;
    }
    visible.push(fence || /^(?: {4}|\t)/u.test(line) ? "" : line);
  }
  const source = visible.join("\n").replace(/(`+)[\s\S]*?\1/gu, "");
  const destinations = [];
  const markdownLink = /!?\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))/gu;
  const htmlAttribute = /(?:^|\s)(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu;
  for (const match of source.matchAll(markdownLink)) destinations.push(match[1] ?? match[2] ?? "");
  for (const match of source.matchAll(htmlAttribute)) destinations.push(match[1] ?? match[2] ?? match[3] ?? "");
  return destinations;
}

function expectedTargets() {
  const targets = new Set();
  const files = [...new Set(["README.md", ...walk(ROOT).filter((f) => /\.(md|html)$/u.test(f) && !f.startsWith("node_modules/"))])];
  const htmlLink = /\]\(([^)]+)\)|(?:href|src)\s*=\s*"([^"]+)"/gu;
  const pathString = /(?:^|[\s"'`])((?:(?:\.{1,2}\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z][A-Za-z0-9_-]*)|(?:(?:README|index|EVALUATOR-START)\.(?:md|html)))(?:$|[\s"'`),:#?])/gmu;
  const strings = (value, out = []) => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) for (const item of value) strings(item, out);
    else if (value && typeof value === "object") for (const item of Object.values(value)) strings(item, out);
    return out;
  };
  for (const file of files) {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    const found = file.endsWith(".md")
      ? referenceMarkdownDestinations(text)
      : [...text.matchAll(htmlLink)].map((match) => match[1] ?? match[2] ?? "");
    for (const target of found) targets.add(target.trim());
  }
  const dataFiles = walk(ROOT).filter((f) =>
    f !== "scripts/mandatory-doc-claim-bindings.json"
      && (/^\.github\//u.test(f) || /^scripts\//u.test(f)) && /\.(json|ya?ml)$/iu.test(f),
  );
  for (const file of dataFiles) {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    const candidates = file.endsWith(".json") ? strings(JSON.parse(text)) : [text];
    for (const candidate of candidates) {
      for (const match of candidate.matchAll(pathString)) targets.add(match[1].trim());
    }
  }
  return [...targets].filter((target) =>
    target && !target.startsWith("#") && !target.startsWith("//") && !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target),
  ).sort();
}

test("clean CI family linkcheck exits 0 after checking every reference-parsed target [network required]", () => {
  const { env, cleanup } = familyEnvironment();
  try {
    const result = run(ROOT, { ...env, LINKCHECK_REPORT_SCANNED_TARGETS: "1" });
    const targetLine = result.stdout.split("\n").find((line) => line.startsWith("link-check-targets: "));
    assert.ok(targetLine, "link checker must report the targets that actually reached check()");
    const scanned = JSON.parse(targetLine.slice("link-check-targets: ".length)).sort();
    assert.deepEqual(scanned, expectedTargets(), "every reference-parsed live target must reach check()");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(
      result.stdout.split("\n").filter(Boolean).every((line) => /^(?:BROKEN|UNVERIFIED)  |^link-check-targets: |^link-check: /u.test(line)),
      "link checker stdout must contain only structured diagnostic and summary lines",
    );
    assert.match(
      result.stdout,
      /^link-check: \d+ internal links, \d+ external links, \d+ required live links, 0 unverified, 0 broken$/mu,
      "the checker must finish with no unverified or broken targets when every family root is present",
    );
  } finally {
    cleanup();
  }
});

test("path matcher stays tight around versions, digests, and ordinary prose", () => {
  const scratch = testTmpdir(path.join(tmpdir(), "seal-linkcheck-tight-"));
  try {
    const contents = [
      "version 0.2.0",
      "sha 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "we shipped 0.2.0.",
      "plain ordinary prose",
    ].join("\n");
    const source = readFileSync(SCRIPT, "utf8");
    const body = source.match(/const pathString = (\/.*\/gm);/s)?.[1];
    assert.ok(body, "pathString regex literal must be present");
    const pathString = Function(`return ${body};`)();
    assert.deepEqual([...contents.matchAll(pathString)].map((match) => match[1]), []);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("path matcher still catches stale filenames with unknown extensions", () => {
  const source = readFileSync(SCRIPT, "utf8");
  const body = source.match(/const pathString = (\/.*\/gm);/s)?.[1];
  assert.ok(body, "pathString regex literal must be present");
  const pathString = Function(`return ${body};`)();
  assert.deepEqual(
    [..."docs/assurance/RELEASE-NOTES-v0.2.0-rc.2.txt".matchAll(pathString)].map((match) => match[1]),
    ["docs/assurance/RELEASE-NOTES-v0.2.0-rc.2.txt"],
  );
});
