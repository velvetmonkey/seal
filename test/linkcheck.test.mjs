// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { markdownDestinations } from "../scripts/linkcheck.mjs";

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
    if (name.isDirectory() && name.name !== ".git") out.push(...walk(dir, relative));
    else if (name.isFile()) out.push(relative);
  }
  return out;
}

function expectedTargets() {
  const targets = new Set();
  const files = ["README.md", ...walk(ROOT).filter((f) => /\.(md|html)$/.test(f) && !f.startsWith("node_modules/"))];
  const htmlLink = /\]\(([^)]+)\)|(?:href|src)\s*=\s*"([^"]+)"/g;
  const pathString = /(?:^|[\s"'`])((?:(?:\.{1,2}\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z][A-Za-z0-9_-]*)|(?:(?:README|index|EVALUATOR-START)\.(?:md|html)))(?:$|[\s"'`),:#?])/gm;
  const strings = (value, out = []) => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) for (const item of value) strings(item, out);
    else if (value && typeof value === "object") for (const item of Object.values(value)) strings(item, out);
    return out;
  };
  for (const f of files) {
    const txt = readFileSync(path.join(ROOT, f), "utf8");
    if (f.endsWith(".md")) {
      for (const target of markdownDestinations(txt)) targets.add(target.trim());
    } else {
      for (const match of txt.matchAll(htmlLink)) targets.add((match[1] || match[2] || "").trim());
    }
  }
  const dataFiles = walk(ROOT).filter((f) =>
    (/^\.github\//.test(f) || /^scripts\//.test(f)) && /\.(json|ya?ml)$/i.test(f),
  );
  for (const f of dataFiles) {
    const text = readFileSync(path.join(ROOT, f), "utf8");
    const candidates = f.endsWith(".json") ? strings(JSON.parse(text)) : [text];
    for (const candidate of candidates) {
      for (const match of candidate.matchAll(pathString)) targets.add(match[1].trim());
    }
  }
  return [...targets].filter((target) =>
    target && !target.startsWith("http") && !target.startsWith("#") && !target.startsWith("mailto:"),
  ).sort();
}

test("clean CI family linkcheck exits 0 without reducing its scanned population [network required]", () => {
  const { env, cleanup } = familyEnvironment();
  try {
    const result = run(ROOT, { ...env, LINKCHECK_REPORT_SCANNED_TARGETS: "1" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const targetLine = result.stdout.split("\n").find((line) => line.startsWith("link-check-targets: "));
    assert.ok(targetLine, "link checker must report the targets that actually reached check()");
    const scanned = JSON.parse(targetLine.slice("link-check-targets: ".length)).sort();
    assert.deepEqual(scanned, expectedTargets(), "every parsed live target must reach check()");
    assert.match(result.stdout, /link-check: 414 internal links, 50 external links, 1 required live links, 0 broken/);
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

test("CommonMark parser does not expose link-looking text in inline code spans", () => {
  const fixture = "Extraction regex: `/VERIFY_PROFILE[^\"']*[\"'](P-[A-Z]+)[\"']/`.";
  assert.deepEqual(markdownDestinations(fixture), []);
});

test("escaped backticks remain prose and do not hide real Markdown links", () => {
  const fixture = "Write \\`[ghost](escaped-not-code.md)\\` then [install](docs/start/install.md)";
  assert.deepEqual(
    markdownDestinations(fixture),
    ["escaped-not-code.md", "docs/start/install.md"],
  );
});

test("CommonMark parser handles code span, fence, indented code, and HTML block boundaries", () => {
  const cases = [
    {
      name: "indented-code-block",
      markdown: "    [ghost](indent-ghost.md)\n\n[keep](docs/start/install.md)\n",
      links: ["docs/start/install.md"],
    },
    {
      name: "html-block-pre",
      markdown: "<pre>\n[ghost](html-ghost.md)\n</pre>\n\n[keep](docs/start/install.md)\n",
      links: ["docs/start/install.md"],
    },
    {
      name: "code-span-spanning-line-break",
      markdown: "`[ghost](break-ghost.md)\ncontinues`\n\n[keep](docs/start/install.md)\n",
      links: ["docs/start/install.md"],
    },
    {
      name: "one-line-triple-backtick-span-then-real-link",
      markdown: "```not-a-fence```\n\n[keep](docs/start/install.md)\n",
      links: ["docs/start/install.md"],
    },
    {
      name: "one-line-triple-backtick-span-adjacent-real-link",
      markdown: "```not-a-fence```\n[keep](docs/start/install.md)\n",
      links: ["docs/start/install.md"],
    },
    {
      name: "info-string-contains-backticks-then-later-fence",
      markdown: "```not-a-fence```\n[keep](docs/start/install.md)\n\n```js\n[ghost](fence-ghost.md)\n```\n\n[guide](docs/guide/README.md)\n",
      links: ["docs/start/install.md", "docs/guide/README.md"],
    },
  ];

  for (const item of cases) {
    assert.deepEqual(markdownDestinations(item.markdown), item.links, item.name);
  }
});
