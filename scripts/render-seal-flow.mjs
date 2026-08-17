#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Deterministically render the public process diagram from its stable SVG
// layout, replacing the claim-bearing labels as a single generated surface.
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "assets/seal-flow.svg");
const LAYOUT_SOURCE = "fe9216f1d18c9df1c2ffdcfbd28cf67ee2b467fa:assets/seal-flow.svg";
const replacements = [
  ["Two other tools from the same server bypass Seal and never touch the real resource.", "Two other tools from the protected server are not approval-gated, but pass through Seal's forwarding checks."],
  ["MCP server with one guarded and two unprotected tools", "Protected MCP server with one guarded and two not-approval-gated tools"],
  [">UNPROTECTED.</text>\n    <text x=\"1428\" y=\"404\" text-anchor=\"middle\" class=\"small\">never sees Seal</text>", ">NOT APPROVAL-GATED.</text>\n    <text x=\"1428\" y=\"404\" text-anchor=\"middle\" class=\"small\">passes through Seal</text>"],
  [">UNPROTECTED.</text>\n    <text x=\"1428\" y=\"524\" text-anchor=\"middle\" class=\"small\">never sees Seal</text>", ">NOT APPROVAL-GATED.</text>\n    <text x=\"1428\" y=\"524\" text-anchor=\"middle\" class=\"small\">passes through Seal</text>"],
  ["<!-- Two unprotected paths leave Agent, stay below Seal, and rise into grey bars. -->\n  <path d=\"M166 368c37 0 56 6 56 43v198c0 24 12 35 39 35h1278c27 0 36-11 36-36V336h-63\" class=\"muted\" marker-end=\"url(#arrow-muted)\"/>\n  <path d=\"M166 392c21 0 31 12 31 39v171c0 21 13 31 36 31h1306c27 0 36-11 36-36V455h-63\" class=\"muted\" marker-end=\"url(#arrow-muted)\"/>", "<!-- Other protected-server calls bypass approval, not Seal: they enter the proxy and pass its forwarding checks. -->\n  <path d=\"M166 368c37 0 56 6 56 43v38c0 24 12 35 39 35h209\" class=\"muted\" marker-end=\"url(#arrow-muted)\"/>\n  <path d=\"M497 484h680v-148h142\" class=\"muted\" marker-end=\"url(#arrow-muted)\"/>\n  <path d=\"M166 392c21 0 31 12 31 39v100c0 21 13 31 36 31h239\" class=\"muted\" marker-end=\"url(#arrow-muted)\"/>\n  <path d=\"M497 562h680v-107h142\" class=\"muted\" marker-end=\"url(#arrow-muted)\"/>"],
  [">UNPROTECTED PATH</text>\n    <text x=\"315\" y=\"792\" class=\"small\">(never touches Seal)</text>", ">NOT APPROVAL-GATED</text>\n    <text x=\"315\" y=\"792\" class=\"small\">(through Seal)</text>"],
];

// Start from the reviewed layout, never from a hand-edited rendered file.
// This also makes regeneration restore the artifact after a local tamper.
let svg = execFileSync("git", ["show", LAYOUT_SOURCE], { cwd: root, encoding: "utf8" });
for (const [from, to] of replacements) svg = svg.replaceAll(from, to);
writeFileSync(target, svg);
