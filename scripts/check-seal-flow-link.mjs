// SPDX-License-Identifier: Apache-2.0
// The SVG remains a repository asset, but the README shows the product's terminal UI.
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const README = process.env.SEAL_FLOW_LINK_README || resolve(ROOT, "README.md");

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

const readme = readReadme(README);
if (readme.includes("assets/seal-flow.svg")) fail("diagram_still_referenced", "README still references assets/seal-flow.svg");
if (!/INPUT REQUIRED[\s\S]*?BLOCKED/.test(readme)) fail("terminal_capture_absent", "README has no held-to-blocked terminal capture");
console.log("PASS  README uses the terminal approval capture and does not reference the SVG");
