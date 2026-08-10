#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Navigation is a separate population from claims. Ground it in the public
// account inventory, then require each sibling to be linked or discharged.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(resolve(root, "README.md"), "utf8");
const result = spawnSync("gh", ["repo", "list", "velvetmonkey", "--limit", "100", "--json", "name,isPrivate,isFork,url"], { encoding: "utf8" });
if (result.status !== 0) {
  console.error(`ERROR unable to derive public sibling population: ${result.stderr.trim()}`);
  process.exit(2);
}
const repos = JSON.parse(result.stdout).filter((repo) => !repo.isPrivate && !repo.isFork && repo.name !== "seal");
const linkedFamily = new Set(["mcp-seal-dev", "seal-host", "seal-check", "seal-live-demo", "seal-assurance-kit", "seal-verify-action"]);
function discharge(name) {
  if (name === "crdt-lean") return "deferred Seal v3 distributed architecture, not a current developer route";
  if (name === "seal-demo") return "superseded by seal-live-demo";
  if (name === "mcp-seal-aria") return "separate experiment, not the Seal product family";
  if (!name.includes("seal")) return "public research or account repository, not the Seal product family";
  return null;
}
let failures = 0, linked = 0, discharged = 0;
for (const repo of repos) {
  if (readme.includes(repo.url)) { console.log(`LINKED     ${repo.name}`); linked++; continue; }
  const reason = discharge(repo.name);
  if (reason) { console.log(`DISCHARGED ${repo.name}: ${reason}`); discharged++; continue; }
  console.error(`UNREACHABLE ${repo.name}: public sibling is neither linked nor discharged`);
  failures++;
}
console.log(`navigation-inventory: ${repos.length} public siblings, ${linked} linked, ${discharged} discharged, ${failures} unreachable`);
process.exit(failures ? 1 : 0);
