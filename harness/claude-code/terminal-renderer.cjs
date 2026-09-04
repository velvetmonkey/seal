#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// This renderer is deliberately small. It renders any retained scrollback
// followed by the last visible frame from an asciinema v2 cast. It redacts
// named session identifier shapes, but it does not otherwise sanitise a cast.
//
// LIMIT: the rendered transcript loses timing, cursor movement, colour,
// non-ASCII glyph fidelity, and the ability to replay with asciinema. It is
// not equivalent to the raw recording. A line repainted before it scrolls off
// emits only its final cells once. Non-ASCII cells become '?' so the public
// file is ASCII plus LF.
const { createHash } = require("node:crypto");
const fs = require("node:fs");

// The identity is derived from every renderer source byte. A source edit must
// therefore move the identity without a separate human version choice.
function rendererIdentity(source) {
  return `seal-terminal-renderer/js-screen-sha256-${createHash("sha256").update(source).digest("hex")}`;
}
const RENDERER_IDENTITY = rendererIdentity(fs.readFileSync(__filename));
// The result name covers both layouts that the renderer derives from the cast.
// It does not claim that a transcript has scrollback when its count is zero.
const RENDERER_RESULT = "rendered-terminal-state";
const SESSION_URL = /claude\.ai\/code\/session_[A-Za-z0-9_-]+/giu;
const SESSION_ID = /\bsession_[A-Za-z0-9_-]+\b/giu;
// Match the displayed UUID text shape. Do not infer an RFC version or variant.
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
const INTERNAL_SESSION_URL = "\u{f0000}";
const INTERNAL_SESSION_ID = "\u{f0001}";
const REDACTIONS = [
  { pattern: SESSION_URL, marker: INTERNAL_SESSION_URL },
  { pattern: SESSION_ID, marker: INTERNAL_SESSION_ID },
  { pattern: UUID, marker: INTERNAL_SESSION_ID },
];

// Redact decoded printable text before terminal controls place it into rows.
// CSI cursor operations do not split this text layer. Line controls do split it.
function redactOperations(operations) {
  let decoded = "";
  const decodedToOperation = [];
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (operation.type === "text") {
      decoded += operation.value;
      for (let unit = 0; unit < operation.value.length; unit += 1) decodedToOperation.push(index);
    } else if (["lf", "cr", "bs", "ht"].includes(operation.type)) {
      decoded += "\n";
      decodedToOperation.push(null);
    }
  }

  const occupied = new Set();
  for (const { pattern, marker } of REDACTIONS) {
    pattern.lastIndex = 0;
    for (const match of decoded.matchAll(pattern)) {
      const positions = [];
      for (let offset = match.index; offset < match.index + match[0].length; offset += 1) {
        const operationIndex = decodedToOperation[offset];
        if (operationIndex !== null && !positions.includes(operationIndex)) positions.push(operationIndex);
      }
      if (positions.length === 0 || positions.some((position) => occupied.has(position))) continue;
      operations[positions[0]].value = marker;
      for (const position of positions.slice(1)) operations[position].value = "";
      for (const position of positions) occupied.add(position);
    }
  }
  return operations;
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

