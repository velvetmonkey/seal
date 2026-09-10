// SPDX-License-Identifier: Apache-2.0
// Claude Code 2.1.251 paints three message lines, then folds the rest, and
// separately paints the approve schema description. Put tool and argument
// values first; retain all six-line-body information, including both boundary
// lines, for clients that paint the whole message. The generic approval title
// shares the tool line: it does not earn a painted slot of its own.
//
// Keep the seven-line total budget: the recorded fold provides no evidence
// for increasing it. Folding two ceremony lines into the useful content frees
// two argument lines without increasing either the vertical or width budget.
// The measured usable width remains terminal width - 6. Never truncate.
const { canonicalString } = require("./canonical.cjs");

const MESSAGE_LINE_CAP = 7;
const WIDTH_MARGIN = 6;
const SCOPE_RULE = "this parsed call (key order, 1/1.0 match); at most one run";
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
  const lines = [`Tool: ${tool}; ${firstLine}`, ...argLines, scopeLine, OUTSIDE_LINE];

  for (const line of lines) {
    if (displayWidth(line) > usable) {
      return { ok: false, reason: `a line does not fit ${usable} columns and truncation would hide the effect: ${line.slice(0, 40)}…` };
    }
  }
  if (lines.length > MESSAGE_LINE_CAP) {
    return {
      ok: false,
      reason: `the complete effect, scope and outside-Seal line need ${lines.length} lines; Seal permits ${MESSAGE_LINE_CAP}; interactive approval is refused rather than truncated`,
    };
  }
  return { ok: true, message: lines.join("\n"), lines, argLines, scopeLine, outsideLine: OUTSIDE_LINE };
}

// Route presentation is separate from effect rendering and its refusal budget.
// Quote and escape every non-ASCII code unit, including invisible/bidi characters;
// preserve the complete configured key rather than hiding a distinguishing suffix.
function renderServerLabel(serverName) {
  const label = typeof serverName === "string" && serverName.trim().length > 0
    ? JSON.stringify(serverName).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`)
    : "unknown";
  return `Server (configured route, not verified): ${label}`;
}

module.exports = { renderApprovalMessage, renderServerLabel, MESSAGE_LINE_CAP, WIDTH_MARGIN, displayWidth };
