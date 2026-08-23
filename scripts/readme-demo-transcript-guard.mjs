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

const captureStart = readme.indexOf("This is real output from");
const capture = captureStart === -1 ? null : readme.slice(captureStart).match(/```text\n([\s\S]*?)\n```/);
if (!capture) fail("CAPTURE_FENCE_ABSENT: README has no terminal capture after its real-output label");
const fences = [capture[1]];

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
    if (line.startsWith("Approve? [y/N]")) continue;
    if (line.trim().startsWith("<!--") || line.trim().endsWith("-->")) continue;
    checked += 1;
    if (!actual.includes(line)) fail(`MISSING_DEMO_OUTPUT: ${rawLine}`);
  }
}

console.log(`PASS  README terminal capture matches transcript (${checked} stable lines)`);
