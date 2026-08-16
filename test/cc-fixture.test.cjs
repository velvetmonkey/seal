// SPDX-License-Identifier: Apache-2.0
//
// The acceptance fixture's counting is OBSERVED, not asserted.
//
// These tests drive the fixture directly — no Seal, no client — and read the
// count back out of the append-only log it wrote while it was being driven.
// One test drives it to zero calls, one drives it to exactly one, and one
// shows that the earlier bytes of the log are never rewritten.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");

const FIXTURE = path.join(__dirname, "..", "harness", "claude-code", "fixture-server.cjs");

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-cc-fixture-"));
  return { dir, log: path.join(dir, "child.jsonl"), effect: path.join(dir, "effect.txt") };
}

function records(logPath) {
  return fs.readFileSync(logPath, "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line));
}

function childCalls(logPath) {
  return records(logPath).filter((record) => record.kind === "child-call");
}

// A minimal stdio MCP driver: send a frame, wait for the answer with that id.
function driver(space) {
  const child = spawn(process.execPath, [FIXTURE], {
    cwd: space.dir,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, SEAL_CC_FIXTURE_LOG: space.log, SEAL_CC_FIXTURE_EFFECT: space.effect },
  });
  const pending = new Map();
  readline.createInterface({ input: child.stdout, terminal: false }).on("line", (line) => {
    const frame = JSON.parse(line);
    const resolve = pending.get(frame.id);
    if (resolve) { pending.delete(frame.id); resolve(frame); }
  });
  let id = 0;
  return {
    child,
    request(method, params) {
      id += 1;
      const current = id;
      const answered = new Promise((resolve, reject) => {
        pending.set(current, resolve);
        setTimeout(() => reject(new Error(`no answer to ${method}`)), 10000).unref();
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: current, method, params })}\n`);
      return answered;
    },
    async stop() {
      child.stdin.end();
      await new Promise((resolve) => child.once("close", resolve));
    },
  };
}

test("the fixture records zero child calls when the guarded tool is never called", async () => {
  const space = workspace();
  const link = driver(space);
  await link.request("initialize", {});
  const listed = await link.request("tools/list", {});
  await link.request("tools/call", { name: "read_notes", arguments: {} });
  await link.stop();

  assert.deepEqual((listed.result.tools || []).map((tool) => tool.name).sort(), ["append_note", "read_notes"]);
  assert.equal(childCalls(space.log).length, 0, `expected no child-call record:\n${fs.readFileSync(space.log, "utf8")}`);
  assert.equal(fs.existsSync(space.effect), false, "no guarded call means no effect file");
  // The frames that DID arrive are in the log, so zero is a counted zero
  // rather than an empty file that might mean the fixture never ran.
  const kinds = records(space.log).map((record) => record.kind);
  assert.ok(kinds.includes("start"), "the log records that the fixture started");
  assert.ok(kinds.filter((kind) => kind === "frame").length >= 3, "the log records every frame it received");
});

test("the fixture records exactly one child call for one guarded call, with the effect digest", async () => {
  const space = workspace();
  const link = driver(space);
  await link.request("initialize", {});
  const called = await link.request("tools/call", { name: "append_note", arguments: { note: "seal-accepted-note" } });
  await link.stop();

  const calls = childCalls(space.log);
  assert.equal(calls.length, 1, `expected exactly one child-call record:\n${fs.readFileSync(space.log, "utf8")}`);
  assert.equal(calls[0].call_index, 1);
  assert.deepEqual(calls[0].arguments, { note: "seal-accepted-note" });
  assert.match(called.result.content[0].text, /appended: seal-accepted-note/);

  const expected = crypto.createHash("sha256").update(Buffer.from("seal-accepted-note\n", "utf8")).digest("hex");
  assert.equal(calls[0].effect.sha256, expected, "the recorded effect digest is the digest of what was written");
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(space.effect)).digest("hex"), expected);
});

test("the fixture's log is append-only across restarts, so an earlier count cannot be rewritten", async () => {
  const space = workspace();
  const first = driver(space);
  await first.request("initialize", {});
  await first.stop();
  const afterFirst = fs.readFileSync(space.log);

  const second = driver(space);
  await second.request("initialize", {});
  await second.request("tools/call", { name: "append_note", arguments: { note: "seal-accepted-note" } });
  await second.stop();
  const afterSecond = fs.readFileSync(space.log);

  assert.ok(afterSecond.length > afterFirst.length, "the second session extended the log");
  assert.ok(afterSecond.subarray(0, afterFirst.length).equals(afterFirst), "the first session's bytes are unchanged");
  assert.equal(childCalls(space.log).length, 1);
  // Two sessions, two start records, one call: the count belongs to the file,
  // not to any one process.
  assert.equal(records(space.log).filter((record) => record.kind === "start").length, 2);
});

test("the fixture refuses to run unrecorded", () => {
  const space = workspace();
  const withoutLog = spawnSync(process.execPath, [FIXTURE], {
    encoding: "utf8",
    env: { ...process.env, SEAL_CC_FIXTURE_LOG: "", SEAL_CC_FIXTURE_EFFECT: space.effect },
  });
  assert.equal(withoutLog.status, 3);
  assert.match(withoutLog.stderr, /^REFUSE fixture_log_unset: /m);

  const withoutEffect = spawnSync(process.execPath, [FIXTURE], {
    encoding: "utf8",
    env: { ...process.env, SEAL_CC_FIXTURE_LOG: space.log, SEAL_CC_FIXTURE_EFFECT: "" },
  });
  assert.equal(withoutEffect.status, 3);
  assert.match(withoutEffect.stderr, /^REFUSE fixture_effect_unset: /m);
});
