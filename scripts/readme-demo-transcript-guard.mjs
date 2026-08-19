#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Compare the README's demo Output fences with a transcript from a real run.
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const README = process.env.SEAL_DEMO_README ?? resolve(ROOT, "README.md");
const TRANSCRIPT = process.env.SEAL_DEMO_TRANSCRIPT;

function fail(reason) {
  console.error(`FAIL  ${reason}`);
  process.exit(1);
}

if (!TRANSCRIPT) fail("ABSENT_TRANSCRIPT: set SEAL_DEMO_TRANSCRIPT to a transcript path");
let transcriptStat;
try {
  transcriptStat = statSync(TRANSCRIPT);
} catch (error) {
  if (error.code === "ENOENT") fail(`ABSENT_TRANSCRIPT: ${TRANSCRIPT}`);
  fail(`UNREADABLE_TRANSCRIPT: ${TRANSCRIPT}: ${error.message}`);
}
if (!transcriptStat.isFile() || (transcriptStat.mode & 0o444) === 0) {
  fail(`UNREADABLE_TRANSCRIPT: ${TRANSCRIPT}`);
}

let transcript;
try {
  transcript = readFileSync(TRANSCRIPT, "utf8");
} catch (error) {
  fail(`UNREADABLE_TRANSCRIPT: ${TRANSCRIPT}: ${error.message}`);
}
if (transcript.length === 0) fail(`EMPTY_TRANSCRIPT: ${TRANSCRIPT}`);

let readme;
try {
  readme = readFileSync(README, "utf8");
} catch (error) {
  fail(`UNREADABLE_README: ${README}: ${error.message}`);
}

const demoStart = readme.indexOf("## 2. Demo");
const demoEnd = readme.indexOf("### Repository transcript instrumentation", demoStart);
if (demoStart === -1 || demoEnd === -1) fail("README demo section is missing or has no boundary");
const demo = readme.slice(demoStart, demoEnd);
const fences = [...demo.matchAll(/\*\*Output:\*\*\s*\n```text\n([\s\S]*?)\n```/g)]
  .map((match) => match[1]);
if (fences.length === 0) fail("README has no demo Output fences");

function stable(text) {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .replace(/\/(?:home|tmp)\/[^\s)"']+/g, "<volatile-path>")
    .replace(/receipt-\d+-\d+-\d+-[A-Z_]+\.json/g, "receipt-<volatile>.json")
    .replace(/\n+/g, "\n");
}

const actual = stable(transcript);
let checked = 0;
for (const fence of fences) {
  for (const rawLine of stable(fence).split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    if (line.trim().startsWith("<!--") || line.trim().endsWith("-->")) continue;
    checked += 1;
    if (!actual.includes(line)) fail(`MISSING_DEMO_OUTPUT: ${rawLine}`);
  }
}

console.log(`PASS  README demo Output fences match transcript (${fences.length} fences, ${checked} stable lines)`);
