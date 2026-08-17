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
if (repos.length === 0) {
  console.error("ERROR public sibling population is empty; refusing to treat silence as a complete navigation inventory");
  process.exit(1);
}
// Roadmap step 6: the developer README links no sibling repository. Every
// public sibling must therefore discharge with a stated reason, and a family
// repository appearing in the README is a failure, not a success.
const offRouteFamily = new Set(["mcp-seal-dev", "seal-host", "seal-check", "seal-live-demo", "seal-assurance-kit", "seal-verify-action"]);
function discharge(name) {
  if (offRouteFamily.has(name)) return "repository family is off the developer route (roadmap step 6); named for evaluators in EVALUATOR-START.md and docs/REPO-TOPOLOGY.md";
  if (name === "crdt-lean") return "deferred Seal v3 distributed architecture, not a current developer route";
  if (name === "seal-demo") return "superseded by seal-live-demo";
  if (name === "mcp-seal-aria") return "separate experiment, not the Seal product family";
  if (!name.includes("seal")) return "public research or account repository, not the Seal product family";
  return null;
}
let failures = 0, discharged = 0;
for (const repo of repos) {
  if (readme.includes(repo.url)) {
    console.error(`LINKED     ${repo.name}: the developer README must not link sibling repositories (roadmap step 6)`);
    failures++;
    continue;
  }
  const reason = discharge(repo.name);
  if (reason) { console.log(`DISCHARGED ${repo.name}: ${reason}`); discharged++; continue; }
  console.error(`UNREACHABLE ${repo.name}: public sibling is neither discharged nor accounted for`);
  failures++;
}
const linked = 0;
console.log(`navigation-inventory: ${repos.length} public siblings, ${linked} linked, ${discharged} discharged, ${failures} unreachable`);
process.exit(failures ? 1 : 0);
