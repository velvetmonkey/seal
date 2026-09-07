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

const sectionStart = readme.indexOf("## What you should see");
const capture = sectionStart === -1 ? null : readme.slice(sectionStart).match(/```text\n([\s\S]*?)\n```/);
if (!capture) fail("PROOF_FENCE_ABSENT: README has no four-line visual proof");
const expectedProof = [
  "before approval: 0 calls",
  "after approval:  1 call",
  "after replay:    1 call - refused",
  "outside Seal:    effect succeeded, 0 Seal decisions",
].join("\n");
if (capture[1] !== expectedProof) fail("PROOF_MISMATCH: README four-line visual proof changed");

function stable(text) {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .replace(/\/(?:home|tmp|var)\/[^\s)"']+/g, "<volatile-path>")
    .replace(/receipt-\d+-\d+-\d+-[A-Z_]+\.json/g, "receipt-<volatile>.json")
    .replace(/\n+/g, "\n");
}

const actual = stable(`${transcript}\n${checkerTranscript}`);
for (const [label, pattern] of [
  ["before approval: 0 calls", /child calls observed: 0/],
  ["after approval: 1 call", /child calls observed: 1/],
  ["after replay: 1 call - refused", /BLOCKED[\s\S]*verdict BLOCK[\s\S]*child calls observed: still 1/],
  ["outside Seal: effect succeeded, 0 Seal decisions", /OUTSIDE THE SEAL PATH[\s\S]*File changed: yes[\s\S]*New Seal decisions: 0/],
]) {
  if (!pattern.test(actual)) fail(`MISSING_DEMO_EVIDENCE: ${label}`);
}

console.log("PASS  README four-line proof agrees with the demo transcript");
