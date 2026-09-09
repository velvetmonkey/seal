// SPDX-License-Identifier: Apache-2.0
// Claude Code 2.1.251 paints three message lines, then folds the rest, and
// separately paints the approve schema description. Put tool and argument
// values first; retain all six-line-body information, including both boundary
// lines, for clients that paint the whole message. The generic approval title
// shares the tool line: it does not earn a painted slot of its own.
//
// Keep the seven-line total budget: the recorded fold provides no evidence
// for increasing it. Folding two ceremony lines into the useful content frees
// two argument lines without increasing the logical-message-line budget.
// Clients own wrapping, folding and horizontal presentation, so this renderer
// cannot truthfully turn a terminal-width guess into a visible-row promise.
// Never truncate.
const { canonicalString } = require("./canonical.cjs");

const MESSAGE_LINE_CAP = 7;
const CONTEXT_CHARACTER_CAP = 160;
const SCOPE_RULE = "this parsed call (key order, 1/1.0 match); at most one run";
const OUTSIDE_LINE = "Outside Seal: Bash, network, subprocesses, other tools and servers.";
const JSON_SCALAR = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)$/;
const BARE_VALUE = /^[A-Za-z0-9_.\/:@-]+$/;

function formatTtl(ttlMs) {
  return ttlMs % 60000 === 0 ? `${ttlMs / 60000} min` : `${Math.round(ttlMs / 1000)} s`;
}

// A string value made of unambiguous characters renders bare, as in the
// addendum's example (`table: customers`); anything else renders as its
// canonical JSON with invisible characters escaped. JSON scalar spellings
// stay quoted so a string cannot look like a number, boolean or null.
function renderValue(value) {
  if (typeof value === "string" && BARE_VALUE.test(value) && !JSON_SCALAR.test(value)) return value;
  return escapeInvisible(canonicalString(value));
}

// Escape controls and separators, plus the exact Unicode bidi controls that
// can reorder the following text: ALM, LRM/RLM, embeddings, overrides and
// isolates. ZWNJ and ZWJ are deliberately not here: they shape Persian,
// Indic text and emoji without reordering or hiding their neighbours.
function escapeInvisible(text) {
  return text.replace(/[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/gu,
    (ch) => ch.split("").map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`).join(""));
}

function renderName(name) {
  // Quoting delimiters also distinguishes a literal backslash escape from
  // the escaped character, without quoting ordinary international names.
  return !/^[\p{L}\p{M}\p{N}\u200c\u200d_.\/@-]+$/u.test(name)
    ? escapeInvisible(JSON.stringify(name)) : name;
}

function measureApprovalMessage(message) {
  const lines = message.split(/\r\n|[\n\r\u0085\u2028\u2029]/u);
  if (lines.length > MESSAGE_LINE_CAP) {
    return { ok: false, reason: `the complete effect, scope and outside-Seal line need ${lines.length} lines; Seal permits ${MESSAGE_LINE_CAP}; interactive approval is refused rather than truncated` };
  }
  return { ok: true, message, lines };
}

// Compose the proxy's explanation before enforcing the same envelope. Its
// independently countable character cap keeps predicate prose bounded without
// claiming a client-specific width; every admitted character remains present.
function appendApprovalContext(message, context) {
  const escapedContext = escapeInvisible(context);
  if (Array.from(escapedContext).length > CONTEXT_CHARACTER_CAP) {
    return { ok: false, reason: `appended approval context needs ${Array.from(escapedContext).length} characters; Seal permits ${CONTEXT_CHARACTER_CAP}` };
  }
  const contextLines = escapedContext.split(/\r\n|[\n\r\u0085\u2028\u2029]/u);
  const lines = [...message.split("\n"), ...contextLines];
  while (lines.length > MESSAGE_LINE_CAP) {
    const index = lines.findIndex((line, i) => line.startsWith("  ") &&
      lines[i + 1]?.startsWith("  "));
    if (index < 0) break;
    lines.splice(index, 2, `${lines[index]}; ${lines[index + 1].slice(2)}`);
  }
  return measureApprovalMessage(lines.join("\n"));
}

function renderApprovalMessage(tool, args, { ttlMs = 120000, firstLine = "Approval required" } = {}) {
  if (typeof tool !== "string" || tool.length === 0) {
    return { ok: false, reason: "tool name is not a non-empty string" };
  }
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
  const lines = [`Tool: ${renderName(tool)}; ${firstLine}`, ...argLines, scopeLine, OUTSIDE_LINE];

  const measured = measureApprovalMessage(lines.join("\n"));
  if (!measured.ok) return measured;
  return { ...measured, argLines, scopeLine, outsideLine: OUTSIDE_LINE };
}

module.exports = { renderApprovalMessage, measureApprovalMessage, appendApprovalContext, renderName, escapeInvisible, MESSAGE_LINE_CAP, CONTEXT_CHARACTER_CAP };
