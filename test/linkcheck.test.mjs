// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  const privateFamily = testTmpdir("seal-linkcheck-family-");
  const cleanup = () => rmSync(privateFamily, { recursive: true, force: true });
  try {
    for (const [repo, branch] of FAMILY) {
      const clone = spawnSync("git", ["clone", "--depth", "1", "--branch", branch,
        `https://github.com/velvetmonkey/${repo}`, path.join(privateFamily, repo)], {
        cwd: ROOT, encoding: "utf8",
      });
      assert.equal(clone.status, 0, `${clone.stdout}${clone.stderr}`);
    }
    const env = { ...process.env };
    for (const [repo] of FAMILY) {
      env[`FAMILY_${repo.replaceAll("-", "_").toUpperCase()}_ROOT`] = path.join(privateFamily, repo);
    }
    return { env, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
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

// The fixture's filesystem is the existence oracle, independent of both the
// checker's scanned-target report and its checked-target bookkeeping.
test("missing local target is independently absent and reported broken", () => {
  const scratch = testTmpdir("seal-linkcheck-missing-");
  try {
    const clone = spawnSync("git", ["clone", "--shared", ROOT, scratch], { encoding: "utf8" });
    assert.equal(clone.status, 0, clone.stdout + clone.stderr);
    // Exercise the working checker, including any uncommitted fault injection.
    copyFileSync(SCRIPT, path.join(scratch, "scripts/linkcheck.mjs"));
    const missing = "linkguardran-does-not-exist.md";
    assert.equal(existsSync(path.join(scratch, missing)), false, "missing target must be absent outside the checker");
    appendFileSync(path.join(scratch, "README.md"), `\n[Missing target](${missing})\n`);
    const result = spawnSync(process.execPath, [path.join(scratch, "scripts/linkcheck.mjs")], {
      cwd: scratch, encoding: "utf8", env: process.env,
    });
    assert.equal(result.status, 1, "missing target must make the link checker fail: " + result.stdout + result.stderr);
    assert.match(result.stdout, /^BROKEN  README\.md -> linkguardran-does-not-exist\.md$/mu,
      "known missing target must have its own BROKEN diagnostic");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("required Node download link is checked on its carrier page", () => {
  const scratch = testTmpdir("seal-linkcheck-node-carrier-");
  try {
    const clone = spawnSync("git", ["clone", "--shared", ROOT, scratch], { encoding: "utf8" });
    assert(clone.status === 0, clone.stdout + clone.stderr);
    const baseline = spawnSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], {
      cwd: scratch, encoding: "utf8",
    });
    assert(baseline.status === 0, baseline.stdout + baseline.stderr);
    // Exercise the working checker, including any uncommitted fault injection.
    copyFileSync(SCRIPT, path.join(scratch, "scripts/linkcheck.mjs"));
    const carrier = path.join(scratch, "docs/start/install.md");
    writeFileSync(carrier, readFileSync(carrier, "utf8").replace("https://nodejs.org/en/download", ""));
    const result = spawnSync(process.execPath, [path.join(scratch, "scripts/linkcheck.mjs")], {
      cwd: scratch, encoding: "utf8", env: process.env,
    });
    assert(result.status === 1, "missing Node download link must make the link checker fail: " + result.stdout + result.stderr);
    assert(result.stdout.includes("BROKEN  docs/start/install.md -> missing required live link https://nodejs.org/en/download"),
      "Node carrier missing link must have its own BROKEN diagnostic");
    assert(/^link-check: .* 2 required live links, .*$/mu.test(result.stdout),
      "Node carrier failure must report 2 required live links");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

function carrierCloneWithFetchStub(scratch) {
  const clone = spawnSync("git", ["clone", "--shared", ROOT, scratch], { encoding: "utf8" });
  assert(clone.status === 0, "carrier stub clone must succeed: " + clone.stdout + clone.stderr);
  const baseline = spawnSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], {
    cwd: scratch, encoding: "utf8",
  });
  assert(baseline.status === 0, "carrier stub origin/main ref must update: " + baseline.stdout + baseline.stderr);
  copyFileSync(SCRIPT, path.join(scratch, "scripts/linkcheck.mjs"));
  const log = path.join(scratch, "fetch.log");
  const preload = path.join(scratch, "fetch-stub.cjs");
  writeFileSync(preload, `const { appendFileSync } = require("node:fs");
globalThis.fetch = async (url) => {
  appendFileSync(process.env.SEAL_LINK_LOG, String(url) + "\\n");
  const good = url === "https://nodejs.org/en/download" || url === "https://velvetmonkey.github.io/seal-check/";
  return new Response(null, { status: good ? 200 : 404 });
};
`);
  return { log, preload };
}

function runCarrierStub(scratch, preload, log) {
  return spawnSync(process.execPath, ["--require", preload, path.join(scratch, "scripts/linkcheck.mjs")], {
    cwd: scratch, encoding: "utf8", env: { ...process.env, SEAL_LINK_LOG: log },
  });
}

test("prefix-extended Node URL on its carrier page is reported broken", () => {
  const scratch = testTmpdir("seal-linkcheck-node-prefix-");
  try {
    const { log, preload } = carrierCloneWithFetchStub(scratch);
    const carrier = path.join(scratch, "docs/start/install.md");
    writeFileSync(carrier, readFileSync(carrier, "utf8").replace(
      "https://nodejs.org/en/download ", "https://nodejs.org/en/download-gone "));
    const result = runCarrierStub(scratch, preload, log);
    assert(result.status === 1, "prefix Node URL must make the checker fail: " + result.stdout + result.stderr);
    assert(result.stdout.includes("BROKEN  docs/start/install.md -> required live link https://nodejs.org/en/download-gone differs from https://nodejs.org/en/download"),
      "prefix Node URL must name the carrier mismatch");
    assert(result.stdout.includes("BROKEN  https://nodejs.org/en/download-gone -> HTTP 404"),
      "prefix Node URL must show its fetch failure");
    assert(readFileSync(log, "utf8").split("\n").includes("https://nodejs.org/en/download-gone"),
      "prefix Node URL must be fetched");
    assert(!readFileSync(log, "utf8").split("\n").includes("https://nodejs.org/en/download"),
      "prefix Node URL must not fetch the map URL");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("a second Node URL on its carrier page that differs from the map is reported broken", () => {
  const scratch = testTmpdir("seal-linkcheck-node-second-");
  try {
    const { log, preload } = carrierCloneWithFetchStub(scratch);
    appendFileSync(path.join(scratch, "docs/start/install.md"), "\nSee also https://nodejs.org/en/download-gone.\n");
    const result = runCarrierStub(scratch, preload, log);
    assert(result.status === 1, "second Node URL must make the checker fail: " + result.stdout + result.stderr);
    assert(result.stdout.includes("BROKEN  docs/start/install.md -> required live link https://nodejs.org/en/download-gone differs from https://nodejs.org/en/download"),
      "second Node URL must name the carrier mismatch");
    assert(result.stdout.includes("BROKEN  https://nodejs.org/en/download-gone -> HTTP 404"),
      "second Node URL must show its fetch failure");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("required live links are fetched as their carrier pages show them", () => {
  const scratch = testTmpdir("seal-linkcheck-carrier-fetch-");
  try {
    const { log, preload } = carrierCloneWithFetchStub(scratch);
    const result = runCarrierStub(scratch, preload, log);
    assert(result.status === 0, "unchanged carrier URLs must pass: " + result.stdout + result.stderr);
    assert(result.stdout.includes("0 broken"), "unchanged carrier URLs must report zero broken");
    assert(result.stdout.includes("2 required live links"), "unchanged carrier URLs must report two required live links");
    assert(JSON.stringify([...new Set(readFileSync(log, "utf8").trim().split("\n"))].sort()) ===
      JSON.stringify(["https://nodejs.org/en/download", "https://velvetmonkey.github.io/seal-check/"]),
      "unchanged carrier URLs must be the exact fetched set");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

const renderedCarrierCases = [
  ["C1 comment split", (text) => text.replace("https://nodejs.org/en/download ", "https://nodejs.org/en/download<!-- -->-gone "), "required live link https://nodejs.org/en/download-gone differs"],
  ["C2 decimal entity", (text) => text + "\nSee also https&#58;//nodejs.org/en/download-gone.\n", "required live link https://nodejs.org/en/download-gone differs"],
  ["C3 hex entity", (text) => text + "\nSee also https&#x3a;//nodejs.org/en/download-gone.\n", "required live link https://nodejs.org/en/download-gone differs"],
  ["C4 named entity", (text) => text + "\nSee also https&colon;//nodejs.org/en/download-gone.\n", "required live link https://nodejs.org/en/download-gone differs"],
  ["C5 unclosed comment", (text) => text.replace("https://nodejs.org/en/download ", "https://nodejs.org/en/dowload ") + "\n<!-- https://nodejs.org/en/download\n", "missing required live link https://nodejs.org/en/download"],
  ["C6 hidden exact token", (text) => text.replace("https://nodejs.org/en/download ", "https://nodejs.org/en/dowload ") + "\n<!-- https://nodejs.org/en/download -->\n", "missing required live link https://nodejs.org/en/download"],
];

for (const [name, plant, diagnostic] of renderedCarrierCases) {
  test(`${name} is red on the rendered carrier`, () => {
    const scratch = testTmpdir("seal-linkcheck-rendered-carrier-");
    try {
      const { log, preload } = carrierCloneWithFetchStub(scratch);
      const carrier = path.join(scratch, "docs/start/install.md");
      writeFileSync(carrier, plant(readFileSync(carrier, "utf8")));
      const result = runCarrierStub(scratch, preload, log);
      assert(result.status === 1, `${name} must fail: ${result.stdout}${result.stderr}`);
      assert(result.stdout.includes(diagnostic), `${name} must report ${diagnostic}: ${result.stdout}`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
}