class Screen {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.cells = Array.from({ length: height }, () => Array(width).fill(" "));
    this.scrollback = [];
    this.x = 0;
    this.y = 0;
    this.saved = { x: 0, y: 0 };
    this.scrollTop = 0;
    this.scrollBottom = height - 1;
    this.state = "text";
    this.csi = "";
    this.osc = "";
  }

  clearLine(y, from = 0, to = this.width - 1) {
    for (let x = Math.max(0, from); x <= Math.min(this.width - 1, to); x += 1) this.cells[y][x] = " ";
  }

  clearScreen() {
    for (let y = 0; y < this.height; y += 1) this.clearLine(y);
  }

  scrollUp(count = 1) {
    for (let step = 0; step < count; step += 1) {
      this.scrollback.push(this.cells[this.scrollTop]);
      this.cells.splice(this.scrollTop, 1);
      this.cells.splice(this.scrollBottom, 0, Array(this.width).fill(" "));
    }
  }

  scrollDown(count = 1) {
    for (let step = 0; step < count; step += 1) {
      this.cells.splice(this.scrollBottom, 1);
      this.cells.splice(this.scrollTop, 0, Array(this.width).fill(" "));
    }
  }

  lineFeed() {
    if (this.y === this.scrollBottom) this.scrollUp();
    else if (this.y < this.height - 1) this.y += 1;
  }

  put(char) {
    if (this.x >= this.width) {
      this.x = 0;
      this.lineFeed();
    }
    this.cells[this.y][this.x] = char;
    this.x += 1;
  }

  params(csi = this.csi) {
    const parameters = csi.slice(0, -1);
    return parameters.replace(/^[>?]*/u, "").split(";").map((part) => Number(part || 0));
  }

  csiCommand(command, csi = this.csi) {
    const values = this.params(csi);
    const first = values[0] || 1;
    switch (command) {
      case "A": this.y = Math.max(0, this.y - first); break;
      case "B": case "e": this.y = Math.min(this.height - 1, this.y + first); break;
      case "C": case "a": this.x = Math.min(this.width, this.x + first); break;
      case "D": this.x = Math.max(0, this.x - first); break;
      case "E": this.y = Math.min(this.height - 1, this.y + first); this.x = 0; break;
      case "F": this.y = Math.max(0, this.y - first); this.x = 0; break;
      case "G": case "`": this.x = Math.max(0, Math.min(this.width, first - 1)); break;
      case "d": this.y = Math.max(0, Math.min(this.height - 1, first - 1)); break;
      case "H": case "f": this.y = Math.max(0, Math.min(this.height - 1, (values[0] || 1) - 1)); this.x = Math.max(0, Math.min(this.width, (values[1] || 1) - 1)); break;
      case "J": if ((values[0] || 0) === 2 || (values[0] || 0) === 3) this.clearScreen(); else if ((values[0] || 0) === 0) this.clearLine(this.y, this.x); else { for (let y = 0; y < this.y; y += 1) this.clearLine(y); this.clearLine(this.y, 0, this.x); } break;
      case "K": if ((values[0] || 0) === 2) this.clearLine(this.y); else if ((values[0] || 0) === 1) this.clearLine(this.y, 0, this.x); else this.clearLine(this.y, this.x); break;
      case "X": this.clearLine(this.y, this.x, this.x + first - 1); break;
      case "P": { const count = Math.min(first, this.width - this.x); this.cells[this.y].splice(this.x, count); this.cells[this.y].push(...Array(count).fill(" ")); break; }
      case "@": { const count = Math.min(first, this.width - this.x); this.cells[this.y].splice(this.x, 0, ...Array(count).fill(" ")); this.cells[this.y].splice(this.width, count); break; }
      case "s": this.saved = { x: this.x, y: this.y }; break;
      case "u": this.x = this.saved.x; this.y = this.saved.y; break;
      case "r": {
        const top = (values[0] || 1) - 1;
        const bottom = (values[1] || this.height) - 1;
        if (top >= 0 && bottom < this.height && top < bottom) {
          this.scrollTop = top;
          this.scrollBottom = bottom;
          this.x = 0;
          this.y = 0;
        }
        break;
      }
      case "S": this.scrollUp(first); break;
      case "T": this.scrollDown(first); break;
      case "h": case "l": break;
      case "m": break;
      // Handled CSI: A B e C a D E F G ` d H f J K X P @ r S T s u.
      // Ignored CSI final bytes are unsupported rendering operations. CSI c
      // requests device attributes. CSI q changes cursor style. CSI m changes
      // attributes only. Private-mode h/l is ignored because the copied real
      // casts contain no modes 47, 1047, or 1049. Other private modes are not
      // needed to preserve their text on these casts.
      default: break;
    }
  }

  feed(text) {
    const operations = [];
    for (const char of text) {
      const code = char.codePointAt(0);
      if (this.state === "osc") {
        if (char === "\u0007") { this.state = "text"; this.osc = ""; }
        else if (char === "\u001b") this.state = "osc-st";
        else if (code >= 0x20 && code !== 0x7f) this.osc += char;
        continue;
      }
      if (this.state === "osc-st") {
        this.state = char === "\\" ? "text" : "osc";
        this.osc = "";
        continue;
      }
      if (this.state === "csi") {
        this.csi += char;
        if (code >= 0x40 && code <= 0x7e) {
          operations.push({ type: "csi", command: char, csi: this.csi });
          this.state = "text";
          this.csi = "";
        }
        continue;
      }
      if (this.state === "escape") {
        // Handled ESC: [, ], 7, and 8. Ignored ESC: every other final byte.
        if (char === "[") { this.state = "csi"; this.csi = ""; }
        else if (char === "]") { this.state = "osc"; this.osc = ""; }
        else if (char === "7") { operations.push({ type: "save" }); this.state = "text"; }
        else if (char === "8") { operations.push({ type: "restore" }); this.state = "text"; }
        else this.state = "text";
        continue;
      }
      if (char === "\u001b") { this.state = "escape"; continue; }
      if (code === 0x9b) { this.state = "csi"; this.csi = ""; continue; }
      if (code === 0x9d) { this.state = "osc"; this.osc = ""; continue; }
      if (code === 0x0a) { operations.push({ type: "lf" }); continue; }
      if (code === 0x0d) { operations.push({ type: "cr" }); continue; }
      if (code === 0x08) { operations.push({ type: "bs" }); continue; }
      if (code === 0x09) { operations.push({ type: "ht" }); continue; }
      // Handled C0: LF, CR, BS, and HT. Ignored C0/C1: every other control.
      if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
      operations.push({ type: "text", value: char });
    }
    if (this.state === "escape") this.state = "text";
    for (const operation of redactOperations(operations)) {
      if (operation.type === "text") {
        if (operation.value) this.put(operation.value);
      } else if (operation.type === "csi") this.csiCommand(operation.command, operation.csi);
      else if (operation.type === "save") this.saved = { x: this.x, y: this.y };
      else if (operation.type === "restore") { this.x = this.saved.x; this.y = this.saved.y; }
      else if (operation.type === "lf") this.lineFeed();
      else if (operation.type === "cr") this.x = 0;
      else if (operation.type === "bs") this.x = Math.max(0, this.x - 1);
      else if (operation.type === "ht") this.x = Math.min(this.width, this.x + (8 - (this.x % 8)));
    }
  }

  text() {
    return [...this.scrollback, ...this.cells]
      .map((line) => line.join("").replace(/[ ]+$/u, ""))
      .join("\n");
  }
}

