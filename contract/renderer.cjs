// SPDX-License-Identifier: Apache-2.0
// The approval-dialog renderer, fixed to the addendum's SIX-line format
// inside the MEASURED Claude Code v2.1.251 envelope. The client gave 150
// message cells at 156 columns and 274 message cells at 280 columns. The
// measured usable width is terminal width - 6. Schema titles steal lines:
//
//   Approval required
//   Tool: <tool>
//   Arguments:
//     <key>: <value>
//   Scope: this parsed call (key order and 1/1.0 match); at most one run; 2 min.
//   Outside Seal: Bash, network, subprocesses, other tools and servers.
//
// When something changed, the caller REPLACES the first line (e.g.
// `CHANGED: table staging_customers → customers`) via `firstLine` — it never
// adds one. History, frequency and coverage never appear here; they belong
// to `seal status`.
//
// If the complete effect, scope and outside-Seal line do not fit in SEVEN
// lines, REFUSE interactive approval. The effect is never truncated to keep
// the button, because a boundary the terminal hides is not stated.
const { canonicalString } = require("./canonical.cjs");

const MESSAGE_LINE_CAP = 7;
const WIDTH_MARGIN = 6;
const SCOPE_RULE = "this parsed call (key order and 1/1.0 match); at most one run";
const OUTSIDE_LINE = "Outside Seal: Bash, network, subprocesses, other tools and servers.";
const BARE_VALUE = /^[A-Za-z0-9_.\/:@-]+$/;

// Conservative display width: printable ASCII counts 1, everything else 2.
// Canonical JSON has already escaped control characters, so nothing rendered
// here is invisible.
function displayWidth(text) {
  let width = 0;
  for (const ch of text) width += ch.codePointAt(0) <= 0x7e && ch.codePointAt(0) >= 0x20 ? 1 : 2;
  return width;
}

function formatTtl(ttlMs) {
  return ttlMs % 60000 === 0 ? `${ttlMs / 60000} min` : `${Math.round(ttlMs / 1000)} s`;
}

// A string value made of unambiguous characters renders bare, as in the
// addendum's example (`table: customers`); anything else renders as its
// canonical JSON so nothing invisible or ambiguous slips past the approver.
function renderValue(value) {
  if (typeof value === "string" && BARE_VALUE.test(value)) return value;
  return canonicalString(value);
}

function renderApprovalMessage(tool, args, { terminalWidth = 80, ttlMs = 120000, firstLine = "Approval required" } = {}) {
  if (typeof tool !== "string" || tool.length === 0) {
    return { ok: false, reason: "tool name is not a non-empty string" };
  }
  const usable = terminalWidth - WIDTH_MARGIN;
  if (usable < 20) return { ok: false, reason: `terminal width ${terminalWidth} leaves no usable message width` };

  let argLines;
  try {
    const names = Object.keys(args ?? {}).sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    argLines = names.length === 0
      ? ["  (none)"]
      : names.map((name) => `  ${name}: ${renderValue((args ?? {})[name])}`);
  } catch (error) {
    return { ok: false, reason: `arguments have no canonical rendering: ${error.message}` };
  }

  const scopeLine = `Scope: ${SCOPE_RULE}; ${formatTtl(ttlMs)}.`;
  const lines = [firstLine, `Tool: ${tool}`, "Arguments:", ...argLines, scopeLine, OUTSIDE_LINE];

  for (const line of lines) {
    if (displayWidth(line) > usable) {
      return { ok: false, reason: `a line does not fit ${usable} columns and truncation would hide the effect: ${line.slice(0, 40)}…` };
    }
  }
  if (lines.length > MESSAGE_LINE_CAP) {
    return {
      ok: false,
      reason: `the complete effect, scope and outside-Seal line need ${lines.length} lines; the envelope shows ${MESSAGE_LINE_CAP} and hides the rest without any indicator`,
    };
  }
  return { ok: true, message: lines.join("\n"), lines, argLines };
}

module.exports = { renderApprovalMessage, MESSAGE_LINE_CAP, WIDTH_MARGIN, displayWidth };
