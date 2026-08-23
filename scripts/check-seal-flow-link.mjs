// SPDX-License-Identifier: Apache-2.0
// The README process-diagram wrapper must name this tree's docs/seal-flow.svg.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL = "docs/seal-flow.svg";
const README = process.env.SEAL_FLOW_LINK_README || resolve(ROOT, "README.md");
const SVG = process.env.SEAL_FLOW_LINK_SVG || resolve(ROOT, CANONICAL);

function fail(code, message) {
  console.error(`FAIL  ${code}: ${message}`);
  process.exit(1);
}

function readReadme(path) {
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    if (error.code === "ENOENT") fail("diagram_readme_absent", `README is absent: ${path}`);
    fail("diagram_readme_unreadable", `README is unreadable: ${path}: ${error.message}`);
  }
  if (!stat.isFile()) fail("diagram_readme_absent", `README is absent: ${path}`);
  if (stat.size === 0) fail("diagram_readme_empty", `README is empty: ${path}`);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    fail("diagram_readme_unreadable", `README is unreadable: ${path}: ${error.message}`);
  }
  if (text.length === 0) fail("diagram_readme_empty", `README is empty: ${path}`);
  return text;
}

function digestFile(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch (error) {
    fail("diagram_link_target_mismatch", `cannot read ${path}: ${error.message}`);
  }
}

function filePathFromTarget(target) {
  const trimmed = target.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    let url;
    try {
      url = new URL(trimmed);
    } catch (error) {
      fail("diagram_link_target_mismatch", `link target is not a usable URL: ${error.message}`);
    }
    const parts = url.pathname.split("/").filter(Boolean);
    let ref;
    let filePath;
    if (url.hostname === "raw.githubusercontent.com") {
      if (parts.length < 4) {
        fail("diagram_link_target_mismatch", `raw URL path is too short to name ${CANONICAL}: ${trimmed}`);
      }
      ref = parts[2];
      filePath = parts.slice(3).join("/");
    } else if (url.hostname === "github.com" && (parts[2] === "blob" || parts[2] === "raw")) {
      if (parts.length < 5) {
        fail("diagram_link_target_mismatch", `GitHub URL path is too short to name ${CANONICAL}: ${trimmed}`);
      }
      ref = parts[3];
      filePath = parts.slice(4).join("/");
    } else {
      fail("diagram_link_target_mismatch", `link target does not resolve to this commit's ${CANONICAL}: ${trimmed}`);
    }
    if (/^[0-9a-f]{40}$/i.test(ref)) {
      fail(
        "diagram_link_target_pinned_commit",
        `link target pins commit ${ref} and cannot track this commit's ${CANONICAL}`,
      );
    }
    return filePath;
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    fail("diagram_link_target_mismatch", `link target is not a tree-relative path: ${trimmed}`);
  }
  const normalized = posix.normalize(trimmed).replace(/^\.\//, "");
  if (normalized === ".." || normalized.startsWith("../")) {
    fail("diagram_link_target_mismatch", `link target escapes the tree: ${trimmed}`);
  }
  return normalized;
}

const readme = readReadme(README);
const wrapped = readme.match(/\[!\[[^\]]*\]\(docs\/seal-flow\.svg\)\]\(([^)\s]+)\)/);
if (!wrapped) {
  fail("diagram_link_absent", `README has no process-diagram link wrapping ${CANONICAL}`);
}

const namedPath = filePathFromTarget(wrapped[1]);
if (namedPath !== CANONICAL) {
  fail(
    "diagram_link_target_mismatch",
    `link target names ${namedPath}, not this commit's ${CANONICAL}`,
  );
}

const expected = digestFile(SVG);
const resolved = digestFile(resolve(ROOT, namedPath));
if (resolved !== expected) {
  fail(
    "diagram_link_target_mismatch",
    `link target ${namedPath} digest ${resolved} does not match this commit's ${CANONICAL} digest ${expected}`,
  );
}

console.log(`PASS  diagram link target ${namedPath} sha256=${expected}`);