function parseScreen(castPath) {
  const lines = fs.readFileSync(castPath, "utf8").split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) throw new Error("cast is empty");
  const header = JSON.parse(lines[0]);
  const screen = new Screen(number(header.width, 80), number(header.height, 24));
  let payload = "";
  for (const line of lines.slice(1)) {
    const event = JSON.parse(line);
    if (Array.isArray(event) && event[1] === "o") payload += String(event[2] ?? "");
  }
  screen.feed(payload);
  return screen;
}

function parseCast(castPath) {
  return parseScreen(castPath).text()
    .replaceAll(INTERNAL_SESSION_URL, "[REDACTED-SESSION-URL]")
    .replaceAll(INTERNAL_SESSION_ID, "[REDACTED-SESSION-ID]");
}

// Read displayed terminal-output history rather than terminal state. Unlike
// parseCast, this retains a completed paint which was later overwritten in
// place. The pending paint is a Screen: this keeps the history erasure rules
// identical to Screen.csiCommand. In particular EL only clears cells at or
// after the cursor, while ECH and DCH clear/delete cells at the cursor.
// Thus `x\b` is not evidence for `x`, while a completed dialog remains evidence
// after a later screen clear. Cursor-only CSI commands do not break history,
// because a TUI can paint one displayed dialog at several cursor addresses.
function rawCastOutputText(castPath) {
  const lines = fs.readFileSync(castPath, "utf8").split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) throw new Error("cast is empty");
  JSON.parse(lines[0]);
  const header = JSON.parse(lines[0]);
  let output = "";
  for (const line of lines.slice(1)) {
    const event = JSON.parse(line);
    if (Array.isArray(event) && event[1] === "o") output += String(event[2] ?? "");
  }
  const screen = new Screen(Number(header.width) || 80, Number(header.height) || 24);
  const history = [];
  const dirty = Array.from({ length: screen.height }, () => Array(screen.width).fill(false));
  let state = "text";
  let csi = "";

  const commit = () => {
    for (let y = 0; y < screen.height; y += 1) {
      const row = dirty[y];
      const first = row.indexOf(true);
      if (first === -1) continue;
      const last = row.lastIndexOf(true);
      history.push(screen.cells[y].slice(first, last + 1).join(""));
      row.fill(false);
    }
  };
  const clearDirty = (y, from, to) => {
    for (let x = Math.max(0, from); x <= Math.min(screen.width - 1, to); x += 1) dirty[y][x] = false;
  };
  const scrollUp = (count = 1) => {
    for (let step = 0; step < count; step += 1) {
      dirty.splice(screen.scrollTop, 1);
      dirty.splice(screen.scrollBottom, 0, Array(screen.width).fill(false));
    }
    screen.scrollUp(count);
  };
  const scrollDown = (count = 1) => {
    for (let step = 0; step < count; step += 1) {
      dirty.splice(screen.scrollBottom, 1);
      dirty.splice(screen.scrollTop, 0, Array(screen.width).fill(false));
    }
    screen.scrollDown(count);
  };
  const lineFeed = () => {
    if (screen.y === screen.scrollBottom) scrollUp();
    else if (screen.y < screen.height - 1) screen.y += 1;
  };
  const csiCommand = (command) => {
    const values = screen.params(csi);
    const first = values[0] || 1;
    if (command === "J") {
      if ((values[0] || 0) === 2 || (values[0] || 0) === 3) for (const row of dirty) row.fill(false);
      else if ((values[0] || 0) === 0) clearDirty(screen.y, screen.x, screen.width - 1);
      else { for (let y = 0; y < screen.y; y += 1) dirty[y].fill(false); clearDirty(screen.y, 0, screen.x); }
    } else if (command === "K") {
      if ((values[0] || 0) === 2) dirty[screen.y].fill(false);
      else if ((values[0] || 0) === 1) clearDirty(screen.y, 0, screen.x);
      else clearDirty(screen.y, screen.x, screen.width - 1);
    } else if (command === "X") clearDirty(screen.y, screen.x, screen.x + first - 1);
    else if (command === "P") {
      const count = Math.min(first, screen.width - screen.x);
      dirty[screen.y].splice(screen.x, count);
      dirty[screen.y].push(...Array(count).fill(false));
    } else if (command === "@") {
      const count = Math.min(first, screen.width - screen.x);
      dirty[screen.y].splice(screen.x, 0, ...Array(count).fill(false));
      dirty[screen.y].splice(screen.width, count);
    }
    if (command === "S") scrollUp(first);
    else if (command === "T") scrollDown(first);
    else screen.csiCommand(command, csi);
  };
  for (const char of output) {
    const code = char.codePointAt(0);
    if (state === "osc") {
      if (char === "\u0007") state = "text";
      else if (char === "\u001b") state = "osc-st";
      continue;
    }
    if (state === "osc-st") {
      state = char === "\\" ? "text" : "osc";
      continue;
    }
    if (state === "csi") {
      csi += char;
      if (code >= 0x40 && code <= 0x7e) {
        csiCommand(char);
        state = "text";
        csi = "";
      }
      continue;
    }
    if (state === "escape") {
      if (char === "[") { state = "csi"; csi = ""; }
      else if (char === "]") state = "osc";
      else if (char === "7") { screen.saved = { x: screen.x, y: screen.y }; state = "text"; }
      else if (char === "8") { screen.x = screen.saved.x; screen.y = screen.saved.y; state = "text"; }
      else state = "text";
      continue;
    }
    if (char === "\u001b") { state = "escape"; continue; }
    if (code === 0x9b) { state = "csi"; csi = ""; continue; }
    if (code === 0x9d) { state = "osc"; continue; }
    if (code === 0x08) { screen.x = Math.max(0, screen.x - 1); dirty[screen.y][screen.x] = false; continue; }
    if (code === 0x0a) { commit(); history.push("\n"); lineFeed(); continue; }
    if (code === 0x0d) { commit(); screen.x = 0; continue; }
    if (code === 0x09) { screen.x = Math.min(screen.width, screen.x + (8 - (screen.x % 8))); continue; }
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
    if (screen.x >= screen.width) { screen.x = 0; lineFeed(); }
    screen.put(char);
    dirty[screen.y][Math.max(0, screen.x - 1)] = true;
  }
  commit();
  return history.join("")
    .replace(SESSION_URL, "[REDACTED-SESSION-URL]")
    .replace(SESSION_ID, "[REDACTED-SESSION-ID]")
    .replace(UUID, "[REDACTED-SESSION-ID]");
}

