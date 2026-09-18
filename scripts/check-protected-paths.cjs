#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Refuse a target-branch candidate-range edit to an assurance artifact until a human has ruled.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = process.env.SEAL_PROTECTED_PATHS_ROOT || path.join(__dirname, "..");
const CONTROL_DOCUMENT = "docs/assurance/installed-tree-pin-control.md";
const PIN_MANIFEST = "scripts/installed-tree-pin-sites.json";
const RULING_DOCUMENT = "docs/PROTECTED-PATH-RULINGS.json";
const INVOKING_WORKFLOW = ".github/workflows/ci.yml";
const PROTECTED_EXACT_PATHS = new Set([
  PIN_MANIFEST,
  CONTROL_DOCUMENT,
  INVOKING_WORKFLOW,
  "scripts/check-protected-paths.cjs",
  "scripts/resolve-ci-diff-range.cjs",
  "scripts/critical-property-manifest.tsv",
]);
const PROTECTED_COMPONENTS = new Set(["fixture", "fixtures", "corpus", "pin", "pins"]);
// INJECTED integrity lock: keep a second, deliberately literal copy of the
// eleven-entry contract so an accidental one-sided edit fails by name. It does not
// stop a single commit that edits both the operative list and this lock.
// The checker script is itself an exact protected path.
const LOCKED_EXACT_PATHS = new Set([
  "scripts/installed-tree-pin-sites.json",
  "docs/assurance/installed-tree-pin-control.md",
  ".github/workflows/ci.yml",
  "scripts/check-protected-paths.cjs",
  "scripts/resolve-ci-diff-range.cjs",
  "scripts/critical-property-manifest.tsv",
]);
const LOCKED_COMPONENTS = new Set(["fixture", "fixtures", "corpus", "pin", "pins"]);

function usage() {
  process.stderr.write("usage: node scripts/check-protected-paths.cjs --base <rev> --head <rev>\n");
  process.exitCode = 2;
}

function protectedArtifact(relativePath) {
  const normalized = relativePath.replaceAll("\\\\", "/").replace(/^\.\//, "");
  if (PROTECTED_EXACT_PATHS.has(normalized)) return true;
  const components = normalized.toLowerCase().split("/").filter(Boolean);
  const basename = components.at(-1) || "";
  return components.some((component) => PROTECTED_COMPONENTS.has(component))
    || /(?:^|[._-])pins?(?:[._-]|$)/.test(basename)
    || basename.endsWith(".wasm");
}

function listDifference(left, right) {
  return [...left].filter((entry) => !right.has(entry)).sort();
}

function protectedListIsIntact() {
  const missing = [
    ...listDifference(LOCKED_EXACT_PATHS, PROTECTED_EXACT_PATHS),
    ...listDifference(LOCKED_COMPONENTS, PROTECTED_COMPONENTS),
  ];
  const unexpected = [
    ...listDifference(PROTECTED_EXACT_PATHS, LOCKED_EXACT_PATHS),
    ...listDifference(PROTECTED_COMPONENTS, LOCKED_COMPONENTS),
  ];
  if (missing.length === 0 && unexpected.length === 0) return true;
  process.stderr.write(`PROTECTED_PATH_LIST_TAMPERED: missing [${missing.join(", ")}]; unexpected [${unexpected.join(", ")}].\n`);
  process.exitCode = 1;
  return false;
}

function parseNameStatus(output) {
  const fields = output.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const paths = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!/^[ACDMRTUXB][0-9]*$/.test(status)) return null;
    const pathCount = /^[RC]/.test(status) ? 2 : 1;
    if (index + pathCount > fields.length) return null;
    for (let offset = 0; offset < pathCount; offset += 1) paths.push(fields[index++]);
  }
  return paths;
}

function parseArgs(argv) {
  const options = { base: "", head: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--base") options.base = argv[++index] || "";
    else if (value === "--head") options.head = argv[++index] || "";
    else return null;
  }
  return options.base && options.head ? options : null;
}

function git(args) {
  return spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8" });
}

