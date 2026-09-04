#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Scan shipped prose and CLI help for macOS Protect claims. This scanner
// detects a fixed set of word-pattern phrasings that connect testing evidence
// to affirmative claims or denials about macOS Protect execution. The platform
// table is the fact. Historical
// release notes remain historical records.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = resolve(process.env.SEAL_MACOS_PROTECT_CLAIMS_ROOT ?? resolve(import.meta.dirname, ".."));
const { protectPlatformSupported } = require(resolve(ROOT, "spine/platform.cjs"));
const SUPPORT = "supports Protect on Linux x86-64 and macOS x64/arm64";
const HISTORICAL_RELEASE_NOTE = /^docs\/assurance\/RELEASE-NOTES-v.+-rc\.\d+\.md$/u;
const FROZEN_GUIDE = "docs/guide/when-something-looks-wrong.md";
const TEXT_SUFFIX = /\.(?:md|html)$/u;
const failures = [];

function filesBelow(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(file));
    else if (entry.isFile() && TEXT_SUFFIX.test(entry.name)) files.push(file);
  }
  return files;
}

function shippedFiles() {
  const files = [resolve(ROOT, "README.md"), resolve(ROOT, "bin/seal"), resolve(ROOT, "scripts/claims-drift.mjs")];
  const notice = resolve(ROOT, "NOTICE");
  if (existsSync(notice)) files.push(notice);
  const docs = resolve(ROOT, "docs");
  if (existsSync(docs)) files.push(...filesBelow(docs));
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && /^RELEASE-NOTES-.*\.md$/u.test(entry.name)) files.push(resolve(ROOT, entry.name));
  }
  return [...new Set(files)].sort();
}

function claimBlocks(text) {
  return text.replace(/<[^>]+>/gu, " ").split(/\n\s*\n/gu)
    .map((block) => block.replace(/\s+/gu, " ").trim())
    .filter((block) => /macOS/iu.test(block) && /Protect/iu.test(block));
}

function contradictsSupportedFact(block) {
  return /Protect\s+(?:is|remains)\s+not\s+supported\s+on\s+macOS/iu.test(block)
    || /macOS[^.]{0,100}Protect[^.]{0,100}(?:not\s+supported|unsupported)/iu.test(block)
    || /Linux x86-64 is the supported Protect path/iu.test(block);
}

function contradictsUnsupportedFact(block) {
  return new RegExp(SUPPORT.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u").test(block);
}

function sentences(block) {
  return block.match(/[^.!?]+[.!?]+/gu) ?? [block];
}

function backsMacosProtectExecution(block) {
  return sentences(block).find((sentence) => {
    // This language guard detects a fixed set of word-pattern phrasings. It
    // does not detect every sentence that cites testing as backing for macOS
    // Protect execution. These sentences defeat this guard:
    // "macOS Protect is shown to execute by the Darwin integration test."
    // "The darwin-arm64 pipeline is the proof that Protect executes on macOS."
    // "CI success confirms that macOS Protect is operational."
    // A claim ledger would make this check real. See
    // docs/reference/receipt-operations.md and
    // scripts/receipt-operations-claims.mjs for the existing design.
    // The guard allows evidence for the platform table and helper readiness.
    const namesMacosProtect = /(?:macOS[^.!?]{0,120}Protect|Protect[^.!?]{0,120}macOS)/iu.test(sentence);
    const namesEvidenceSource = /\b(?:test(?:s|ed)?|check(?:s|ed)?|CI|job(?:s)?|workflow(?:s)?)\b/iu.test(sentence);
    const namesEvidenceRelationship = /\b(?:because|back(?:s|ed|ing)?|evidence|proof|demonstrat(?:e|es|ed|ing)|show(?:s|ed|ing)?|confirm(?:s|ed|ing)?|establish(?:es|ed|ing)?|verif(?:y|ies|ied|ying)|prove(?:s|d)?|pass(?:es|ed|ing)?)\b/iu.test(sentence);
    const namesExecution = /\b(?:execution|execute(?:s|d|ing)?|run(?:s|ning)?|work(?:s|ed|ing)?|function(?:s|al|ality)?|behavio(?:u)?r|live)\b/iu.test(sentence);
    const namesLegitimateNonExecutionSubject = /\b(?:platform\s+table|support\s+table|support\s+matrix|helper\s+readiness|helper\s+is\s+ready|readiness|source\s+portability|install|demo|receipt\s+checking)\b/iu.test(sentence);
    return namesMacosProtect && namesEvidenceSource && namesEvidenceRelationship
      && namesExecution && !namesLegitimateNonExecutionSubject;
  });
}

const darwinX64 = protectPlatformSupported("darwin", "x64");
const darwinArm64 = protectPlatformSupported("darwin", "arm64");
if (darwinX64 !== darwinArm64) failures.push(`platform table disagrees for darwin-x64 (${darwinX64}) and darwin-arm64 (${darwinArm64})`);

let currentClaimCount = 0;
let historicalClaimCount = 0;
for (const file of shippedFiles()) {
  const name = relative(ROOT, file);
  const blocks = claimBlocks(readFileSync(file, "utf8"));
  for (const [index, block] of blocks.entries()) {
    if (name !== FROZEN_GUIDE) {
      const backingSentence = backsMacosProtectExecution(block);
      if (backingSentence) {
        failures.push(`${name}#${index + 1} matches a known word-pattern phrasing that connects testing evidence to an affirmative claim or denial about macOS Protect execution: ${backingSentence.trim()}`);
      }
    }
    if (HISTORICAL_RELEASE_NOTE.test(name)) {
      historicalClaimCount += 1;
      console.log(`SKIP  ${name}#${index + 1} historical release claim`);
      continue;
    }
    currentClaimCount += 1;
    console.log(`SCAN  ${name}#${index + 1} ${block}`);
    if (darwinX64 && contradictsSupportedFact(block)) failures.push(`${name}#${index + 1} contradicts darwin Protect support: ${block}`);
    if (!darwinX64 && contradictsUnsupportedFact(block)) failures.push(`${name}#${index + 1} contradicts darwin Protect refusal: ${block}`);
  }
}

const install = readFileSync(resolve(ROOT, "docs/start/install.md"), "utf8");
const installSupportCount = install.split(SUPPORT).length - 1;
if (darwinX64 && installSupportCount !== 2) failures.push(`docs/start/install.md must state current macOS Protect support twice; found ${installSupportCount}`);
console.log(`COUNT current=${currentClaimCount} historical=${historicalClaimCount}`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL  ${failure}`);
  process.exitCode = 1;
} else {
  console.log("PASS  scanned macOS Protect claims match spine/platform.cjs");
}
