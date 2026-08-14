// SPDX-License-Identifier: Apache-2.0
// The approval-message renderer, built to the MEASURED Claude Code dialog
// envelope (/home/monkey/elicitfit-report.md, client 2.1.232 at 80x24):
//   - 8 message lines render, the 9th is hidden with no indicator, no key
//     scrolls the message, blank lines count;
//   - usable width is terminal width minus 4 columns;
//   - schema field titles consume vertical lines (so callers keep schemas
//     title-free).
// This renderer targets SEVEN lines — one under the observed cap — and
// REFUSES rather than truncates: a boundary the terminal hides is not
// stated, so an effect whose exact arguments cannot be shown completely
// inside the envelope is never offered for interactive approval.
const { canonicalString } = require("./canonical.cjs");

const MESSAGE_LINE_CAP = 7;
const WIDTH_MARGIN = 4;

// Conservative display width: printable ASCII counts 1, everything else 2.
// Canonical JSON has already escaped control characters, so nothing here is
// invisible. The measured report warns Unicode display width can exceed byte
// length; counting 2 keeps us inside the envelope rather than guessing.
function displayWidth(text) {
  let width = 0;
  for (const ch of text) width += ch.codePointAt(0) <= 0x7e && ch.codePointAt(0) >= 0x20 ? 1 : 2;
  return width;
}

function wrap(text, usable, continuationIndent) {
  const lines = [];
  let current = "";
  let currentWidth = 0;
  const indentWidth = displayWidth(continuationIndent);
  for (const ch of text) {
    const w = ch.codePointAt(0) <= 0x7e && ch.codePointAt(0) >= 0x20 ? 1 : 2;
    const limit = lines.length === 0 ? usable : usable - indentWidth;
    if (currentWidth + w > limit) {
      lines.push(current);
      current = "";
      currentWidth = 0;
    }
    current += ch;
    currentWidth += w;
  }
  lines.push(current);
  return lines.map((line, index) => (index === 0 ? line : continuationIndent + line));
}

// Renders the complete approval message: what is approved (tool + exact
// arguments), the one-use scope, and the outside-Seal boundary. Returns
// { ok: true, message, lines } or { ok: false, reason }.
function renderApprovalMessage(tool, args, { terminalWidth = 80 } = {}) {
  if (typeof tool !== "string" || tool.length === 0) {
    return { ok: false, reason: "tool name is not a non-empty string" };
  }
  const usable = terminalWidth - WIDTH_MARGIN;
  if (usable < 20) return { ok: false, reason: `terminal width ${terminalWidth} leaves no usable message width` };

  let argsText;
  try {
    argsText = canonicalString(args ?? {});
  } catch (error) {
    return { ok: false, reason: `arguments have no canonical rendering: ${error.message}` };
  }

  const scopeLine = "Approve exactly this call, once. It cannot be reused.";
  const boundaryLine = "Other routes to the same system are outside Seal.";
  const toolLine = `tool  ${tool}`;
  for (const fixed of [scopeLine, boundaryLine, toolLine]) {
    if (displayWidth(fixed) > usable) {
      return { ok: false, reason: `a required line does not fit ${usable} columns: ${fixed.slice(0, 40)}…` };
    }
  }

  const argsLines = wrap(`args  ${argsText}`, usable, "      ");
  const lines = [scopeLine, toolLine, ...argsLines, boundaryLine];
  if (lines.length > MESSAGE_LINE_CAP) {
    return {
      ok: false,
      reason: `the exact arguments need ${lines.length} lines; the envelope shows ${MESSAGE_LINE_CAP} and hides the rest without any indicator`,
    };
  }
  return { ok: true, message: lines.join("\n"), lines };
}

module.exports = { renderApprovalMessage, MESSAGE_LINE_CAP, WIDTH_MARGIN, displayWidth };
