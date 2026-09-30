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
// Explicit code-point ceiling, with headroom for the 100,187-character retry
// case. 200,000 matches that test’s apparatus size, not a client width promise.
const MESSAGE_CHARACTER_CAP = 200000;
const CONTEXT_CHARACTER_CAP = 160;
const SCOPE_RULE = "this parsed call (key order, 1/1.0 match); at most one run";
const OUTSIDE_LINE = "Outside Seal: Bash, network, subprocesses, other tools and servers.";
const JSON_SCALAR = /^(?:null|true|false|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)$/;
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

// Escape Unicode controls, format characters, unassigned code points and
// default-ignorables, plus line separators.
// Join controls and variation selectors remain literal for Persian, Indic,
// emoji and ideographic shaping. Decide membership by Unicode property,
// including marks that would otherwise qualify for an unquoted name.
// Untrusted status metadata disables shaping preservation to escape all ignorables.
const SHAPING = /[\u200c\u200d\p{Variation_Selector}]/u;
const INVISIBLE = /(?![\u200c\u200d\p{Variation_Selector}])[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Cc}\p{Cn}\p{Zl}\p{Zp}]/u;
function escapeInvisible(text, { preserveShaping = true } = {}) {
  return Array.from(text, (ch) => INVISIBLE.test(ch) || (!preserveShaping && SHAPING.test(ch))
    ? ch.split("").map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")
    : ch).join("");
}

function renderName(name) {
  // Keep single-script names bare; resolve Script_Extensions with UTS #39
  // Han augmentations, and visibly escape non-ASCII points when mixed.
  const bare = /^[\p{L}\p{M}\p{N}\u200c\u200d_.\/@-]+$/u.test(name);
  renderName.scripts ??= `Adlm Aghb Ahom Arab Armi Armn Avst Bali Bamu Bass Batk Beng Bhks Bopo Brah Brai Bugi Buhd Cakm Cans Cari Cham Cher Chrs Copt Cpmn Cprt Cyrl Deva Diak Dogr Dsrt Dupl Egyp Elba Elym Ethi Gara Geor Glag Gong Gonm Goth Gran Grek Gujr Gukh Guru Hang Hani Hano Hatr Hebr Hira Hluw Hmng Hmnp Hrkt Hung Ital Java Kali Kana Kawi Khar Khmr Khoj Kits Knda Krai Kthi Lana Laoo Latn Lepc Limb Lina Linb Lisu Lyci Lydi Mahj Maka Mand Mani Marc Medf Mend Merc Mero Mlym Modi Mong Mroo Mtei Mult Mymr Nagm Nand Narb Nbat Newa Nkoo Nshu Ogam Olck Onao Orkh Orya Osge Osma Ougr Palm Pauc Perm Phag Phli Phlp Phnx Plrd Prti Rjng Rohg Runr Samr Sarb Saur Sgnw Shaw Shrd Sidd Sind Sinh Sogd Sogo Sora Soyo Sund Sunu Sylo Syrc Tagb Takr Tale Talu Taml Tang Tavt Telu Tfng Tglg Thaa Thai Tibt Tirh Tnsa Todr Toto Tutg Ugar Vaii Vith Wara Wcho Xpeo Xsux Yezi Yiii Zanb`
    .split(' ').flatMap((script) => {
      try { return [[script, new RegExp(`\\p{Script_Extensions=${script}}`, 'u')]]; }
      catch { return []; } // A newer Unicode script may be absent on Node 20.
    });
  renderName.scriptCache ??= new Map();
  let resolved;
  for (const ch of name) {
    if (!/\p{L}/u.test(ch)) continue;
    let scripts = renderName.scriptCache.get(ch);
    if (!scripts) {
      scripts = new Set();
      for (const [script, pattern] of renderName.scripts) {
        if (pattern.test(ch)) scripts.add(script);
      }
      if (scripts.has('Hani')) for (const script of ['Jpan', 'Kore', 'Hanb']) scripts.add(script);
      if (['Hira', 'Kana', 'Hrkt'].some((script) => scripts.has(script))) scripts.add('Jpan');
      if (scripts.has('Hang')) scripts.add('Kore');
      if (scripts.has('Bopo')) scripts.add('Hanb');
      if (renderName.scriptCache.size >= 2048) renderName.scriptCache.clear();
      renderName.scriptCache.set(ch, scripts);
    }
    // A Common or Inherited letter absent from the supported script list
    // contributes no script evidence. An unlisted concrete script still breaks
    // the intersection so it cannot hide a mixed-script name.
    if (scripts.size === 0 && /[\p{Script=Common}\p{Script=Inherited}]/u.test(ch)) continue;
    resolved = resolved === undefined ? scripts : new Set([...resolved].filter((script) => scripts.has(script)));
    if (resolved.size === 0) break;
  }
  const mixed = resolved?.size === 0;
  if (!mixed && bare && !INVISIBLE.test(name)) return name;
  const quoted = escapeInvisible(JSON.stringify(name));
  return mixed
    ? quoted.replace(/[^\x00-\x7f]/gu, (ch) =>
      ch.split('').map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''))
    : quoted;
}

