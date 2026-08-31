#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// This renderer is deliberately small. It renders terminal scrollback and the
// final visible screen from an asciinema v2 cast. It does not rewrite or
// sanitise a cast.
//
// LIMIT: the rendered transcript loses timing, cursor movement, colour,
// non-ASCII glyph fidelity, and the ability to replay with asciinema. It is
// not equivalent to the raw recording. A line repainted before it scrolls off
// emits only its final cells once. Non-ASCII cells become '?' so the public
// file is ASCII plus LF.
const fs = require("node:fs");

const RENDERER_IDENTITY = "seal-terminal-renderer/js-screen-v1";
const RENDERER_RESULT = "scrollback-and-final-visible-frame";
const SESSION_URL = /claude\.ai\/code\/session_[A-Za-z0-9_-]+/giu;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;

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

  lineFeed() {
    if (this.y < this.height - 1) this.y += 1;
    else {
      this.scrollback.push(this.cells.shift());
      this.cells.push(Array(this.width).fill(" "));
    }
  }

  put(char) {
    if (this.x >= this.width) {
      this.x = 0;
      this.lineFeed();
    }
    this.cells[this.y][this.x] = char;
    this.x += 1;
  }

  params() {
    const parameters = this.csi.slice(0, -1);
    return parameters.replace(/^[>?]*/u, "").split(";").map((part) => Number(part || 0));
  }

  csiCommand(command) {
    const values = this.params();
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
      case "h": case "l": break;
      case "m": break;
      // Handled CSI: A B e C a D E F G ` d H f J K P @ s u.
      // Ignored CSI: all other final bytes, including c, q, r, S, T, and
      // private-mode h/l. These sequences do not change the text grid here.
      default: break;
    }
  }

  feed(text) {
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
        if (code >= 0x40 && code <= 0x7e) { this.csiCommand(char); this.state = "text"; this.csi = ""; }
        continue;
      }
      if (this.state === "escape") {
        // Handled ESC: [, ], 7, and 8. Ignored ESC: every other final byte.
        if (char === "[") { this.state = "csi"; this.csi = ""; }
        else if (char === "]") { this.state = "osc"; this.osc = ""; }
        else if (char === "7") { this.saved = { x: this.x, y: this.y }; this.state = "text"; }
        else if (char === "8") { this.x = this.saved.x; this.y = this.saved.y; this.state = "text"; }
        else this.state = "text";
        continue;
      }
      if (char === "\u001b") { this.state = "escape"; continue; }
      if (code === 0x9b) { this.state = "csi"; this.csi = ""; continue; }
      if (code === 0x9d) { this.state = "osc"; this.osc = ""; continue; }
      if (code === 0x0a) { this.lineFeed(); continue; }
      if (code === 0x0d) { this.x = 0; continue; }
      if (code === 0x08) { this.x = Math.max(0, this.x - 1); continue; }
      if (code === 0x09) { this.x = Math.min(this.width, this.x + (8 - (this.x % 8))); continue; }
      // Handled C0: LF, CR, BS, and HT. Ignored C0/C1: every other control.
      if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
      this.put(char);
    }
    if (this.state === "escape") this.state = "text";
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
  for (const line of lines.slice(1)) {
    const event = JSON.parse(line);
    if (Array.isArray(event) && event[1] === "o") screen.feed(String(event[2] ?? ""));
  }
  return screen.text();
}

function renderCast(castPath) {
  const visible = parseCast(castPath)
    .replace(SESSION_URL, "[REDACTED-SESSION-URL]")
    .replace(UUID, "[REDACTED-SESSION-ID]")
    .replace(/[^\x09\x0A\x20-\x7E]/gu, "?");
  return `This is a rendered terminal transcript. It is derived from the raw recording ${require("node:path").basename(castPath)}.\n${visible}\n`;
}

module.exports = { RENDERER_IDENTITY, RENDERER_RESULT, parseCast, renderCast };
