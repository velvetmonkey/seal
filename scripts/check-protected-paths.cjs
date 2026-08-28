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
]);
const PROTECTED_COMPONENTS = new Set(["fixture", "fixtures", "corpus", "pin", "pins"]);
// INJECTED integrity lock: keep a second, deliberately literal copy of the
// ten-entry contract so an accidental one-sided edit fails by name. It does not
// stop a single commit that edits both the operative list and this lock.
// The checker script is itself an exact protected path.
const LOCKED_EXACT_PATHS = new Set([
  "scripts/installed-tree-pin-sites.json",
  "docs/assurance/installed-tree-pin-control.md",
  ".github/workflows/ci.yml",
  "scripts/check-protected-paths.cjs",
  "scripts/resolve-ci-diff-range.cjs",
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

function readRulings(revision, allowLegacy) {
  const record = git(["show", `${revision}:${RULING_DOCUMENT}`]);
  if (record.status !== 0) return null;
  let document;
  try {
    document = JSON.parse(record.stdout);
  } catch {
    return { invalid: true };
  }
  if (Array.isArray(document?.rulings)) return { rulings: document.rulings };
  if (allowLegacy && document?.ruling && typeof document.ruling === "object") {
    return { rulings: [document.ruling], legacy: true };
  }
  return { legacy: true };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function duplicateBases(rulings) {
  const counts = new Map();
  for (const ruling of rulings) {
    if (ruling && typeof ruling.base === "string") counts.set(ruling.base, (counts.get(ruling.base) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([base]) => base).sort();
}

function rulingListIsIntact(mergeBase, head) {
  const headDocument = readRulings(head, false);
  if (!headDocument) return true;
  if (headDocument.legacy || headDocument.invalid) {
    process.stderr.write("PROTECTED_PATH_RULING_LEGACY_SHAPE: HEAD ruling document must use the rulings list shape.\n");
    return false;
  }
  const ambiguous = duplicateBases(headDocument.rulings);
  if (ambiguous.length) {
    process.stderr.write(`PROTECTED_PATH_RULING_AMBIGUOUS: duplicate base token(s): ${ambiguous.join(", ")}.\n`);
    return false;
  }
  const baseDocument = readRulings(mergeBase, true);
  if (!baseDocument) return true;
  if (baseDocument.invalid || !headDocument) {
    const dropped = baseDocument.invalid ? [] : baseDocument.rulings;
    for (const ruling of dropped) {
      process.stderr.write(`PROTECTED_PATH_RULING_DROPPED: base=${ruling?.base || ""} author=${ruling?.author || ""}.\n`);
    }
    return dropped.length === 0;
  }
  const headRecords = new Set(headDocument.rulings.map(canonicalJson));
  const dropped = baseDocument.rulings.filter((ruling) => !headRecords.has(canonicalJson(ruling)));
  if (!dropped.length) return true;
  for (const ruling of dropped) {
    process.stderr.write(`PROTECTED_PATH_RULING_DROPPED: base=${ruling?.base || ""} author=${ruling?.author || ""}.\n`);
  }
  return false;
}

function exactRuling(mergeBase, head, changedPaths) {
  const document = readRulings(head, false);
  if (!document || document.legacy || document.invalid) return null;
  const detail = document.rulings.find((ruling) => ruling?.base === mergeBase);
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
    const resolvedMergeBase = mergeBase.stdout.trim();
    if (!rulingListIsIntact(resolvedMergeBase, options.head)) {
      process.exitCode = 1;
    } else {
    // The net tree diff alone erases an add-then-delete sequence. Walk every
    // commit in the same target-branch range, diffing merges against every
    // parent, so neither a deletion nor a merge-only change disappears from
    // review.
    const changed = git(["log", "-m", "--format=", "--name-status", "-z", "--diff-filter=ACDMRTUXB", `${resolvedMergeBase}..${options.head}`, "--"]);
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
          const ruling = exactRuling(resolvedMergeBase, options.head, paths);
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
          process.stdout.write(`PROTECTED PATH REVIEW OK: no protected artifacts changed in ${resolvedMergeBase}...${options.head}.\n`);
        }
      }
    }
    }
  }
}
