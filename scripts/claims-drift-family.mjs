#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Cross-repository integrity check for the two shared claims-drift regions.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedPath = resolve(ROOT, "scripts/claims-drift-family-hashes.json");
const REPOSITORIES = Object.freeze([
  ["seal-check", "master"], ["seal-demo", "main"],
  ["seal-live-demo", "master"], ["seal-verify-action", "main"],
  ["seal-assurance-kit", "main"], ["mcp-seal-dev", "main"],
]);

function fail(message) { console.error(`ERROR  ${message}`); process.exitCode = 2; }
function shared(source, repository) {
  const regions = ["core", "evaluation"].map((name) => {
    const begin = `// FAMILY-SHARED:BEGIN ${name}`;
    const end = `// FAMILY-SHARED:END ${name}`;
    const first = source.indexOf(begin);
    const last = source.indexOf(end);
    if (first === -1 || last === -1 || last < first) throw new Error(`${repository}: shared ${name} region missing or malformed`);
    if (source.indexOf(begin, first + 1) !== -1 || source.indexOf(end, last + 1) !== -1) throw new Error(`${repository}: shared ${name} region repeated`);
    return source.slice(first, last + end.length);
  });
  return regions.join("\n");
}
function roots() {
  const configured = new Map((process.env.FAMILY_CLAIMS_ROOTS ?? "").split(";").filter(Boolean).map((entry) => entry.split("=", 2)));
  return [
    ["seal", resolve(ROOT, "scripts/claims-drift.mjs")],
    ...REPOSITORIES.map(([repository, branch]) => [repository, configured.get(repository) ? resolve(configured.get(repository), "scripts/claims-drift.mjs") : `https://raw.githubusercontent.com/velvetmonkey/${repository}/${branch}/scripts/claims-drift.mjs`]),
  ];
}
async function source(location) {
  if (location.startsWith("https://")) {
    const response = await fetch(location);
    if (!response.ok) throw new Error(`unreachable ${location}: HTTP ${response.status}`);
    return response.text();
  }
  return readFileSync(location, "utf8");
}

let expected;
try { expected = JSON.parse(readFileSync(expectedPath, "utf8")); }
catch (error) { fail(`expected hash record ${expectedPath}: ${error.message}`); process.exit(); }

let bad = false;
for (const [repository, location] of roots()) {
  if (typeof expected[repository] !== "string") { fail(`expected hash record missing repository ${repository}`); bad = true; continue; }
  try {
    const hash = createHash("sha256").update(shared(await source(location), repository)).digest("hex");
    if (hash !== expected[repository]) { console.error(`FAIL  ${repository} shared claims-drift hash ${hash} != expected ${expected[repository]}`); bad = true; }
    else console.log(`PASS  ${repository} shared claims-drift hash ${hash}`);
  } catch (error) { fail(`${repository}: ${error.message}`); bad = true; }
}
if (bad) process.exitCode = 2;
