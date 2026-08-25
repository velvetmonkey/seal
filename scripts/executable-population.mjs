#!/usr/bin/env node
// Canonical executable-check population.  A row is a source location whose
// behaviour reaches a tracked executable-capable unit, plus the release binary
// that is deliberately generated outside the source tree.
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function trackedFiles(root) {
  try {
    const temporary = relative(root, resolve(tmpdir()));
    const temporaryIsInsideRoot = temporary && !temporary.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(temporary);
    return execFileSync("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
      .split("\0").filter(Boolean)
      // A caller may deliberately put its system temporary directory beneath
      // the source root. Runtime files are not executable source population.
      .filter((file) => !temporaryIsInsideRoot || (file !== temporary && !file.startsWith(`${temporary}/`)))
      .sort();
  } catch (error) {
    throw new Error(`cannot derive executable population from ${root}: ${error.message}`);
  }
}

function text(root, file) {
  try { return readFileSync(join(root, file), "utf8"); } catch { return null; }
}

function executableUnits(root, files) {
  return new Set(files.filter((file) => {
    const absolute = join(root, file);
    try {
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) return true;
      if ((stat.mode & 0o111) !== 0 || file.endsWith(".wasm")) return true;
      return readFileSync(absolute, "utf8").startsWith("#!");
    } catch { return false; }
  }));
}

function lineAt(source, offset) { return source.slice(0, offset).split("\n").length; }
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Resolve string-bearing variables before looking for their use as a command.
// This handles `const runner = resolve(ROOT, "scripts/x.mjs")`, shell variables,
// and the common path.join/resolve computed-path forms without relying on a name
// or a comment marker.
function bindings(source) {
  const found = new Map();
  const computed = /(?:const|let|var|export\s+const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:resolve|join)\(([^\n)]*)\)/g;
  for (const match of source.matchAll(computed)) {
    const parts = [...match[2].matchAll(/["']([^"']+)["']/g)].map((part) => part[1]);
    if (parts.length) found.set(match[1], parts.join("/"));
  }
  const literal = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(literal)) found.set(match[1], match[2]);
  const shell = /(?:^|\n)\s*([A-Za-z_][A-Za-z0-9_]*)=["']?([^\s"']+)["']?/g;
  for (const match of source.matchAll(shell)) found.set(match[1], match[2]);
  return found;
}

function canonicalTarget(root, caller, raw, units) {
  const cleaned = raw.replace(/^file:\/\//, "").replace(/^\.\//, "");
  const candidates = [cleaned, normalize(relative(root, resolve(dirname(join(root, caller)), cleaned)))];
  for (const candidate of candidates) {
    if (units.has(candidate)) return candidate;
    const absolute = isAbsolute(raw) ? raw : join(root, candidate);
    try {
      const resolved = relative(root, realpathSync(absolute));
      if (units.has(resolved)) return resolved; // symlink target
    } catch { /* an unbuilt/generated path is not a tracked unit */ }
  }
  return null;
}

function add(rows, caller, source, offset, target, kind) {
  rows.set(`${caller}:${lineAt(source, offset)} -> ${target}`, { caller, line: lineAt(source, offset), target, kind });
}

function sourceRows(root, files, units) {
  const rows = new Map();
  for (const caller of files) {
    const source = text(root, caller);
    if (source === null) continue;
    // Direct path use remains important: the population includes declared
    // invocation candidates in CI, tests, manifests, and harness fixtures.
    for (const target of units) {
      if (caller === target) continue;
      const re = new RegExp(`(?<![A-Za-z0-9_./-])${escape(target)}(?![A-Za-z0-9_./-])`, "g");
      for (const hit of source.matchAll(re)) add(rows, caller, source, hit.index, target, "direct");
    }
    const values = bindings(source);
    for (const [name, raw] of values) {
      const target = canonicalTarget(root, caller, raw, units);
      if (!target || caller === target) continue;
      // The declaration is not enough: record only an execution behaviour.
      const use = new RegExp("(?:(?:spawn(?:Sync)?|execFile(?:Sync)?|exec|node|bash|sh|run)\\s*(?:\\(|\\s+)[^\\n]*?\\b" + escape(name) + "\\b|\\$" + escape(name) + "\\b)", "g");
      for (const hit of source.matchAll(use)) add(rows, caller, source, hit.index, target, "variable");
    }
    if (caller === "package.json") {
      let pkg;
      try { pkg = JSON.parse(source); } catch { pkg = null; }
      for (const command of Object.values(pkg?.scripts ?? {})) {
        if (typeof command !== "string") continue;
        for (const target of units) {
          const hit = command.indexOf(target);
          if (hit >= 0) add(rows, caller, source, source.indexOf(command) + hit, target, "package-script");
        }
      }
    }
  }
  return rows;
}

export function enumerate(root = process.cwd()) {
  const files = trackedFiles(root);
  const units = executableUnits(root, files);
  const rows = sourceRows(root, files, units);
  const version = text(root, "VERSION")?.trim();
  if (version) rows.set(`generated-release -> dist/seal-v${version}-linux-x64`, { caller: "generated-release", line: 0, target: `dist/seal-v${version}-linux-x64`, kind: "generated" });
  const sorted = [...rows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
  if (sorted.length === 0) throw new Error("executable-check population is empty; refusing to treat silence as complete coverage");
  return sorted;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rootFlag = process.argv.indexOf("--root");
  const root = rootFlag >= 0 ? resolve(process.argv[rootFlag + 1]) : process.cwd();
  try {
    const rows = enumerate(root);
    for (const row of rows) console.log(`UNIT ${row.caller}:${row.line} -> ${row.target}`);
    console.log(`TOTAL ${rows.length}`);
  } catch (error) {
    console.error(`ERROR ${error.message}`);
    process.exit(1);
  }
}
