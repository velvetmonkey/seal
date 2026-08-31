#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// This renderer is deliberately small. It renders the last visible frame from
// an asciinema v2 cast. It redacts
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
// Real Claude Code recordings repaint in place. Their published transcript is
// the last visible frame. Synthetic casts still exercise the scroll model.
const RENDERER_RESULT = "last-visible-frame";
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
      // Handled CSI: A B e C a D E F G ` d H f J K P @ r S T s u.
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

function parseCast(castPath) {
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
  return screen.text()
    .replaceAll(INTERNAL_SESSION_URL, "[REDACTED-SESSION-URL]")
    .replaceAll(INTERNAL_SESSION_ID, "[REDACTED-SESSION-ID]");
}

function renderCast(castPath) {
  const visible = parseCast(castPath)
    .replace(SESSION_URL, "[REDACTED-SESSION-URL]")
    .replace(SESSION_ID, "[REDACTED-SESSION-ID]")
    .replace(UUID, "[REDACTED-SESSION-ID]")
    .replace(/[^\x09\x0A\x20-\x7E]/gu, "?");
  return `This is the LAST VISIBLE FRAME of a repainting terminal. Earlier content was overwritten rather than scrolled. This is NOT a record of the whole session. It is derived from the raw recording ${require("node:path").basename(castPath)}.\n${visible}\n`;
}

module.exports = { RENDERER_IDENTITY, RENDERER_RESULT, parseCast, renderCast, rendererIdentity };