function measureApprovalMessage(message) {
  const lines = message.split(/\r\n|[\n\r\u0085\u2028\u2029]/u);
  const characters = Array.from(message).length;
  if (characters > MESSAGE_CHARACTER_CAP) {
    return { ok: false, reason: `the complete approval needs ${characters} characters; Seal permits ${MESSAGE_CHARACTER_CAP}` };
  }
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
  return measureArgumentLayout(lines);
}

// Fold only complete, already escaped argument entries. The envelope counts
// logical lines and code points, never an assumed client width. Keep separate
// lines when they fit; join adjacent entries only to make room for mandatory
// scope, boundary, route and selection context, then measure the final text.
function measureArgumentLayout(lines) {
  while (lines.length > MESSAGE_LINE_CAP) {
    const index = lines.findIndex((line, i) => line.startsWith("  ") &&
      lines[i + 1]?.startsWith("  "));
    if (index < 0) break;
    lines.splice(index, 2, `${lines[index]}; ${lines[index + 1].slice(2)}`);
  }
  return measureApprovalMessage(lines.join("\n"));
}

function renderApprovalMessage(tool, args, { ttlMs = 120000, firstLine = "Approval required", selection, serverId } = {}) {
  if (typeof tool !== "string" || tool.length === 0) {
    return { ok: false, reason: "tool name is not a non-empty string" };
  }
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, reason: "arguments must be an explicitly supplied object" };
  }
  let argLines;
  try {
    const names = Object.keys(args).sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    argLines = names.length === 0
      ? ["  (none)"]
      : names.map((name) => `  ${renderName(name)}: ${renderValue(args[name])}`);
  } catch (error) {
    return { ok: false, reason: `arguments have no canonical rendering: ${error.message}` };
  }

  let routeLine;
  if (serverId !== undefined && serverId !== null) {
    if (typeof serverId !== "string" || serverId.length === 0) {
      return { ok: false, reason: "configured server route is not a non-empty string" };
    }
    // This is display context, not a client-authenticated identity. It is a
    // first-class line in the universal envelope: it must fit before Seal can
    // offer an approval, and any later selection context uses the same folding
    // and refusal path over the complete message.
    routeLine = `Route (configured, not authenticated): ${renderName(serverId)}`;
  }
  const scopeLine = `Scope: ${SCOPE_RULE}; ${formatTtl(ttlMs)}.`;
  const lines = [`Tool: ${renderName(tool)}; ${escapeInvisible(firstLine)}`, ...argLines, scopeLine, OUTSIDE_LINE];
  if (routeLine) lines.push(routeLine);

  let measured = measureArgumentLayout(lines);
  if (!measured.ok) return measured;
  if (selection) {
    const label = selection.label.startsWith(tool)
      ? renderName(tool) + selection.label.slice(tool.length) : selection.label;
    measured = appendApprovalContext(measured.message,
      `Selection predicate: ${label} (${selection.detail})`);
    if (!measured.ok) return measured;
  }
  return { ...measured, argLines, scopeLine, outsideLine: OUTSIDE_LINE };
}

// Legacy conservative width estimate; admission uses the logical envelope above.
const WIDTH_MARGIN = 6;
function displayWidth(text) {
  let width = 0;
  for (const ch of text) width += ch.codePointAt(0) <= 0x7e && ch.codePointAt(0) >= 0x20 ? 1 : 2;
  return width;
}

module.exports = { WIDTH_MARGIN, displayWidth, renderApprovalMessage, measureApprovalMessage, appendApprovalContext, renderName, escapeInvisible, MESSAGE_LINE_CAP, MESSAGE_CHARACTER_CAP, CONTEXT_CHARACTER_CAP };
