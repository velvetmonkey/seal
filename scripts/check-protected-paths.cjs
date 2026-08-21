#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Refuse a merge-range edit to an assurance artifact until a human has ruled.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = process.env.SEAL_PROTECTED_PATHS_ROOT || path.join(__dirname, "..");
const CONTROL_DOCUMENT = "docs/INSTALLED-TREE-PIN-CONTROL.md";
const PIN_MANIFEST = "scripts/installed-tree-pin-sites.json";
const RULING_DOCUMENT = "docs/PROTECTED-PATH-RULINGS.json";
const INVOKING_WORKFLOW = ".github/workflows/ci.yml";
const PROTECTED_COMPONENTS = new Set(["fixture", "fixtures", "corpus", "pin", "pins"]);

function usage() {
  process.stderr.write("usage: node scripts/check-protected-paths.cjs --base <rev> --head <rev>\n");
  process.exitCode = 2;
}

function protectedArtifact(relativePath) {
  const normalized = relativePath.replaceAll("\\\\", "/").replace(/^\.\//, "");
  if (normalized === PIN_MANIFEST || normalized === CONTROL_DOCUMENT || normalized === INVOKING_WORKFLOW || normalized === "scripts/check-protected-paths.cjs" || normalized === "scripts/resolve-ci-diff-range.cjs") return true;
  const components = normalized.toLowerCase().split("/").filter(Boolean);
  const basename = components.at(-1) || "";
  return components.some((component) => PROTECTED_COMPONENTS.has(component))
    || /(?:^|[._-])pins?(?:[._-]|$)/.test(basename)
    || basename.endsWith(".wasm");
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
  if (!detail || detail.base !== mergeBase || typeof detail.protectedCommit !== "string"
    || !Array.isArray(detail.paths) || detail.paths.length === 0
    || new Set(detail.paths).size !== detail.paths.length
    || detail.paths.some((value) => typeof value !== "string" || !protectedArtifact(value))) return null;

  const currentParents = git(["rev-list", "--parents", "-n", "1", head]);
  const parentFields = currentParents.stdout.trim().split(/\s+/);
  if (currentParents.status !== 0 || parentFields.length !== 2 || parentFields[1] !== detail.protectedCommit) return null;

  const target = git(["rev-parse", "--verify", `${detail.protectedCommit}^{commit}`]);
  if (target.status !== 0 || target.stdout.trim() !== detail.protectedCommit) return null;
  const targetChanged = git(["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${mergeBase}...${detail.protectedCommit}`, "--"]);
  if (targetChanged.status !== 0) return null;
  const expected = targetChanged.stdout.split(/\r?\n/).filter(Boolean).filter(protectedArtifact).sort();
  const recorded = [...detail.paths].sort();
  if (expected.length !== recorded.length || expected.some((value, index) => value !== recorded[index])) return null;
  const actual = [...changedPaths].sort();
  if (actual.length !== recorded.length || actual.some((value, index) => value !== recorded[index])) return null;
  return detail;
}

const options = parseArgs(process.argv.slice(2));
if (!options) {
  usage();
} else {
  const mergeBase = git(["merge-base", options.base, options.head]);
  if (mergeBase.status !== 0) {
    process.stderr.write(`PROTECTED_PATH_DIFF_UNREADABLE: cannot find merge base for ${options.base} and ${options.head}.\n${mergeBase.stderr}`);
    process.exitCode = 1;
  } else {
    const changed = git(["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${mergeBase.stdout.trim()}...${options.head}`, "--"]);
    if (changed.status !== 0) {
      process.stderr.write(`PROTECTED_PATH_DIFF_UNREADABLE: cannot read merge range.\n${changed.stderr}`);
      process.exitCode = 1;
    } else {
      const paths = changed.stdout.split(/\r?\n/).filter(Boolean).filter(protectedArtifact);
      if (paths.length) {
        const ruling = exactRuling(mergeBase.stdout.trim(), options.head, paths);
        if (ruling) {
          process.stdout.write(`PROTECTED PATH REVIEW OK: recorded human ruling for protected commit ${ruling.protectedCommit}: ${ruling.paths.join(", ")}.\n`);
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
