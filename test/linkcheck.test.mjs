// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { markdownDestinations, populationChanges, populationDecision } from "../scripts/linkcheck.mjs";
import expectedPopulation from "./support/linkcheck-population.mjs";

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

test("clean CI family linkcheck exits 0 without reducing its scanned population [network required]", () => {
  const { env, cleanup } = familyEnvironment();
  try {
    const result = run(ROOT, { ...env, LINKCHECK_REPORT_SCANNED_TARGETS: "1" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const targetLine = result.stdout.split("\n").find((line) => line.startsWith("link-check-targets: "));
    assert.ok(targetLine, "link checker must report the targets that actually reached check()");
    const scanned = JSON.parse(targetLine.slice("link-check-targets: ".length)).sort();
    assert.deepEqual(scanned, expectedTargets(), "every reference-parsed live target must reach check()");
    assert.match(result.stdout, new RegExp(`link-check: ${expectedPopulation.internalOccurrences} internal links, ${expectedPopulation.externalOccurrences} external links, 1 required live links, 0 broken`));
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

test("population changes and high-water decisions stay explicit without running the generator", () => {
  const mixed = populationChanges(
    { internalOccurrences: 407, externalOccurrences: 50 },
    { internalOccurrences: 406, externalOccurrences: 51 },
  );
  const equal = populationChanges(
    { internalOccurrences: 407, externalOccurrences: 50 },
    { internalOccurrences: 407, externalOccurrences: 50 },
  );
  const recorded = {
    internalOccurrences: 2,
    externalOccurrences: 50,
    internalOccurrencesHighWaterMark: 2,
    externalOccurrencesHighWaterMark: 50,
    fileOccurrences: { "page.md": { internalOccurrences: 2, externalOccurrences: 0 } },
    fileOccurrencesHighWaterMarks: { "page.md": { internalOccurrences: 2, externalOccurrences: 0 } },
    shrinkHistory: [],
  };
  const accepted = populationDecision(recorded, {
    internalOccurrences: 1,
    externalOccurrences: 50,
    fileOccurrences: { "page.md": { internalOccurrences: 1, externalOccurrences: 0 } },
  }, { allowShrinkFiles: ["page.md"], date: "2026-08-24" });
  const sequential = populationDecision(accepted.population, {
    internalOccurrences: 1,
    externalOccurrences: 50,
    fileOccurrences: { "page.md": { internalOccurrences: 1, externalOccurrences: 0 } },
  });
  assert(
    JSON.stringify(mixed) === JSON.stringify([
      { key: "internalOccurrences", oldCount: 407, newCount: 406, difference: -1 },
      { key: "externalOccurrences", oldCount: 50, newCount: 51, difference: 1 },
    ])
      && equal.every(({ difference }) => difference === 0)
      && JSON.stringify(accepted.population) === JSON.stringify({
        internalOccurrences: 1,
        externalOccurrences: 50,
        fileOccurrences: { "page.md": { internalOccurrences: 1, externalOccurrences: 0 } },
        internalOccurrencesHighWaterMark: 2,
        externalOccurrencesHighWaterMark: 50,
        fileOccurrencesHighWaterMarks: { "page.md": { internalOccurrences: 2, externalOccurrences: 0 } },
        shrinkHistory: [{
          date: "2026-08-24",
          oldCounts: { internalOccurrences: 2, externalOccurrences: 50 },
          newCounts: { internalOccurrences: 1, externalOccurrences: 50 },
        }],
      })
      && sequential.population === null
      && JSON.stringify(sequential.shrinks) === JSON.stringify([{
        file: "page.md",
        key: "internalOccurrences",
        oldCount: 2,
        newCount: 1,
        difference: -1,
      }]),
    "the one union rule must retain a named shrink floor and refuse a later unflagged lowered write",
  );
});

test("a compensated cross-file swap is refused by per-file population counts", () => {
  const oldPopulation = {
    internalOccurrences: 407,
    externalOccurrences: 50,
    internalOccurrencesHighWaterMark: 407,
    externalOccurrencesHighWaterMark: 50,
    fileOccurrences: {
      "docs/assurance/README.md": { internalOccurrences: 1, externalOccurrences: 0 },
      "README.md": { internalOccurrences: 0, externalOccurrences: 0 },
    },
    fileOccurrencesHighWaterMarks: {
      "docs/assurance/README.md": { internalOccurrences: 1, externalOccurrences: 0 },
      "README.md": { internalOccurrences: 0, externalOccurrences: 0 },
    },
    shrinkHistory: [],
  };
  const decision = populationDecision(oldPopulation, {
    internalOccurrences: 407,
    externalOccurrences: 50,
    fileOccurrences: {
      "docs/assurance/README.md": { internalOccurrences: 0, externalOccurrences: 0 },
      "README.md": { internalOccurrences: 1, externalOccurrences: 0 },
    },
  });
  assert.equal(decision.population, null);
  assert.deepEqual(decision.shrinks, [{
    file: "docs/assurance/README.md",
    key: "internalOccurrences",
    oldCount: 1,
    newCount: 0,
    difference: -1,
  }]);
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

test("raw HTML block and inline src/href attributes become linkcheck destinations", () => {
  const fixture = [
    '<p><img src="assets/seal-logo.png"><a href="docs/guide/README.md">guide</a></p>',
    '',
    'Inline <img src=assets/seal-flow.svg> and <a href=docs/start/install.md>install</a>.',
    '',
    '<img src="https://example.test/logo.png"><a href="mailto:test@example.test">mail</a>',
  ].join("\n");
  assert.deepEqual(markdownDestinations(fixture), [
    "assets/seal-logo.png",
    "docs/guide/README.md",
    "assets/seal-flow.svg",
    "docs/start/install.md",
    "https://example.test/logo.png",
    "mailto:test@example.test",
  ]);
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
