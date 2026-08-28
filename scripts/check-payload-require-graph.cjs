#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Check that every local CommonJS require in the shipped graph is shipped.
const fs = require("node:fs");
const path = require("node:path");
const { PAYLOAD_PATHS } = require("./build-dist.cjs");

const ROOT = path.join(__dirname, "..");
const STRING = /^(?:"([^"]+)"|'([^']+)')$/;
const JOIN = /^path\.join\(\s*(ROOT|path\.resolve\(__dirname,\s*"\.\."\)|kernelRoot)\s*,\s*([\s\S]+)\)$/;

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

function requireExpressions(text) {
  const calls = [];
  const startPattern = /\brequire\s*\(/g;
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
    if (depth !== 0) refuse("payload_require_unclosed", `require at line ${lineNumber(text, match.index)} has no closing parenthesis`);
    calls.push({ expression: text.slice(startPattern.lastIndex, index - 1).trim(), index: match.index });
    startPattern.lastIndex = index;
  }
  return calls;
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
    const base = join[1] === "kernelRoot" ? path.join(ROOT, "runtime", "kernel") : ROOT;
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
  while (queue.length > 0) {
    const source = queue.shift();
    if (visited.has(source) || (!/\.(?:cjs|js|mjs)$/.test(source) && path.basename(source) !== "seal")) continue;
    visited.add(source);
    const text = fs.readFileSync(source, "utf8");
    for (const match of requireExpressions(text)) {
      const target = resolveLocalRequire(match.expression, source, match.index);
      if (target === null) continue;
      const resolved = resolveFile(target);
      const relative = path.relative(ROOT, resolved);
      if (!shipped.has(resolved)) refuse("payload_require_unshipped", `${path.relative(ROOT, source)} requires ${relative}`);
      edges.push(`${path.relative(ROOT, source)} -> ${relative}`);
      queue.push(resolved);
    }
  }
  return { edges, visited: [...visited].map((file) => path.relative(ROOT, file)) };
}

if (require.main === module) {
  try {
    const result = checkPayloadRequireGraph();
    process.stdout.write(`PASS payload require graph: ${result.visited.length} files, ${result.edges.length} local requires\n`);
    for (const edge of result.edges) process.stdout.write(`${edge}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { checkPayloadRequireGraph };
