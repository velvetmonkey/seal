// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { renderCast } = require("../harness/claude-code/terminal-renderer.cjs");

function fixture(events, width = 20, height = 3) {
  fs.mkdirSync("/home/monkey/scratch/castrender3", { recursive: true });
  const directory = fs.mkdtempSync("/home/monkey/scratch/castrender3/renderer-test-");
  const cast = `${directory}/fixture.cast`;
  fs.writeFileSync(cast, [
    JSON.stringify({ version: 2, width, height }),
    ...events.map((output) => JSON.stringify([0, "o", output])),
    "",
  ].join("\n"));
  return cast;
}

test("OSC 8 becomes visible text without escape or session identifier bytes", () => {
  const cast = fixture(["before\u001b]8;;https://claude.ai/code/session_EXAMPLE\u0007LINK\u001b]8;;\u0007 after", "\u001b[2K\rfinal"]);
  const transcript = Buffer.from(renderCast(cast), "utf8");
  assert.equal(transcript.includes(0x1b), false);
  assert.equal(transcript.includes(Buffer.from("claude.ai/code/session_")), false);
  assert.deepEqual([...transcript].filter((byte) => byte !== 0x0a && (byte <= 0x1f || (byte >= 0x7f && byte <= 0x9f))), []);
  assert.match(transcript.toString("utf8"), /This is a rendered terminal transcript/);
  assert.match(transcript.toString("utf8"), /final/);
});

test("CHA, CUP, and CUF use terminal columns and overwrite cells", () => {
  const cast = fixture(["abcdef", "\u001b[1GZ", "\u001b[2;4HXY", "\u001b[2C!"], 10, 3);
  const transcript = renderCast(cast);
  assert.match(transcript, /Zbcdef/);
  assert.match(transcript, /   XY  !/);
});

test("scrollback emits each scrolled line before the final frame", () => {
  const cast = fixture(["one\r\ntwo\r\nthree\r\nfour"], 10, 2);
  const transcript = renderCast(cast);
  assert.match(transcript, /one\ntwo\nthree\nfour/);
});

test("line feeds preserve seal-accepted-note after it scrolls out of a DECSTBM region", () => {
  const cast = fixture([
    "\u001b[1;2r\u001b[1;1Hseal-accepted-note\r\nnext\r\n\u001b[1;1H                  ",
  ], 20, 3);
  assert.match(renderCast(cast), /seal-accepted-note/, "seal-accepted-note is missing after line-feed scrolling");
});

test("CSI S preserves seal-accepted-note after it scrolls out of a DECSTBM region", () => {
  const cast = fixture([
    "\u001b[1;3r\u001b[1;1Hseal-accepted-note\u001b[1S\u001b[1;1H                  ",
  ], 20, 3);
  assert.match(renderCast(cast), /seal-accepted-note/, "seal-accepted-note is missing after CSI S scrolling");
});

test("CSI T scrolls the DECSTBM region down", () => {
  const cast = fixture(["\u001b[1;3rone\r\ntwo\r\nthree\u001b[1T"], 20, 3);
  assert.match(renderCast(cast), /\n\none\ntwo\n/);
});
