// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

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

test("clean CI family linkcheck exits 0 without reducing its scanned population [network required]", () => {
  const { env, cleanup } = familyEnvironment();
  try {
    const result = run(ROOT, env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /link-check: 417 internal links, 50 external links, 1 required live links, 0 broken/);
    assert.doesNotMatch(result.stdout, /P-\[A-Z\]\+/);
  } finally {
    cleanup();
  }
});

test("path matcher stays tight around versions, digests, and ordinary prose", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "seal-linkcheck-tight-"));
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

test("link checker does not parse a regular expression in an inline code span as a Markdown link", () => {
  const source = readFileSync(SCRIPT, "utf8");
  const body = source.match(/function maskMarkdownCode\(text\) \{[\s\S]*?\n\}(?=\n\n\/\/)/)?.[0];
  assert.ok(body, "code-span masker must be present");
  const maskMarkdownCode = Function(`${body}; return maskMarkdownCode;`)();
  const links = /\]\(([^)]+)\)/g;
  const fixture = "Extraction regex: `/VERIFY_PROFILE[^\"']*[\"'](P-[A-Z]+)[\"']/`.";
  assert.deepEqual([...maskMarkdownCode(fixture).matchAll(links)], []);
});