// Enumerate explicitly: log must not walk back into already-reviewed base history.
function topicChanges(base, head) {
  const commits = git(["rev-list", "--parents", head, "--not", base, "--"]);
  if (commits.status !== 0) return commits;
  const outputs = [];
  for (const line of commits.stdout.trim().split("\n").filter(Boolean)) {
    const [commit, ...parents] = line.split(" ");
    const changed = git(["log", "-m", "--no-walk", "--format=", "--name-status", "-z", "--diff-filter=ACDMRTUXB", commit, "--"]);
    if (changed.status !== 0) return changed;
    if (parents.length < 2) {
      // Keep every ordinary commit, including edits later reverted on the topic.
      outputs.push(changed.stdout);
      continue;
    }
    // A unique catch-up merge's -m output also contains main's imported edits.
    // Compare this merge to the base history it has incorporated, not today's
    // base tree (which may have advanced again). Keep merge-only changes even
    // when a later topic commit reverts them.
    const incorporated = git(["merge-base", base, commit]);
    if (incorporated.status !== 0) return incorporated;
    const own = git(["diff", "--name-status", "-z", "--diff-filter=ACDMRTUXB", incorporated.stdout.trim(), commit, "--"]);
    if (own.status !== 0) return own;
    const changedPaths = parseNameStatus(changed.stdout);
    const ownPaths = parseNameStatus(own.stdout);
    if (!changedPaths || !ownPaths) return { status: 1, stderr: "malformed name-status output.\n" };
    const ownSet = new Set(ownPaths);
    // Paths, including both rename endpoints, are what the policy reviews.
    for (const file of changedPaths) {
      if (ownSet.has(file)) outputs.push(`M\0${file}\0`);
    }
  }
  return { status: 0, stdout: outputs.join(""), stderr: "" };
}

// CLAIM-COVERAGE: docs/PROTECTED-PATH-RULINGS.json
function exactRuling(mergeBase, head, changedPaths) {
  const record = git(["show", `${head}:${RULING_DOCUMENT}`]);
  if (record.status !== 0) return null;
  let ruling;
  try {
    ruling = JSON.parse(record.stdout);
  } catch {
    return null;
  }
  const detail = ruling?.ruling;
  if (!detail || detail.base !== mergeBase || !Array.isArray(detail.files) || detail.files.length === 0) return null;
  const recorded = detail.files.map((file) => file?.path).sort();
  if (new Set(recorded).size !== recorded.length
    || detail.files.some((file) => !file || typeof file.path !== "string"
      || typeof file.blob !== "string" || !/^[0-9a-f]{40}$/.test(file.blob)
      || !protectedArtifact(file.path))) return null;
  const actual = [...changedPaths].sort();
  if (actual.length !== recorded.length || actual.some((value, index) => value !== recorded[index])) return null;
  for (const file of detail.files) {
    const actualBlob = git(["rev-parse", "--verify", `${head}:${file.path}`]);
    if (actualBlob.status !== 0 || actualBlob.stdout.trim() !== file.blob) return null;
  }
  return detail;
}

const options = parseArgs(process.argv.slice(2));
if (!protectedListIsIntact()) {
  // The integrity diagnostic above is the finding.
} else if (!options) {
  usage();
} else {
  const mergeBase = git(["merge-base", options.base, options.head]);
  if (mergeBase.status !== 0) {
    process.stderr.write(`PROTECTED_PATH_DIFF_UNREADABLE: cannot find merge base for ${options.base} and ${options.head}.\n${mergeBase.stderr}`);
    process.exitCode = 1;
  } else {
    // A net head diff erases edit-then-revert attacks. Inspect each unique
    // topic commit, retaining -m merge evidence without charging imported main.
    const changed = topicChanges(options.base, options.head);
    if (changed.status !== 0) {
      process.stderr.write(`PROTECTED_PATH_DIFF_UNREADABLE: cannot read merge range.\n${changed.stderr}`);
      process.exitCode = 1;
    } else {
      const changedPaths = parseNameStatus(changed.stdout);
      if (!changedPaths) {
        process.stderr.write("PROTECTED_PATH_DIFF_UNREADABLE: malformed name-status output.\n");
        process.exitCode = 1;
      } else {
        const paths = [...new Set(changedPaths.filter(protectedArtifact))];
        if (paths.length) {
          const ruling = exactRuling(mergeBase.stdout.trim(), options.head, paths);
          if (ruling) {
            process.stdout.write(`PROTECTED PATH REVIEW OK: recorded human ruling for ${ruling.base}: ${ruling.files.map((file) => file.path).join(", ")}.\n`);
          } else {
            for (const protectedPath of paths) {
              process.stderr.write(`::error file=${protectedPath}::HUMAN RULING REQUIRED: protected artifact changed: ${protectedPath}\n`);
            }
            process.stderr.write("PROTECTED PATH REVIEW REQUIRED: a human ruling is required before this change can merge.\n");
            process.exitCode = 1;
          }
        } else {
          process.stdout.write(`PROTECTED PATH REVIEW OK: no protected artifacts changed in ${mergeBase.stdout.trim()}...${options.head}.\n`);
        }
      }
    }
  }
}
