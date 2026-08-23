#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// WCAG 2.1 contrast audit for docs/seal-flow.svg.
// Uses seal-check's committed method: extract the rendered palette, compute
// relative luminance, and audit an explicit inventory of foreground/background
// pairs at the applicable 4.5:1 normal-text threshold.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SVG = readFileSync(resolve(ROOT, "docs/seal-flow.svg"), "utf8");
const TOKENS = Object.create(null);
for (const match of SVG.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
  TOKENS[match[1]] = match[2];
}

function luminance(hex) {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function composite(foreground, background, alpha) {
  const channels = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  const fg = channels(foreground);
  const bg = channels(background);
  return "#" + fg.map((value, index) =>
    Math.round(value * alpha + bg[index] * (1 - alpha)).toString(16).padStart(2, "0"),
  ).join("");
}

TOKENS["muted-tint"] = composite(TOKENS.muted, TOKENS.bg, 0.12);

const PAIRS = [
  ["ink", "bg", "all charcoal labels and body text"],
  ["accent", "bg", "Seal, selected-path, replay, and refusal text"],
  ["muted", "bg", "unguarded-path, config, and outside-Seal text"],
  ["bg", "accent", "demo.mutate reversed label"],
  ["ink", "muted-tint", "db.read and fs.list labels on 12% grey tint"],
];
const MIN = 4.5;
let failed = 0;

console.log("foreground  background  ratio    min      result  where");
console.log("-".repeat(100));
for (const [foreground, background, where] of PAIRS) {
  if (!TOKENS[foreground] || !TOKENS[background]) {
    console.error(`ERROR missing SVG palette token: --${!TOKENS[foreground] ? foreground : background}`);
    process.exit(2);
  }
  const measured = ratio(TOKENS[foreground], TOKENS[background]);
  const pass = measured >= MIN;
  if (!pass) failed += 1;
  console.log(
    `${("--" + foreground).padEnd(11)} ${("--" + background).padEnd(11)} ` +
    `${(measured.toFixed(2) + ":1").padEnd(8)} ${(MIN.toFixed(1) + ":1").padEnd(8)} ` +
    `${(pass ? "PASS" : "FAIL").padEnd(7)} ${where}`,
  );
}
console.log("-".repeat(100));
console.log(`${PAIRS.length} pairs · ${PAIRS.length - failed} pass · ${failed} fail`);
process.exitCode = failed ? 1 : 0;
