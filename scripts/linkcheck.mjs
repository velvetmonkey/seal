#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Internal-link integrity check for the Seal landing repo: every relative
// link/src in the docs must resolve to a file. Run: node scripts/linkcheck.mjs
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["README.md", "index.html", "EVALUATOR-START.md"];
let bad = 0, checked = 0;
const re = /\]\(([^)]+)\)|(?:href|src)\s*=\s*"([^"]+)"/g;
for (const f of files) {
  const txt = readFileSync(`${ROOT}/${f}`, "utf8");
  for (const m of txt.matchAll(re)) {
    let link = (m[1] || m[2] || "").trim();
    if (!link || link.startsWith("http") || link.startsWith("#") || link.startsWith("mailto:")) continue;
    link = link.split("#")[0].split("?")[0];
    if (!link) continue;
    checked++;
    if (!existsSync(resolve(dirname(`${ROOT}/${f}`), link))) { console.log(`BROKEN  ${f} -> ${link}`); bad++; }
  }
}
console.log(`link-check: ${checked} internal links, ${bad} broken`);
process.exit(bad ? 1 : 0);
