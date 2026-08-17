#!/usr/bin/env node
// Guards that check executable coverage must delegate their denominator here.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { enumerate, trackedFiles } from "./executable-population.mjs";

const root = resolve(process.cwd());
const forbidden = /(?:git\s+["']?ls-files|\bfind\s*\(|\brg\s*\(|readdirSync\s*\()/;
// EXECUTABLE-POPULATION-GUARD
const guards = trackedFiles(root).filter((file) => {
  if (!/^scripts\/.+\.(?:mjs|cjs|js)$/.test(file)) return false;
  return readFileSync(resolve(root, file), "utf8").includes("EXECUTABLE-POPULATION-GUARD");
});
// Calling the enumerator is mandatory but not sufficient: a caller which also
// rebuilds a denominator can silently diverge from it.
const offenders = guards.filter((file) => {
  if (file === "scripts/executable-population.mjs") return false;
  const source = readFileSync(resolve(root, file), "utf8");
  return !source.includes("executable-population.mjs") || forbidden.test(source);
});
if (offenders.length) {
  console.error(`ERROR executable population rolled independently by: ${offenders.join(", ")}`);
  process.exit(1);
}
const population = enumerate(root);
if (population.length === 0) {
  console.error("ERROR executable-check population is empty; refusing to treat silence as complete coverage");
  process.exit(1);
}
console.log(`PASS ${guards.length} executable-population guard callers use the canonical ${population.length}-unit population`);
