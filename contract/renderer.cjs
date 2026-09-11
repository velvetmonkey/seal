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
const JSON_SCALAR = /^(?:null|true|false|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)$/;
const BARE_VALUE = /^[A-Za-z0-9_.\/:@-]+$/;

// Conservative display width: printable ASCII counts 1, everything else 2.
// Untrusted display fields are escaped before this measurement.
function displayWidth(text) {
  let width = 0;
  for (const ch of text) width += ch.codePointAt(0) <= 0x7e && ch.codePointAt(0) >= 0x20 ? 1 : 2;
  return width;
}

function formatTtl(ttlMs) {
  return ttlMs % 60000 === 0 ? `${ttlMs / 60000} min` : `${Math.round(ttlMs / 1000)} s`;
}

// Escape controls, line separators and Unicode format characters (including
// bidi overrides/isolates) in every untrusted display field, including JSON.
function escapeDisplay(text) {
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (ch) =>
    ch.split("").map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`).join(""));
}

function renderValue(value) {
  if (typeof value === "string" && BARE_VALUE.test(value) && !JSON_SCALAR.test(value)) return value;
  return escapeDisplay(canonicalString(value));
}

function renderName(name) {
  return BARE_VALUE.test(name) ? name : escapeDisplay(JSON.stringify(name));
}

function renderApprovalMessage(tool, args, { terminalWidth = 80, ttlMs = 120000, firstLine = "Approval required", selection } = {}) {
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
      : names.map((name) => `  ${renderName(name)}: ${renderValue((args ?? {})[name])}`);
  } catch (error) {
    return { ok: false, reason: `arguments have no canonical rendering: ${error.message}` };
  }

  const scopeLine = `Scope: ${SCOPE_RULE}; ${formatTtl(ttlMs)}.`;
  const parts = [`Tool: ${renderName(tool)}; ${escapeDisplay(firstLine)}`, ...argLines, scopeLine, OUTSIDE_LINE];
  if (selection) {
    // Explicitly wrap the explanatory suffix before measuring the final text.
    // Keep every character, including spaces; an overlong word still refuses.
    const suffix = `Selection predicate: ${escapeDisplay(selection.label)} (${escapeDisplay(selection.detail)})`;
    let line = "";
    for (const word of suffix.match(/\S+\s*/g) || []) {
      if (line && displayWidth(line + word) > usable) { parts.push(line); line = ""; }
      line += word;
    }
    parts.push(line);
  }
  const message = parts.join("\n");
  const lines = message.split("\n");

  for (const line of lines) {
    if (displayWidth(line) > usable) {
      return { ok: false, reason: `a line does not fit ${usable} columns and truncation would hide the effect: ${line.slice(0, 40)}…` };
    }
  }
  const physicalLineCount = message.split("\n").length;
  if (physicalLineCount > MESSAGE_LINE_CAP) {
    return {
      ok: false,
      reason: `the complete effect, scope and outside-Seal line need ${physicalLineCount} lines; Seal permits ${MESSAGE_LINE_CAP}; interactive approval is refused rather than truncated`,
    };
  }
  return { ok: true, message, lines, argLines, scopeLine, outsideLine: OUTSIDE_LINE };
}

module.exports = { renderApprovalMessage, MESSAGE_LINE_CAP, WIDTH_MARGIN, displayWidth, renderName };
