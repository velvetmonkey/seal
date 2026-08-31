// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const path = require("node:path");
const { RENDERER_IDENTITY, renderCast, rendererIdentity } = require("../harness/claude-code/terminal-renderer.cjs");

function fixture(events, width = 20, height = 3) {
  const scratch = path.join(process.env.TMPDIR || "/home/monkey/scratch/castrender5", "castrender");
  fs.mkdirSync(scratch, { recursive: true });
  const directory = fs.mkdtempSync(path.join(scratch, "renderer-test-"));
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
  assert.match(transcript.toString("utf8"), /^This file holds the terminal's LAST VISIBLE FRAME\. It has 0 scrollback lines\. Content that the terminal overwrote before it scrolled is not present\./);
  assert.match(transcript.toString("utf8"), /This is NOT a record of the whole session/);
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
  assert.match(transcript, /^This file holds 2 scrollback lines PLUS the terminal's LAST VISIBLE FRAME\./);
  assert.doesNotMatch(transcript, /Earlier content was overwritten rather than scrolled/);
  assert.match(transcript, /one\ntwo\nthree\nfour/);
});

test("a longer scroll derives its larger scrollback count", () => {
  const cast = fixture(["one\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix"], 10, 2);
  const transcript = renderCast(cast);
  assert.match(transcript, /^This file holds 4 scrollback lines PLUS the terminal's LAST VISIBLE FRAME\./);
  assert.match(transcript, /one\ntwo\nthree\nfour\nfive\nsix/);
});

test("line feeds preserve seal-accepted-note after it scrolls out of a DECSTBM region", () => {
  const cast = fixture([
    "\u001b[1;2r\u001b[1;1Hseal-accepted-note\r\nnext\r\n\u001b[1;1H                  ",
  ], 20, 3);
  const transcript = renderCast(cast);
  assert.equal((transcript.match(/seal-accepted-note/g) || []).length, 1, "line-feed scrolling must retain one seal-accepted-note");
});

test("CSI S preserves seal-accepted-note after it scrolls out of a DECSTBM region", () => {
  const cast = fixture([
    "\u001b[1;3r\u001b[1;1Hseal-accepted-note\u001b[1S\u001b[1;1H                  ",
  ], 20, 3);
  const transcript = renderCast(cast);
  assert.equal((transcript.match(/seal-accepted-note/g) || []).length, 1, "CSI S scrolling must retain one seal-accepted-note");
});

test("CSI T scrolls the DECSTBM region down", () => {
  const cast = fixture(["\u001b[1;3rone\r\ntwo\r\nthree\u001b[1T"], 20, 3);
  assert.match(renderCast(cast), /\n\none\ntwo\n/);
});

test("source-layer redaction closes the width-20 UUID wrap", () => {
  const cast = fixture(["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"], 20, 3);
  const transcript = renderCast(cast);
  assert.match(transcript, /\[REDACTED-SESSION-ID\]/);
  assert.doesNotMatch(transcript, /aaaaaaaa-bbbb-4ccc-8/);
  assert.doesNotMatch(transcript, /ddd-eeeeeeeeeeee/);
});

test("source-layer redaction closes a UUID split by a cursor move", () => {
  const cast = fixture(["aaaaaaaa-bbbb-4ccc-8\u001b[2;1Hddd-eeeeeeeeeeee"], 20, 3);
  const transcript = renderCast(cast);
  assert.match(transcript, /\[REDACTED-SESSION-ID\]/);
  assert.doesNotMatch(transcript, /aaaaaaaa-bbbb-4ccc-8/);
  assert.doesNotMatch(transcript, /ddd-eeeeeeeeeeee/);
});

test("source-layer redaction closes a wrapped Claude Code session URL", () => {
  const cast = fixture(["https://claude.ai/code/session_FABRICATED-SESSION-ONLY"], 20, 4);
  const transcript = renderCast(cast);
  assert.match(transcript, /\[REDACTED-SESSION-URL\]/);
  assert.doesNotMatch(transcript, /claude\.ai\/code\/session_/);
  assert.doesNotMatch(transcript, /FABRICATED-SESSION-ONLY/);
});

test("UUID shape redaction includes version 7 and bare session identifiers", () => {
  const cast = fixture(["00000000-0000-7000-8000-000000000000 session_FABRICATED_ONLY"], 80, 3);
  const transcript = renderCast(cast);
  assert.equal((transcript.match(/\[REDACTED-SESSION-ID\]/g) || []).length, 2);
  assert.doesNotMatch(transcript, /00000000-0000-7000-8000-000000000000/);
  assert.doesNotMatch(transcript, /session_FABRICATED_ONLY/);
});

test("ULID and 32-character hex shapes remain out of session-identifier scope", () => {
  const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
  const hex = "0123456789abcdef0123456789abcdef";
  const transcript = renderCast(fixture([`${ulid} ${hex}`], 80, 3));
  assert.match(transcript, new RegExp(ulid));
  assert.match(transcript, new RegExp(hex));
});

test("renderer identity derives from source and moves with a source edit", () => {
  const source = fs.readFileSync(path.join(__dirname, "../harness/claude-code/terminal-renderer.cjs"));
  assert.equal(RENDERER_IDENTITY, rendererIdentity(source));
  assert.notEqual(rendererIdentity(source), rendererIdentity(Buffer.concat([source, Buffer.from("\n// behaviour edit\n")])));
});
