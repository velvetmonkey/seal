#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Deterministically render the public process diagram from its stable SVG
// layout, replacing the claim-bearing labels as a single generated surface.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "docs/seal-flow.svg");
const layoutSource = resolve(root, "scripts/seal-flow-layout.svg");
const replacements = [
  ['viewBox="0 0 1775 887"', 'width="1775" height="970" viewBox="0 0 1775 970"'],
  ['<rect width="1775" height="887" fill="#f7f1e5"/>', '<rect width="1775" height="970" fill="#f7f1e5"/>'],
  ["Two other tools from the same server bypass Seal and never touch the real resource.", "Two other tools from the protected server are not approval-gated, but pass through Seal's forwarding checks."],
  ["MCP server with one guarded and two unprotected tools", "Protected MCP server with one guarded and two not-approval-gated tools"],
  [">UNPROTECTED.</text>\n    <text x=\"1428\" y=\"404\" text-anchor=\"middle\" class=\"small\">never sees Seal</text>", ">NOT APPROVAL-GATED.</text>\n    <text x=\"1428\" y=\"404\" text-anchor=\"middle\" class=\"small\">passes through Seal</text>"],
  [">UNPROTECTED.</text>\n    <text x=\"1428\" y=\"524\" text-anchor=\"middle\" class=\"small\">never sees Seal</text>", ">NOT APPROVAL-GATED.</text>\n    <text x=\"1428\" y=\"524\" text-anchor=\"middle\" class=\"small\">passes through Seal</text>"],
  ["<!-- Two unprotected paths leave Agent, stay below Seal, and rise into grey bars. -->\n  <path d=\"M166 368c37 0 56 6 56 43v198c0 24 12 35 39 35h1278c27 0 36-11 36-36V336h-63\" class=\"muted\" marker-end=\"url(#arrow-muted)\"/>\n  <path d=\"M166 392c21 0 31 12 31 39v171c0 21 13 31 36 31h1306c27 0 36-11 36-36V455h-63\" class=\"muted\" marker-end=\"url(#arrow-muted)\"/>", "<!-- Other protected-server calls bypass approval, not Seal: they enter the proxy and pass its forwarding checks. -->\n  <path d=\"M166 368c37 0 56 6 56 43v38c0 24 12 35 39 35h209\" class=\"muted\" marker-end=\"url(#arrow-muted)\"/>\n  <path d=\"M497 484h680v-148h142\" class=\"muted\" marker-end=\"url(#arrow-muted)\"/>\n  <path d=\"M166 392c21 0 31 12 31 39v100c0 21 13 31 36 31h239\" class=\"muted\" marker-end=\"url(#arrow-muted)\"/>\n  <path d=\"M497 562h680v-107h142\" class=\"muted\" marker-end=\"url(#arrow-muted)\"/>"],
  [">UNPROTECTED PATH</text>\n    <text x=\"315\" y=\"792\" class=\"small\">(never touches Seal)</text>", ">NOT APPROVAL-GATED</text>\n    <text x=\"315\" y=\"792\" class=\"small\">(through Seal)</text>"],
  [
    `  <!-- AGENT -->
  <g aria-label="Agent terminal">
    <rect x="38" y="245" width="128" height="158" rx="8" class="ink"/>
    <path d="M38 273h128" class="ink"/>
    <circle cx="55" cy="260" r="3" class="ink"/>
    <circle cx="70" cy="260" r="3" class="ink"/>
    <circle cx="85" cy="260" r="3" class="ink"/>
    <text x="102" y="310" text-anchor="middle" class="h2">AGENT</text>
    <text x="102" y="341" text-anchor="middle" class="body">Claude Code</text>
    <path d="M61 359l13 12-13 12M82 384h19" class="ink"/>
  </g>

  <!-- Protected wire enters config, then Seal. -->
  <path d="M166 327h96" class="accent" marker-end="url(#arrow-accent)"/>`,
    `  <!-- AGENT: global box padding is at least 16px; icon geometry is 75% of base. -->
  <g aria-label="Agent terminal">
    <rect data-padding="16" x="28" y="235" width="158" height="178" rx="8" class="ink"/>
    <g data-icon="agent-terminal" transform="translate(102 324) scale(.75) translate(-102 -324)">
      <path d="M38 273h128" class="ink"/>
      <circle cx="55" cy="260" r="3" class="ink"/>
      <circle cx="70" cy="260" r="3" class="ink"/>
      <circle cx="85" cy="260" r="3" class="ink"/>
      <path d="M61 359l13 12-13 12M82 384h19" class="ink"/>
    </g>
    <text x="107" y="310" text-anchor="middle" class="h2">AGENT</text>
    <text x="107" y="341" text-anchor="middle" class="body">Claude Code</text>
  </g>

  <!-- Protected wire enters config, then Seal. -->
  <path d="M186 327h35" class="accent" marker-end="url(#arrow-accent)"/>`,
  ],
  [
    `  <!-- CONFIG -->
  <g aria-label="Configuration pinned at protect time">
    <rect x="271" y="40" width="161" height="539" rx="8" class="ink"/>
    <text x="351" y="78" text-anchor="middle" class="h2">CONFIG</text>
    <text x="351" y="106" text-anchor="middle" class="body">pinned at</text>
    <text x="351" y="127" text-anchor="middle" class="body">protect time</text>

    <path d="M286 147h18l10 10v29h-28zM304 147v10h10" class="ink"/>
    <text x="321" y="175" class="body">.mcp.json</text>
    <text x="316" y="202" class="small">Seal read it</text>
    <text x="316" y="220" class="small">and hashed it.</text>
    <text x="316" y="238" class="small">never edits it</text>

    <path d="M286 260h18l10 10v29h-28zM304 260v10h10" class="ink"/>
    <text x="321" y="287" class="small">~/.claude.json</text>
    <text x="316" y="313" class="small">Claude Code</text>
    <text x="316" y="331" class="small">wrote the</text>
    <text x="316" y="349" class="small">override.</text>
    <text x="316" y="367" class="small">Seal asked</text>

    <path d="M284 390h136" class="ink" stroke-dasharray="8 8"/>
    <text x="351" y="420" text-anchor="middle" class="label">DRIFT</text>
    <text x="351" y="445" text-anchor="middle" class="small">entry no longer</text>
    <text x="351" y="463" text-anchor="middle" class="small">matches the</text>
    <text x="351" y="481" text-anchor="middle" class="small">recorded hash</text>
    <text x="351" y="504" text-anchor="middle" class="small">-&gt; <tspan class="accent-text">REFUSE</tspan></text>
    <path d="M321 519c0 21 13 31 51 31" class="accent" stroke-dasharray="8 7" marker-end="url(#arrow-accent)"/>
    <path d="M382 539l22 22M404 539l-22 22" class="accent"/>
  </g>
  <path d="M432 327h55" class="accent" marker-end="url(#arrow-accent)"/>`,
    `  <!-- CONFIG: global box padding is at least 16px; file icon is 28x39 -> 21x29. -->
  <g aria-label="Configuration and Claude Code local-scope override">
    <rect data-padding="16" x="230" y="25" width="250" height="620" rx="8" class="ink"/>
    <text x="355" y="63" text-anchor="middle" class="h2">CONFIG</text>
    <text x="355" y="92" text-anchor="middle" class="small">claude mcp add</text>
    <text x="355" y="111" text-anchor="middle" class="small">installs same-name</text>
    <text x="355" y="130" text-anchor="middle" class="small">local entry;</text>
    <text x="355" y="149" text-anchor="middle" class="small">shadows project</text>
    <text x="355" y="168" text-anchor="middle" class="small">after restart</text>

    <path data-icon="project-config-file" d="M250 184h14l7 7v22h-21zM264 184v7h7" class="ink"/>
    <text x="286" y="202" class="body">.mcp.json</text>
    <text x="286" y="228" class="small">read only;</text>
    <text x="286" y="247" class="small">never modified</text>

    <path d="M250 276h210" class="ink" stroke-dasharray="8 8"/>
    <text x="355" y="313" text-anchor="middle" class="label">DRIFT</text>
    <text x="355" y="342" text-anchor="middle" class="small">project server entry</text>
    <text x="355" y="361" text-anchor="middle" class="small">differs from its</text>
    <text x="355" y="380" text-anchor="middle" class="small">recorded digest</text>
    <text x="355" y="414" text-anchor="middle" class="small">-&gt; FORWARDING</text>
    <text x="355" y="435" text-anchor="middle" class="label accent-text">REFUSED</text>
    <path d="M272 478c0 18 13 27 47 27" class="accent" stroke-dasharray="8 7" marker-end="url(#arrow-accent)"/>
    <path d="M374 489l24 24M398 489l-24 24" class="accent"/>
  </g>
  <path d="M480 327h21" class="accent" marker-end="url(#arrow-accent)"/>`,
  ],
  ['<rect x="497" y="39" width="680" height="539" rx="12" class="ink"/>', '<rect data-padding="16" x="510" y="25" width="690" height="620" rx="12" class="ink"/>'],
  ['<text x="520" y="79" class="h1">SEAL</text>', '<text x="535" y="79" class="h1">SEAL</text>'],
  ['<text x="520" y="107" class="body">one tool of one server</text>', '<text x="535" y="107" class="body">one tool of one server</text>'],
  ['<text x="1249" y="318" text-anchor="middle" class="small">through</text>', '<text x="1249" y="315" text-anchor="middle" class="small">through</text>'],
  ['<path d="M487 331h37" class="accent" marker-end="url(#arrow-accent)"/>', '<path d="M501 331h23" class="accent" marker-end="url(#arrow-accent)"/>'],
  [
    `<path d="M530 250v165M542 250v165M603 250v165M615 250v165" class="ink"/>
    <circle cx="572" cy="316" r="10" class="ink"/>
    <path d="M555 347c1-17 8-26 17-26s16 9 17 26z" class="ink"/>`,
    `<g data-icon="gate" transform="translate(572 331) scale(.75) translate(-572 -331)">
      <path d="M530 250v165M542 250v165M603 250v165M615 250v165" class="ink"/>
      <circle cx="572" cy="316" r="10" class="ink"/>
      <path d="M555 347c1-17 8-26 17-26s16 9 17 26z" class="ink"/>
    </g>`,
  ],
  [
    `<path d="M708 269h75l32 62-32 68h-75l-31-68z" class="ink"/>
    <text x="746" y="321" text-anchor="middle" class="label">KERNEL</text>
    <!-- Anchor glyph, deliberately neutral and distinct from a pin/Venus symbol. -->
    <circle cx="746" cy="339" r="6" class="ink"/>
    <path d="M746 345v27M731 357h30M731 358c0 17 30 17 30 0M736 372h20" class="ink"/>`,
    `<g data-icon="kernel" transform="translate(746 334) scale(.75) translate(-746 -334)">
      <path d="M708 269h75l32 62-32 68h-75l-31-68z" class="ink"/>
      <text x="746" y="321" text-anchor="middle" class="label">KERNEL</text>
      <!-- Anchor glyph, deliberately neutral and distinct from a pin/Venus symbol. -->
      <circle cx="746" cy="339" r="6" class="ink"/>
      <path d="M746 345v27M731 357h30M731 358c0 17 30 17 30 0M736 372h20" class="ink"/>
    </g>`,
  ],
  [
    `<circle cx="885" cy="331" r="21" class="ink"/>
    <text x="885" y="339" text-anchor="middle" class="label">0</text>
    <path d="M909 331h23" class="ink" marker-end="url(#arrow-ink)"/>
    <circle cx="959" cy="331" r="21" class="ink"/>
    <text x="959" y="339" text-anchor="middle" class="label">1</text>`,
    `<g data-icon="one-use" transform="translate(922 331) scale(.75) translate(-922 -331)">
      <circle cx="885" cy="331" r="21" class="ink"/>
      <text x="885" y="339" text-anchor="middle" class="label">0</text>
      <path d="M909 331h23" class="ink" marker-end="url(#arrow-ink)"/>
      <circle cx="959" cy="331" r="21" class="ink"/>
      <text x="959" y="339" text-anchor="middle" class="label">1</text>
    </g>`,
  ],
  [
    `<path d="M1038 257h76l24 24v137h-100zM1114 257v24h24" class="ink"/>
    <text x="1088" y="320" text-anchor="middle" class="label">RECEIPT</text>
    <path d="M1055 342h63M1055 359h46M1055 376h27" class="ink"/>
    <!-- Neutral wax seal: no approval tick. -->
    <path d="M1094 386l7-6 8 2 7-2 7 6 2 8 5 6-3 8 1 8-7 5-4 8-9-1-7 4-7-6-8-2-3-8-5-6 3-8-1-8z" class="accent"/>
    <circle cx="1108" cy="404" r="14" fill="#a23e22"/>`,
    `<g data-icon="receipt" transform="translate(1088 338) scale(.75) translate(-1088 -338)">
      <path d="M1038 257h76l24 24v137h-100zM1114 257v24h24" class="ink"/>
      <text x="1088" y="320" text-anchor="middle" class="label">RECEIPT</text>
      <path d="M1055 342h63M1055 359h46M1055 376h27" class="ink"/>
      <!-- Neutral wax seal: no approval tick. -->
      <path d="M1094 386l7-6 8 2 7-2 7 6 2 8 5 6-3 8 1 8-7 5-4 8-9-1-7 4-7-6-8-2-3-8-5-6 3-8-1-8z" class="accent"/>
      <circle cx="1108" cy="404" r="14" fill="#a23e22"/>
    </g>`,
  ],
  ['<rect x="1328" y="130" width="199" height="422" rx="8" class="ink"/>', '<rect data-padding="16" x="1310" y="112" width="235" height="482" rx="8" class="ink"/>'],
  ['<rect x="1344" y="188" width="168" height="39" fill="#a23e22"/>', '<rect data-padding="16" x="1330" y="180" width="195" height="55" fill="#a23e22"/>'],
  ['<rect x="1344" y="316" width="168" height="41" fill="#66645f" fill-opacity="0.12"/>', '<rect data-padding="16" x="1330" y="306" width="195" height="61" fill="#66645f" fill-opacity="0.12"/>'],
  ['<rect x="1344" y="434" width="168" height="42" fill="#66645f" fill-opacity="0.12"/>', '<rect data-padding="16" x="1330" y="424" width="195" height="62" fill="#66645f" fill-opacity="0.12"/>'],
  [
    `    <!-- STORE -->
    <path d="M1003 494c0-7 9-11 20-11s20 4 20 11v34c0 7-9 11-20 11s-20-4-20-11z" class="ink"/>
    <path d="M1003 494c0 7 9 11 20 11s20-4 20-11M1003 511c0 7 9 11 20 11s20-4 20-11" class="ink"/>
    <text x="1053" y="513" class="label">STORE</text>
    <text x="1053" y="535" class="tiny">~/.local/share/seal</text>
    <path d="M1086 419v57h-43" class="ink" marker-end="url(#arrow-ink)"/>`,
    `    <!-- STORE: database icon is 40x56 -> 30x42. -->
    <g data-icon="store" transform="translate(1023 511) scale(.75) translate(-1023 -511)">
      <path d="M1003 494c0-7 9-11 20-11s20 4 20 11v34c0 7-9 11-20 11s-20-4-20-11z" class="ink"/>
      <path d="M1003 494c0 7 9 11 20 11s20-4 20-11M1003 511c0 7 9 11 20 11s20-4 20-11" class="ink"/>
    </g>
    <text x="1055" y="503" class="label">STORE</text>
    <text x="1055" y="525" class="tiny">~/.local/share/seal</text>
    <path d="M1086 419v47h-52" class="ink" marker-end="url(#arrow-ink)"/>`,
  ],
  ['<text x="793" y="515" text-anchor="middle" class="label accent-text">REPLAY REFUSED</text>', '<text x="793" y="535" text-anchor="middle" class="label accent-text">REPLAY REFUSED</text>'],
  [
    `<path d="M1637 274c0-8 14-13 32-13s32 5 32 13v51c0 8-14 13-32 13s-32-5-32-13z" class="ink"/>
    <path d="M1637 274c0 8 14 13 32 13s32-5 32-13M1637 300c0 8 14 13 32 13s32-5 32-13" class="ink"/>`,
    `<g data-icon="real-effect" transform="translate(1669 300) scale(.75) translate(-1669 -300)">
      <path d="M1637 274c0-8 14-13 32-13s32 5 32 13v51c0 8-14 13-32 13s-32-5-32-13z" class="ink"/>
      <path d="M1637 274c0 8 14 13 32 13s32-5 32-13M1637 300c0 8 14 13 32 13s32-5 32-13" class="ink"/>
    </g>`,
  ],
  [
    `  <!-- Other protected-server calls bypass approval, not Seal: they enter the proxy and pass its forwarding checks. -->
  <path d="M166 368c37 0 56 6 56 43v38c0 24 12 35 39 35h209" class="muted" marker-end="url(#arrow-muted)"/>
  <path d="M497 484h680v-148h142" class="muted" marker-end="url(#arrow-muted)"/>
  <path d="M166 392c21 0 31 12 31 39v100c0 21 13 31 36 31h239" class="muted" marker-end="url(#arrow-muted)"/>
  <path d="M497 562h680v-107h142" class="muted" marker-end="url(#arrow-muted)"/>`,
    `  <!-- Other protected-server calls bypass approval, not Seal. The 40px corridor exceeds the 16px clearance invariant. -->
  <path data-clearance="16" d="M186 368c27 0 35 12 35 39v138c0 27 12 40 39 40h241" class="muted" marker-end="url(#arrow-muted)"/>
  <path data-clearance="16" d="M510 585h690c17 0 25-8 25-25V336h65" class="muted" marker-end="url(#arrow-muted)"/>
  <path data-clearance="16" d="M186 392c17 0 23 12 23 39v144c0 27 12 40 39 40h253" class="muted" marker-end="url(#arrow-muted)"/>
  <path data-clearance="16" d="M510 615h715c17 0 25-8 25-25V455h40" class="muted" marker-end="url(#arrow-muted)"/>`,
  ],
  ['<path d="M970 579v50c0 15-7 24-22 24h-75v22" class="ink" marker-end="url(#arrow-ink)"/>', '<path d="M970 646v63c0 15-7 24-22 24h-75v16" class="ink" marker-end="url(#arrow-ink)"/>'],
  ['<rect x="820" y="681" width="107" height="85" rx="6" class="ink"/>', '<rect data-padding="16" x="778" y="749" width="190" height="130" rx="6" class="ink"/>'],
  ['<path d="M820 704h107" class="ink"/>', '<path d="M798 779h150" class="ink"/>'],
  ['<circle cx="834" cy="692" r="2" class="ink"/>\n    <circle cx="844" cy="692" r="2" class="ink"/>\n    <circle cx="854" cy="692" r="2" class="ink"/>\n    <path d="M846 723l13 12-13 12M867 748h17" class="ink"/>', '<g data-icon="verify-terminal" transform="translate(852 720) scale(.75) translate(-852 -720) translate(0 50)">\n      <circle cx="834" cy="692" r="2" class="ink"/>\n      <circle cx="844" cy="692" r="2" class="ink"/>\n      <circle cx="854" cy="692" r="2" class="ink"/>\n      <path d="M846 723l13 12-13 12M867 748h17" class="ink"/>\n    </g>'],
  ['<text x="874" y="798" text-anchor="middle" class="label">seal verify</text>', '<text x="873" y="805" text-anchor="middle" class="label">seal verify</text>'],
  ['<text x="874" y="825" text-anchor="middle" class="small">local re-derivation</text>', '<text x="873" y="834" text-anchor="middle" class="small">local re-derivation</text>'],
  ['<path d="M1068 579v50c0 15 7 24 22 24h49v22" class="ink" marker-end="url(#arrow-ink)"/>', '<path d="M1068 646v63c0 15 7 24 22 24h49v16" class="ink" marker-end="url(#arrow-ink)"/>'],
  ['<rect x="1090" y="681" width="105" height="85" rx="6" class="ink"/>', '<rect data-padding="16" x="1048" y="749" width="190" height="130" rx="6" class="ink"/>'],
  ['<path d="M1090 704h105" class="ink"/>', '<path d="M1068 779h150" class="ink"/>'],
  ['<circle cx="1103" cy="692" r="2" class="ink"/>\n    <circle cx="1113" cy="692" r="2" class="ink"/>\n    <circle cx="1123" cy="692" r="2" class="ink"/>\n    <circle cx="1142" cy="736" r="22" class="ink"/>\n    <path d="M1120 736h44M1142 714c10 12 10 32 0 44M1142 714c-10 12-10 32 0 44" class="ink"/>', '<g data-icon="check-browser" transform="translate(1142 720) scale(.75) translate(-1142 -720) translate(0 50)">\n      <circle cx="1103" cy="692" r="2" class="ink"/>\n      <circle cx="1113" cy="692" r="2" class="ink"/>\n      <circle cx="1123" cy="692" r="2" class="ink"/>\n      <circle cx="1142" cy="736" r="22" class="ink"/>\n      <path d="M1120 736h44M1142 714c10 12 10 32 0 44M1142 714c-10 12-10 32 0 44" class="ink"/>\n    </g>'],
  ['<text x="1143" y="798" text-anchor="middle" class="label">seal-check</text>', '<text x="1143" y="805" text-anchor="middle" class="label">seal-check</text>'],
  ['<text x="1143" y="823" text-anchor="middle" class="small">browser.</text>', '<text x="1143" y="829" text-anchor="middle" class="small">browser.</text>'],
  ['<text x="1143" y="843" text-anchor="middle" class="small">paste a receipt</text>', '<text x="1143" y="849" text-anchor="middle" class="small">paste a receipt</text>'],
  ['<path d="M42 725h75" class="accent" marker-end="url(#arrow-accent)"/>', '<path d="M42 800h75" class="accent" marker-end="url(#arrow-accent)"/>'],
  ['<text x="136" y="734" class="label">PROTECTED PATH</text>', '<text x="136" y="809" class="label">PROTECTED PATH</text>'],
  ['<text x="281" y="734" class="small">(through Seal)</text>', '<text x="295" y="809" class="small">(through Seal)</text>'],
  ['<path d="M42 783h75" class="muted" marker-end="url(#arrow-muted)"/>', '<path d="M42 858h75" class="muted" marker-end="url(#arrow-muted)"/>'],
  ['<text x="136" y="792" class="label">NOT APPROVAL-GATED</text>', '<text x="136" y="867" class="label">NOT APPROVAL-GATED</text>'],
  ['<text x="315" y="792" class="small">(through Seal)</text>', '<text x="335" y="867" class="small">(through Seal)</text>'],
];

// Start from the committed reviewed layout, never from a hand-edited rendered
// file. Keeping this source in-tree makes regeneration work from any checkout,
// including shallow clones that do not contain historical Git objects.
let svg = readFileSync(layoutSource, "utf8");
for (const [from, to] of replacements) {
  if (!svg.includes(from)) throw new Error(`layout source no longer contains required fragment: ${from.slice(0, 80)}`);
  svg = svg.replaceAll(from, to);
}
writeFileSync(target, svg);