function renderCast(castPath) {
  const screen = parseScreen(castPath);
  const visible = screen.text()
    .replaceAll(INTERNAL_SESSION_URL, "[REDACTED-SESSION-URL]")
    .replaceAll(INTERNAL_SESSION_ID, "[REDACTED-SESSION-ID]")
    .replace(SESSION_URL, "[REDACTED-SESSION-URL]")
    .replace(SESSION_ID, "[REDACTED-SESSION-ID]")
    .replace(UUID, "[REDACTED-SESSION-ID]")
    .replace(/[^\x09\x0A\x20-\x7E]/gu, "?");
  const header = screen.scrollback.length === 0
    ? "This file holds the terminal's LAST VISIBLE FRAME. It has 0 scrollback lines."
    : `This file holds ${screen.scrollback.length} scrollback ${screen.scrollback.length === 1 ? "line" : "lines"} PLUS the terminal's LAST VISIBLE FRAME.`;
  return `${header} Content that the terminal overwrote before it scrolled is not present. This is NOT a record of the whole session. It is derived from the raw recording ${require("node:path").basename(castPath)}.\n${visible}\n`;
}

module.exports = { RENDERER_IDENTITY, RENDERER_RESULT, parseCast, rawCastOutputText, renderCast, rendererIdentity };
