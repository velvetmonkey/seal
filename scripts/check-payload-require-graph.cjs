#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Check that every local JavaScript loader in the shipped graph is shipped.
const fs = require("node:fs");
const path = require("node:path");
const { PAYLOAD_PATHS } = require("./build-dist.cjs");

const ROOT = path.join(__dirname, "..");
const STRING = /^(?:"([^"]+)"|'([^']+)')$/;
const JOIN = /^path\.join\(\s*(ROOT|path\.resolve\(__dirname,\s*"\.\."\)|kernelRoot)\s*,\s*([\s\S]+)\)$/;
const FILE_URL = /^pathToFileURL\(\s*([\s\S]+)\s*\)\.href$/;
const MODULE_URL = /^new URL\(\s*((?:"[^"]+")|(?:'[^']+'))\s*,\s*import\.meta\.url\s*\)$/;
const NON_REQUIRE_RUNTIME_INPUTS = [
  { source: "contract/kernel-authorization.cjs", loader: "spawnSync", target: "contract/kernel-authorization-worker.cjs" },
  { source: "runtime/kernel/decision-runner.cjs", loader: "readFileSync", target: "runtime/kernel/wasm/seal.js" },
  { source: "runtime/kernel/runner.cjs", loader: "readFileSync", target: "runtime/kernel/wasm/seal.js" },
];

function refuse(code, reason) {
  throw new Error(`REFUSE ${code}: ${reason}`);
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function splitJoinArguments(text) {
  const parts = [];
  let start = 0;
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      if (char === quote && text[index - 1] !== "\\") quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ",") {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

function resolveJoinBase(name, source) {
  if (name === "kernelRoot") return path.join(ROOT, "runtime", "kernel");
  if (name === "path.resolve(__dirname, \"..\")") return ROOT;
  const text = fs.readFileSync(source, "utf8");
  if (/\bconst\s+ROOT\s*=\s*path\.resolve\(\s*__dirname\s*\)\s*;/.test(text)) return path.dirname(source);
  return ROOT;
}

function callExpressions(text, name) {
  const calls = [];
  const startPattern = new RegExp(`\\b${name}\\s*\\(`, "g");
  let match;
  while ((match = startPattern.exec(text)) !== null) {
    let depth = 1;
    let quote = null;
    let index = startPattern.lastIndex;
    for (; index < text.length && depth > 0; index += 1) {
      const char = text[index];
      if (quote !== null) {
        if (char === quote && text[index - 1] !== "\\") quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
      }
    }
    if (depth !== 0) refuse("payload_require_unclosed", `${name} at line ${lineNumber(text, match.index)} has no closing parenthesis`);
    calls.push({ expression: text.slice(startPattern.lastIndex, index - 1).trim(), index: match.index });
    startPattern.lastIndex = index;
  }
  return calls;
}

function staticImportSpecifiers(text) {
  const imports = [];
  const pattern = /\bimport\s+(?!\()(?:(?!;)[\s\S])*?\bfrom\s+("[^"]+"|'[^']+')/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const expression = match[1];
    imports.push({ expression, index: match.index });
  }
  return imports;
}

function resolveLocalRequire(expression, source, index) {
  const literal = expression.match(STRING);
  if (literal) {
    const request = literal[1] ?? literal[2];
    if (!request.startsWith(".")) return null;
    return path.resolve(path.dirname(source), request);
  }
  const join = expression.match(JOIN);
  if (join) {
    const base = resolveJoinBase(join[1], source);
    const segments = splitJoinArguments(join[2]);
    if (segments.length === 0 || segments.some((segment) => !STRING.test(segment))) {
      refuse("payload_require_dynamic", `${path.relative(ROOT, source)}:${lineNumber(fs.readFileSync(source, "utf8"), index)}: ${expression}`);
    }
    return path.resolve(base, ...segments.map((segment) => segment.match(STRING)[1] ?? segment.match(STRING)[2]));
  }
  if (expression.startsWith("path.join(") || expression.startsWith("path.resolve(")) {
    refuse("payload_require_dynamic", `${path.relative(ROOT, source)}:${lineNumber(fs.readFileSync(source, "utf8"), index)}: ${expression}`);
  }
  refuse("payload_require_dynamic", `${path.relative(ROOT, source)}:${lineNumber(fs.readFileSync(source, "utf8"), index)}: ${expression}`);
}

function resolveLocalImport(expression, source, index, dynamic) {
  if (!dynamic) return resolveLocalRequire(expression, source, index);
  const fileUrl = expression.match(FILE_URL);
  if (fileUrl) return resolveLocalRequire(fileUrl[1], source, index);
  const moduleUrl = expression.match(MODULE_URL);
  if (moduleUrl) return resolveLocalRequire(moduleUrl[1], source, index);
  return resolveLocalRequire(expression, source, index);
}

function resolveFile(file) {
  const candidates = [file, `${file}.cjs`, `${file}.js`, `${file}.json`, path.join(file, "index.cjs"), path.join(file, "index.js")];
  const found = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!found) refuse("payload_require_target_absent", `${path.relative(ROOT, file)} does not resolve to a repository file`);
  return path.resolve(found);
}

function checkPayloadRequireGraph(payloadPaths = PAYLOAD_PATHS) {
  const shipped = new Set(payloadPaths.map((relative) => path.resolve(ROOT, relative)));
  const queue = [...shipped];
  const visited = new Set();
  const edges = [];
  for (const input of NON_REQUIRE_RUNTIME_INPUTS) {
    const source = resolveFile(path.resolve(ROOT, input.source));
    const target = resolveFile(path.resolve(ROOT, input.target));
    if (!shipped.has(source)) refuse("payload_require_unshipped", `${input.source} is a declared ${input.loader} source but is not shipped`);
    if (!shipped.has(target)) refuse("payload_require_unshipped", `${input.source} ${input.loader} loads ${input.target}`);
    edges.push(`${input.source} -> ${input.target} (${input.loader})`);
  }
  while (queue.length > 0) {
    const source = queue.shift();
    if (visited.has(source) || (!/\.(?:cjs|js|mjs)$/.test(source) && path.basename(source) !== "seal")) continue;
    visited.add(source);
    const text = fs.readFileSync(source, "utf8");
    const loaders = [
      ...callExpressions(text, "require").map((match) => ({ ...match, kind: "require", dynamic: false })),
      ...staticImportSpecifiers(text).map((match) => ({ ...match, kind: "import", dynamic: false })),
      ...callExpressions(text, "import").map((match) => ({ ...match, kind: "import", dynamic: true })),
    ].sort((left, right) => left.index - right.index);
    for (const match of loaders) {
      const target = match.kind === "require"
        ? resolveLocalRequire(match.expression, source, match.index)
        : resolveLocalImport(match.expression, source, match.index, match.dynamic);
      if (target === null) continue;
      const resolved = resolveFile(target);
      const relative = path.relative(ROOT, resolved);
      if (!shipped.has(resolved)) refuse("payload_require_unshipped", `${path.relative(ROOT, source)} ${match.kind}s ${relative}`);
      edges.push(`${path.relative(ROOT, source)} -> ${relative} (${match.dynamic ? "import()" : match.kind})`);
      queue.push(resolved);
    }
  }
  return { edges, visited: [...visited].map((file) => path.relative(ROOT, file)) };
}

if (require.main === module) {
  try {
    const result = checkPayloadRequireGraph();
    process.stdout.write(`PASS payload require graph: ${result.visited.length} files, ${result.edges.length} local loaders\n`);
    for (const edge of result.edges) process.stdout.write(`${edge}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { NON_REQUIRE_RUNTIME_INPUTS, checkPayloadRequireGraph, resolveLocalImport };
