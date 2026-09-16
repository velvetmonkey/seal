// SPDX-License-Identifier: Apache-2.0
// Configured-route approvals reserve the first three physical lines for all
// mandatory fields. Arguments follow, losslessly wrapped, without consuming
// that budget. Standalone approvals retain their existing complete-effect cap.
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

// Pack the complete mandatory set, backtracking when an early placement
// would prevent a later field from fitting. No field has a fixed line number;
// arguments never participate in this three-line feasibility decision.
function packMandatory(fields, usable, lines = []) {
  if (fields.length === 0) return lines;
  const [field, ...rest] = fields;
  for (let i = 0; i <= lines.length && i < 3; i++) {
    const candidate = i < lines.length ? `${lines[i]}; ${field}` : field;
    if (displayWidth(candidate) > usable) continue;
    const next = [...lines];
    next[i] = candidate;
    const packed = packMandatory(rest, usable, next);
    if (packed) return packed;
  }
  return null;
}

function wrapContent(text, usable) {
  const lines = [];
  let line = "", width = 0;
  for (const ch of text) {
    const size = displayWidth(ch);
    if (width + size > usable) { lines.push(line); line = ""; width = 0; }
    line += ch;
    width += size;
  }
  lines.push(line);
  return lines;
}

function renderApprovalMessage(tool, args, { terminalWidth = 80, ttlMs = 120000, firstLine = "Approval required", selection, serverLabel } = {}) {
  if (typeof tool !== "string" || tool.length === 0) {
    return { ok: false, reason: "tool name is not a non-empty string" };
  }
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, reason: "arguments must be an explicitly supplied object" };
  }
  const usable = terminalWidth - WIDTH_MARGIN;
  if (usable < 20) return { ok: false, reason: `terminal width ${terminalWidth} leaves no usable message width` };

  let argLines;
  try {
    const names = Object.keys(args).sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    argLines = names.length === 0
      ? ["  (none)"]
      : names.map((name) => `  ${renderName(name)}: ${renderValue(args[name])}`);
  } catch (error) {
    return { ok: false, reason: `arguments have no canonical rendering: ${error.message}` };
  }

  const scopeLine = `Scope: ${SCOPE_RULE}; ${formatTtl(ttlMs)}.`;
  const routed = serverLabel !== undefined;
  const mandatory = routed ? packMandatory([
    `Tool: ${renderName(tool)}`,
    escapeDisplay(firstLine),
    renderServerLabel(serverLabel),
    scopeLine,
  ], usable) : null;
  if (routed && !mandatory) {
    return { ok: false, reason: `mandatory approval fields do not fit within three lines of ${usable} columns; interactive approval is refused rather than truncated` };
  }
  const parts = routed
    ? [...mandatory, ...argLines.flatMap((line) => wrapContent(line, usable)), ...wrapContent(OUTSIDE_LINE, usable)]
    : [`Tool: ${renderName(tool)}; ${escapeDisplay(firstLine)}`, ...argLines, scopeLine, OUTSIDE_LINE];
  if (selection) {
    // Explicitly wrap the explanatory suffix before measuring the final text.
    // Keep every character, including spaces. Standalone rendering retains
    // its word-based envelope; routed content can wrap within a long word.
    const suffix = `Selection predicate: ${escapeDisplay(selection.label)} (${escapeDisplay(selection.detail)})`;
    if (routed) parts.push(...wrapContent(suffix, usable));
    else {
      let line = "";
      for (const word of suffix.match(/\S+\s*/g) || []) {
        if (line && displayWidth(line + word) > usable) { parts.push(line); line = ""; }
        line += word;
      }
      parts.push(line);
    }
  }
  const message = parts.join("\n");
  const lines = message.split("\n");

  for (const line of lines) {
    if (displayWidth(line) > usable) {
      return { ok: false, reason: `a line does not fit ${usable} columns and truncation would hide the effect: ${line.slice(0, 40)}…` };
    }
  }
  const physicalLineCount = message.split("\n").length;
  if (!routed && physicalLineCount > MESSAGE_LINE_CAP) {
    return {
      ok: false,
      reason: `the complete effect, scope and outside-Seal line need ${physicalLineCount} lines; Seal permits ${MESSAGE_LINE_CAP}; interactive approval is refused rather than truncated`,
    };
  }
  return { ok: true, message, lines, argLines, scopeLine, outsideLine: OUTSIDE_LINE };
}

// Route presentation is measured inside the same rendering/refusal budget.
// Quote and escape every non-ASCII code unit, including invisible/bidi characters;
// preserve the complete configured key rather than hiding a distinguishing suffix.
function renderServerLabel(serverName) {
  const label = typeof serverName === "string" && serverName.trim().length > 0
    ? JSON.stringify(serverName).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`)
    : "unknown";
  return `Server (configured route, identity not authenticated): ${label}`;
}

module.exports = { renderApprovalMessage, renderServerLabel, MESSAGE_LINE_CAP, WIDTH_MARGIN, displayWidth, renderName };
