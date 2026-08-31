// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { renderCast } = require("../harness/claude-code/terminal-renderer.cjs");

test("OSC 8 becomes visible text without escape or session identifier bytes", () => {
  const directory = fs.mkdtempSync("/home/monkey/scratch/castrender/renderer-test-");
  const cast = `${directory}/fixture.cast`;
  fs.writeFileSync(cast, [
    JSON.stringify({ version: 2, width: 20, height: 3 }),
    JSON.stringify([0, "o", "before\u001b]8;;https://claude.ai/code/session_EXAMPLE\u0007LINK\u001b]8;;\u0007 after"]),
    JSON.stringify([0, "o", "\u001b[2K\rfinal"]),
    "",
  ].join("\n"));
  const transcript = Buffer.from(renderCast(cast), "utf8");
  assert.equal(transcript.includes(0x1b), false);
  assert.equal(transcript.includes(Buffer.from("claude.ai/code/session_")), false);
  assert.deepEqual([...transcript].filter((byte) => byte !== 0x0a && (byte <= 0x1f || (byte >= 0x7f && byte <= 0x9f))), []);
  assert.match(transcript.toString("utf8"), /This is a rendered terminal transcript/);
  assert.match(transcript.toString("utf8"), /final/);
});
