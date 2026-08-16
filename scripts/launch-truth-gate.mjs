// SPDX-License-Identifier: Apache-2.0
// Truth gate for the launch surfaces.
//
// Since roadmap step 6 the README is the developer route only: one badge,
// four exercised beats, the canonical approval-origin sentence, and no
// repository family, replay narrative or mesh claim. This gate holds that
// shape, and holds the evaluator and comparison surfaces to the corrections
// they already carry. If a removed claim is reintroduced, the gate fails
// until the claim returns WITH its qualification and this gate is updated
// deliberately in the same change.
import fs from 'node:fs';

const EXPECTED = {
  readme: 'README.md',
  umbrellaWorkflow: '.github/workflows/ci.yml',
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

if (process.argv.length !== 7) {
  fail(`expected five inputs (${Object.values(EXPECTED).join(', ')}); received ${process.argv.length - 2}`);
}

const [readmePath, umbrellaWorkflowPath, evaluatorPath, comparisonPath, landingPagePath] = process.argv.slice(2);
const readme = readRequired('README', readmePath);
const umbrellaWorkflow = readRequired('umbrella workflow', umbrellaWorkflowPath);
const evaluator = readRequired('evaluator truth surface', evaluatorPath);
const comparison = readRequired('guardrail comparison', comparisonPath);
const landingPage = readRequired('landing page', landingPagePath);
const version = readRequired('VERSION', new URL('../VERSION', import.meta.url)).trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) fail(`VERSION is not exact SemVer: ${version}`);

// --- README: the developer route, roadmap step 6 ---

const umbrellaName = workflowName('umbrella workflow', umbrellaWorkflow);
const badges = [...readme.matchAll(/\[!\[([^\]]+)\]\(([^)]+badge\.svg\?branch=main)\)\]\(([^)]+)\)/g)]
  .map((match) => ({ label: match[1], image: match[2], target: match[3] }));
if (badges.length !== 1) fail(`README must contain exactly one native main-branch workflow badge; found ${badges.length}`);
const badge = badges[0];
if (badge.label !== umbrellaName
  || badge.image !== 'https://github.com/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg?branch=main'
  || badge.target !== 'https://github.com/velvetmonkey/seal/actions/workflows/ci.yml') {
  fail(`README badge does not truthfully map workflow ${JSON.stringify(umbrellaName)} to this repository's ci.yml`);
}
if (/shields\.io[^\n]*actions\/workflow\/status/i.test(readme)) fail('README uses a workflow-status proxy instead of the native GitHub badge endpoint');

// The canonical approval-origin sentence, verbatim (roadmap section 6),
// placed once on the front page.
const approvalOrigin = 'Seal asks you to approve one exact call. It will not run that call twice, and it might not run it at all. On the Claude Code path, Seal trusts Claude Code to present the request to a human and faithfully return the human\'s choice; Seal cannot distinguish a human click from a client-generated acceptance.';
const originCount = readme.split(approvalOrigin).length - 1;
if (originCount !== 1) fail(`README must carry the canonical approval-origin sentence verbatim exactly once; found ${originCount}`);

// The platform sentence, verbatim (roadmap section 7), stated plainly.
const platformSentence = `**Seal v${version} supports Linux x86-64 only. macOS, Windows, Linux ARM and other platforms are not supported in this release.**`;
const platformCount = readme.split(platformSentence).length - 1;
if (platformCount !== 1) fail(`README must state the Linux x86-64-only platform sentence verbatim exactly once; found ${platformCount}`);

// The signed-receipt claim was the fifth false user-visible string in this
// build: the demo signs receipts with a per-run key, the protected path
// passes no signer (spine/proxy-cli.cjs) and the shipped checker refuses its
// receipts. The README may only tell that story split by path.
if (/writes a signed receipt/.test(readme)) fail('README claims the gate writes a signed receipt; only the demo path signs today, and the README must say which path');
if (!readme.includes('REFUSE unsealed')) fail('README must disclose that the shipped checker refuses protected-path receipts (REFUSE unsealed) until an operator signing key exists');

// Claims removed from the developer route must not creep back without their
// qualifications. If one of these words returns, re-add the qualified wording
// from git history and update this gate in the same change.
if (/live-agent|attack replay/i.test(readme)) fail('README reintroduces replay/live-agent language; the qualified wording and this gate must change together');
if (/mesh/i.test(readme)) fail('README reintroduces a mesh claim; the dated qualification and this gate must change together');
if (/github\.com\/velvetmonkey\/(?!seal[)\s/])/.test(readme)) fail('README links a sibling repository; the developer route carries no repository family');

// --- Landing page and comparison surfaces: corrections stay in place ---

requireMatch(landingPage, /scripted attack replay/, 'landing page must identify the demonstration as a scripted attack replay');
if (/replayed live-agent attack|see a live-agent attack blocked/i.test(landingPage)) fail('the landing page describes the replay as a live-agent attack');
if (/fail-open heuristic guard/i.test(landingPage)) fail('landing page makes an overbroad fail-open comparison');

requireMatch(comparison, /^LLM judges and prompt filters for agent tools work by judgment:/m, 'comparison must be narrowed to LLM judges and prompt filters');
requireMatch(comparison, /when one of these heuristic guards guesses wrong it can fail\s+\*\*open\*\*/m, 'comparison must use the qualified “can fail open” claim');
if (/Most guardrails|heuristic guard guesses wrong it fails \*\*open\*\*|\| \*\*Failure direction\*\* \| Fails open/i.test(comparison)) fail('comparison makes an overbroad fail-open claim');

// --- Evaluator surface: dated corrections stay dated ---

requireMatch(evaluator, /> \*\*Dated correction, measured \d{4}-\d{2}-\d{2}\.\*\*[\s\S]{0,1200}28bb3ae71985357163e3b651791e2a70c462ea5d1313a59b4967d4c20ea77657/, 'fleet hash must remain inside its dated correction');
requireMatch(evaluator, /The module axiom gate is derived evidence: run `lake exe module_axiom_check`[\s\S]{0,900}Re-run it for the counts in any later tree;/, 'module census must remain derived from the executable gate instead of copied as current prose');
if (/expected 51 production modules and 25 kernel-baseline assignments/.test(evaluator)) fail('time-dependent module and assignment counts were copied back into the evaluator prose');
requireMatch(evaluator, /\*\*CLOSED, AS OF \d{4}-\d{2}-\d{2}\.\*\*[\s\S]{0,500}28bb3ae7/, 'current fleet disposition must remain explicitly dated');

console.log(`LAUNCH TRUTH OK: ${umbrellaName}; one badge, the approval-origin and platform sentences, and the standing corrections all hold`);
