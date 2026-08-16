const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const protectionPath = path.join(__dirname, "../spine/protection.cjs");
const storePath = path.join(__dirname, "../spine/store.cjs");

const productRoots = ["spine", "bin", "contract"];

function productSources() {
  const files = [];
  for (const root of productRoots) {
    const absoluteRoot = path.join(__dirname, "..", root);
    const pending = [absoluteRoot];
    while (pending.length > 0) {
      const current = pending.pop();
      const stat = fs.statSync(current);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(current)) pending.push(path.join(current, entry));
      } else if (current === path.join(__dirname, "../bin/seal") || /\.(?:cjs|mjs|js)$/.test(current)) {
        files.push(current);
      }
    }
  }
  return files.sort();
}

function withoutComments(source) {
  let result = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "line") {
      if (char === "\n") {
        state = "code";
        result += char;
      } else {
        result += " ";
      }
    } else if (state === "block") {
      if (char === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else {
        result += char === "\n" ? char : " ";
      }
    } else if (state === "single" || state === "double" || state === "template") {
      result += char;
      if (char === "\\") {
        result += next || "";
        index += 1;
      } else if ((state === "single" && char === "'") ||
                 (state === "double" && char === "\"") ||
                 (state === "template" && char === "`")) {
        state = "code";
      }
    } else if (char === "/" && next === "/") {
      result += "  ";
      index += 1;
      state = "line";
    } else if (char === "/" && next === "*") {
      result += "  ";
      index += 1;
      state = "block";
    } else {
      result += char;
      if (char === "'") state = "single";
      else if (char === "\"") state = "double";
      else if (char === "`") state = "template";
    }
  }
  return result;
}

function functionRange(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return [start, index + 1];
  }
  assert.fail(`${name} must have a complete body`);
}

test("every protection liveness verdict is witness-gated", () => {
  const source = withoutComments(fs.readFileSync(protectionPath, "utf8"));
  const livePidUses = [...source.matchAll(/\blivePid\s*\(/g)].map((match) => match.index);
  assert.equal(livePidUses.length, 2, "livePid must remain private to its definition and guarded predicate");
  const [predicateStart, predicateEnd] = functionRange(source, "lockOwnerIsLive");
  assert.ok(livePidUses[1] > predicateStart && livePidUses[1] < predicateEnd,
    "the only livePid call must be inside lockOwnerIsLive");
  assert.match(source, /function lockOwnerIsLive\(owner\)\s*\{[\s\S]*?processStartWitness\(owner\.pid\)/);
  assert.match(source, /if \(lockOwnerIsLive\(state\?\.lease\)\)/);
  assert.doesNotMatch(source, /if \([^\n]*livePid\([^\n]*\)[^\n]*\)\s*\{[\s\S]*?active_claude_session/);
});

test("raw process liveness primitives stay centralized behind the witness predicate", () => {
  const references = [];
  const destructures = [];
  for (const file of productSources()) {
    const source = withoutComments(fs.readFileSync(file, "utf8"));
    for (const match of source.matchAll(/\bprocess\s*\.\s*kill\b/g)) references.push({ file, index: match.index });
    for (const match of source.matchAll(/\{[^{}]*\bkill\b(?:\s*:\s*[A-Za-z_$][\w$]*)?[^{}]*\}\s*=\s*(?:process\b|require\s*\(\s*["'](?:node:)?process["']\s*\))/g)) {
      destructures.push({ file, index: match.index });
    }
  }

  assert.deepEqual(destructures, [], "process.kill must not be extracted into an untracked alias");
  assert.equal(references.length, 1, "there must be exactly one direct process.kill primitive in product source");
  assert.equal(references[0].file, protectionPath, "the process.kill primitive must remain in protection.cjs");
  const protectionSource = withoutComments(fs.readFileSync(protectionPath, "utf8"));
  const [livePidStart, livePidEnd] = functionRange(protectionSource, "livePid");
  assert.ok(references[0].index > livePidStart && references[0].index < livePidEnd,
    "the process.kill primitive must remain inside private livePid");
});

test("store has no raw liveness predicate around the shared guarded one", () => {
  const source = fs.readFileSync(storePath, "utf8");
  assert.doesNotMatch(source, /function\s+livePid\b/);
  assert.doesNotMatch(source, /process\.kill\s*\(/);
  assert.match(source, /lockOwnerIsLive\(existing\)/);
});
