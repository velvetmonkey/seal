// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';

const EXPECTED = {
  readme: 'README.md',
  umbrellaWorkflow: '.github/workflows/ci.yml',
  hostWorkflow: 'seal-host/.github/workflows/golden-path.yml',
  evaluator: 'EVALUATOR-START.md',
  comparison: 'docs/WHY-DIFFERENT.md',
  landingPage: 'index.html',
};

function fail(message) {
  console.error(`LAUNCH TRUTH FAIL: ${message}`);
  process.exit(1);
}

function readRequired(label, file) {
  if (!file) fail(`${label} input is absent`);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    fail(`${label} input is absent or unreadable: ${file}: ${error.message}`);
  }
  if (!stat.isFile()) fail(`${label} input is not a regular file: ${file}`);
  if (stat.size === 0) fail(`${label} input is empty: ${file}`);
  if ((stat.mode & 0o444) === 0) fail(`${label} input has no readable permission bit: ${file}`);
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (text.trim().length === 0) fail(`${label} input is empty: ${file}`);
    return text;
  } catch (error) {
    fail(`${label} input is unreadable: ${file}: ${error.message}`);
  }
}

function workflowName(label, source) {
  const names = [...source.matchAll(/^name:\s*(.+?)\s*$/gm)].map((match) => match[1]);
  if (names.length !== 1) fail(`${label} must contain exactly one top-level name; found ${names.length}`);
  return names[0];
}

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) fail(message);
}

if (process.argv.length !== 8) {
  fail(`expected six inputs (${Object.values(EXPECTED).join(', ')}); received ${process.argv.length - 2}`);
}

const [readmePath, umbrellaWorkflowPath, hostWorkflowPath, evaluatorPath, comparisonPath, landingPagePath] = process.argv.slice(2);
const readme = readRequired('README', readmePath);
const umbrellaWorkflow = readRequired('umbrella workflow', umbrellaWorkflowPath);
const hostWorkflow = readRequired('host workflow', hostWorkflowPath);
const evaluator = readRequired('evaluator truth surface', evaluatorPath);
const comparison = readRequired('guardrail comparison', comparisonPath);
const landingPage = readRequired('landing page', landingPagePath);

const umbrellaName = workflowName('umbrella workflow', umbrellaWorkflow);
const hostName = workflowName('host workflow', hostWorkflow);
const badges = [...readme.matchAll(/\[!\[([^\]]+)\]\(([^)]+badge\.svg\?branch=main)\)\]\(([^)]+)\)/g)]
  .map((match) => ({ label: match[1], image: match[2], target: match[3] }));

const expectedBadges = [
  {
    label: umbrellaName,
    image: 'https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg?branch=main',
    target: 'https://github.com/velvetmonkey/seal/actions/workflows/ci.yml',
  },
  {
    label: hostName,
    image: 'https://github.com/velvetmonkey/seal-host/actions/workflows/golden-path.yml/badge.svg?branch=main',
    target: 'https://github.com/velvetmonkey/seal-host/actions/workflows/golden-path.yml',
  },
];

if (badges.length !== expectedBadges.length) fail(`README must contain exactly ${expectedBadges.length} native main-branch workflow badges; found ${badges.length}`);
for (const expected of expectedBadges) {
  if (!badges.some((badge) => badge.label === expected.label && badge.image === expected.image && badge.target === expected.target)) {
    fail(`README badge does not truthfully map workflow ${JSON.stringify(expected.label)} to ${expected.image}`);
  }
}
if (/shields\.io[^\n]*actions\/workflow\/status/i.test(readme)) fail('README uses a workflow-status proxy instead of the native GitHub badge endpoint');

requireMatch(readme, /this \*\*attack replay\*\*, not a live-agent attack,/, 'README must identify the demonstration as an attack replay, not a live-agent attack');
const liveAttackMentions = readme.match(/live-agent attack/gi) ?? [];
if (liveAttackMentions.length !== 1) fail(`README must contain exactly one negated live-agent-attack clarification; found ${liveAttackMentions.length}`);
requireMatch(landingPage, /scripted attack replay/, 'landing page must identify the demonstration as a scripted attack replay');
if (/replayed live-agent attack|see a live-agent attack blocked/i.test(`${readme}\n${landingPage}`)) fail('a sales surface still describes the replay as a live-agent attack');

requireMatch(comparison, /^LLM judges and prompt filters for agent tools work by judgment:/m, 'comparison must be narrowed to LLM judges and prompt filters');
requireMatch(comparison, /when one of these heuristic guards guesses wrong it can fail\s+\*\*open\*\*/m, 'comparison must use the qualified “can fail open” claim');
if (/Most guardrails|heuristic guard guesses wrong it fails \*\*open\*\*|\| \*\*Failure direction\*\* \| Fails open/i.test(comparison)) fail('comparison makes an overbroad fail-open claim');
if (/fail-open heuristic guard/i.test(landingPage)) fail('landing page makes an overbroad fail-open comparison');

requireMatch(readme, /^As of \d{4}-\d{2}-\d{2}, the published release shipped the gate, while coordinated mesh deployment remained/m, 'mesh-shipping claim must carry an explicit as-of date');
requireMatch(evaluator, /> \*\*Dated correction, measured \d{4}-\d{2}-\d{2}\.\*\*[\s\S]{0,1200}28bb3ae71985357163e3b651791e2a70c462ea5d1313a59b4967d4c20ea77657/, 'fleet hash must remain inside its dated correction');
requireMatch(evaluator, /The module axiom gate is derived evidence: run `lake exe module_axiom_check`[\s\S]{0,900}Re-run it for the counts in any later tree;/, 'module census must remain derived from the executable gate instead of copied as current prose');
if (/expected 51 production modules and 25 kernel-baseline assignments/.test(evaluator)) fail('time-dependent module and assignment counts were copied back into the evaluator prose');
requireMatch(evaluator, /\*\*CLOSED, AS OF \d{4}-\d{2}-\d{2}\.\*\*[\s\S]{0,500}28bb3ae7/, 'current fleet disposition must remain explicitly dated');

console.log(`LAUNCH TRUTH OK: ${umbrellaName}; ${hostName}; badges, dated claims, and attack-replay language agree`);
