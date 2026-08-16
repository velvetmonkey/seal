const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const protectionPath = path.join(__dirname, "../spine/protection.cjs");
const storePath = path.join(__dirname, "../spine/store.cjs");

test("every protection liveness verdict is witness-gated", () => {
  const source = fs.readFileSync(protectionPath, "utf8");
  const livePidUses = [...source.matchAll(/\blivePid\s*\(/g)].map((match) => match.index);
  assert.equal(livePidUses.length, 2, "livePid must remain private to its definition and guarded predicate");
  const predicateStart = source.indexOf("function lockOwnerIsLive");
  assert.ok(predicateStart >= 0);
  assert.ok(livePidUses[1] > predicateStart, "the only livePid call must be inside lockOwnerIsLive");
  assert.match(source, /function lockOwnerIsLive\(owner\)\s*\{[\s\S]*?processStartWitness\(owner\.pid\)/);
  assert.match(source, /if \(lockOwnerIsLive\(state\?\.lease\)\)/);
  assert.doesNotMatch(source, /if \([^\n]*livePid\([^\n]*\)[^\n]*\)\s*\{[\s\S]*?active_claude_session/);
});

test("store has no raw liveness predicate around the shared guarded one", () => {
  const source = fs.readFileSync(storePath, "utf8");
  assert.doesNotMatch(source, /function\s+livePid\b/);
  assert.doesNotMatch(source, /process\.kill\s*\(/);
  assert.match(source, /lockOwnerIsLive\(existing\)/);
});
