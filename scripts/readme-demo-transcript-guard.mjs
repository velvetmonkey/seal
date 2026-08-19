#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Compare the README's demo Output fences with a transcript from a real run.
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const README = process.env.SEAL_DEMO_README ?? resolve(ROOT, "README.md");
const TRANSCRIPT = process.env.SEAL_DEMO_TRANSCRIPT;
const CHECKER_TRANSCRIPT = process.env.SEAL_DEMO_CHECKER_TRANSCRIPT;

function fail(reason) {
  console.error(`FAIL  ${reason}`);
  process.exit(1);
}

if (!TRANSCRIPT) fail("ABSENT_TRANSCRIPT: set SEAL_DEMO_TRANSCRIPT to a transcript path");
if (resolve(TRANSCRIPT) === resolve(README)) fail("SELF_REFERENCE_TRANSCRIPT: transcript must not be README.md");
function readTranscript(path, label) {
  let transcriptStat;
  try {
    transcriptStat = statSync(path);
  } catch (error) {
    if (error.code === "ENOENT") fail(`ABSENT_${label}: ${path}`);
    fail(`UNREADABLE_${label}: ${path}: ${error.message}`);
  }
  if (!transcriptStat.isFile() || (transcriptStat.mode & 0o444) === 0) {
    fail(`UNREADABLE_${label}: ${path}`);
  }
  let transcript;
  try {
    transcript = readFileSync(path, "utf8");
  } catch (error) {
    fail(`UNREADABLE_${label}: ${path}: ${error.message}`);
  }
  if (transcript.length === 0) fail(`EMPTY_${label}: ${path}`);
  return transcript;
}

const transcript = readTranscript(TRANSCRIPT, "TRANSCRIPT");
const checkerTranscript = CHECKER_TRANSCRIPT
  ? readTranscript(CHECKER_TRANSCRIPT, "CHECKER_TRANSCRIPT")
  : "";

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
const stepHeadings = [...demo.matchAll(/^### Step (\d+):.*$/gm)];
const outputSteps = new Set([1, 2, 3, 4, 5, 6, 7, 9, 10]);
for (const heading of stepHeadings) {
  const step = Number(heading[1]);
  if (!outputSteps.has(step)) continue;
  const start = heading.index;
  const next = stepHeadings.find((candidate) => candidate.index > start)?.index ?? demo.length;
  const section = demo.slice(start, next);
  if (!/\*\*Output:\*\*\s*\n```text\n[\s\S]*?\n```/.test(section)) {
    fail(`MISSING_OUTPUT_FENCE: Step ${step}`);
  }
}
const fences = [...demo.matchAll(/\*\*Output:\*\*\s*\n```text\n([\s\S]*?)\n```/g)]
  .map((match) => match[1]);
if (fences.length !== 9) fail(`OUTPUT_FENCE_COUNT: expected 9, found ${fences.length}`);

function stable(text) {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .replace(/\/(?:home|tmp)\/[^\s)"']+/g, "<volatile-path>")
    .replace(/receipt-\d+-\d+-\d+-[A-Z_]+\.json/g, "receipt-<volatile>.json")
    .replace(/\n+/g, "\n");
}

const actual = stable(`${transcript}\n${checkerTranscript}`);
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
