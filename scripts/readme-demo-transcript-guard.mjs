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

const fences = [...readme.matchAll(/<!-- Seal demo transcript -->\s*\n```text\n([\s\S]*?)\n```/g)]
  .map((match) => match[1]);
if (fences.length !== 3) fail(`OUTPUT_FENCE_COUNT: expected 3, found ${fences.length}`);

function stable(text) {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .replace(/^temporary demo directory:/gm, "demo directory:")
    .replace(/Approve\? \[y\/N\](?: y)?[ \n]*/g, "Approve? [y/N] ")
    .replace(/\/(?:private\/)?tmp\/seal-demo-[^\s)"']+/g, "<volatile-path>")
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
    if (!actual.includes(line)) fail(`MISSING_DEMO_OUTPUT: ${README}: ${rawLine}`);
  }
}

console.log(`PASS  README demo Output fences match transcript (${fences.length} fences, ${checked} stable lines)`);
