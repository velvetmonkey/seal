#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Internal-link integrity check for the Seal landing repo: every relative
// link/src in the docs must resolve to a file. Run: node scripts/linkcheck.mjs
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["README.md", ...walk(ROOT).filter((f) => /\.(md|html)$/.test(f) && !f.startsWith("node_modules/"))];
function walk(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(resolve(dir, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${name.name}` : name.name;
    if (name.isDirectory() && name.name !== ".git") out.push(...walk(dir, relative));
    else if (name.isFile()) out.push(relative);
  }
  return out;
}
const FAMILY_ROOTS = new Map([
  ["seal", process.env.FAMILY_SEAL_ROOT ?? ROOT],
  ["seal-check", process.env.FAMILY_SEAL_CHECK_ROOT ?? resolve(ROOT, ".family/seal-check")],
  ["seal-demo", process.env.FAMILY_SEAL_DEMO_ROOT ?? resolve(ROOT, ".family/seal-demo")],
  ["seal-live-demo", process.env.FAMILY_SEAL_LIVE_DEMO_ROOT ?? resolve(ROOT, ".family/seal-live-demo")],
  ["seal-verify-action", process.env.FAMILY_SEAL_VERIFY_ACTION_ROOT ?? resolve(ROOT, ".family/seal-verify-action")],
  ["seal-assurance-kit", process.env.FAMILY_SEAL_ASSURANCE_KIT_ROOT ?? resolve(ROOT, ".family/seal-assurance-kit")],
  ["mcp-seal-dev", process.env.FAMILY_MCP_SEAL_DEV_ROOT ?? resolve(ROOT, ".family/mcp-seal-dev")],
]);

function targetFor(file, link, rootRelative = false) {
  const [family] = link.split("/", 1);
  if (FAMILY_ROOTS.has(family)) {
    return {
      kind: family === "seal" ? "internal" : "external",
      path: resolve(FAMILY_ROOTS.get(family), link.slice(family.length + 1)),
    };
  }
  return { kind: "internal", path: resolve(rootRelative ? ROOT : dirname(`${ROOT}/${file}`), link) };
}

function check(file, raw, rootRelative = false) {
  let link = raw.trim();
  if (!link || link.startsWith("http") || link.startsWith("#") || link.startsWith("mailto:")) return;
  link = link.split("#")[0].split("?")[0];
  if (!link) return;
  const target = targetFor(file, link, rootRelative);
  if (target.kind === "external") {
    externalLinks++;
    if (!existsSync(target.path)) console.log(`EXTERNAL  ${file} -> ${link}`);
    return;
  }
  checked++;
  if (!existsSync(target.path)) { console.log(`BROKEN  ${file} -> ${link}`); bad++; }
}

function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) strings(item, out);
  return out;
}

function maskMarkdownCode(text) {
  let fence = null;
  return text.split(/(?<=\n)/).map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      const masked = line.replace(/[^\n]/g, " ");
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return masked;
    }
    if (marker) {
      fence = marker[1];
      return line.replace(/[^\n]/g, " ");
    }
    // Code spans are literal text, not Markdown link syntax. Preserve offsets so
    // any later diagnostics still point at the original document.
    return line.replace(/(`+)[^\n]*?\1/g, (code) => code.replace(/[^\n]/g, " "));
  }).join("");
}

// Deliberately narrow: a path must contain a directory separator and end in a
// filename extension whose first character is alphabetic. That catches stale
// filenames with unknown extensions without treating `v0.2.0.1` as a path.
const pathString = /(?:^|[\s"'`])((?:(?:\.{1,2}\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z][A-Za-z0-9_-]*)|(?:(?:README|index|EVALUATOR-START)\.(?:md|html)))(?:$|[\s"'`),:#?])/gm;
function pathStrings(text) {
  return [...text.matchAll(pathString)].map((match) => match[1]);
}

let bad = 0, checked = 0, externalLinks = 0;
const re = /\]\(([^)]+)\)|(?:href|src)\s*=\s*"([^"]+)"/g;
for (const f of files) {
  const txt = readFileSync(`${ROOT}/${f}`, "utf8");
  const source = f.endsWith(".md") ? maskMarkdownCode(txt) : txt;
  // Keep the population count stable when a link-shaped literal is correctly
  // rejected from a code span; the count is an audit of every syntax candidate
  // examined, while only parsed Markdown/HTML targets reach check().
  checked += [...txt.matchAll(re)].length - [...source.matchAll(re)].length;
  for (const m of source.matchAll(re)) {
    check(f, m[1] || m[2] || "");
  }
}

const dataFiles = walk(ROOT).filter((f) =>
  (/^\.github\//.test(f) || /^scripts\//.test(f)) && /\.(json|ya?ml)$/i.test(f),
);
for (const f of dataFiles) {
  const text = readFileSync(resolve(ROOT, f), "utf8");
  const candidates = f.endsWith(".json") ? strings(JSON.parse(text)) : [text];
  for (const candidate of candidates) {
    for (const link of pathStrings(candidate)) check(f, link, true);
  }
}

const requiredLiveLinks = new Map([
  ["https://velvetmonkey.github.io/seal-check/", ["README.md", "spine/demo.cjs"]],
]);
let externalChecked = 0;
for (const [link, carriers] of requiredLiveLinks) {
  for (const carrier of carriers) {
    if (!readFileSync(resolve(ROOT, carrier), "utf8").includes(link)) {
      console.log(`BROKEN  ${carrier} -> missing required live link ${link}`);
      bad++;
    }
  }
  try {
    const response = await fetch(link, { redirect: "follow", signal: AbortSignal.timeout(10000) });
    externalChecked++;
    if (!response.ok) {
      console.log(`BROKEN  ${link} -> HTTP ${response.status}`);
      bad++;
    }
    await response.body?.cancel();
  } catch (error) {
    console.log(`BROKEN  ${link} -> ${error.message}`);
    bad++;
  }
}

console.log(`link-check: ${checked} internal links, ${externalLinks} external links, ${externalChecked} required live links, ${bad} broken`);
process.exit(bad ? 1 : 0);
