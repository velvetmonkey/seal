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
  evaluator: 'docs/assurance/evaluator-start.md',
  comparison: 'docs/archive/WHY-DIFFERENT.md',
  landingPage: 'docs/assurance/index.html',
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

function repositoryLinks(source) {
  return source.match(/(?:https?:\/\/|\/\/)[^\s<>()]+|git@github\.com:[^\s<>()]+/gi) ?? [];
}

function repositoryLinkVerdict(link) {
  let host;
  let pathname;
  let username = '';
  let port = '';
  if (link.startsWith('git@github.com:')) {
    host = 'github.com';
    pathname = `/${link.slice('git@github.com:'.length).split(/[?#]/, 1)[0]}`;
  } else {
    const parsed = new URL(link.startsWith('//') ? `https:${link}` : link);
    host = parsed.hostname;
    pathname = parsed.pathname;
    username = parsed.username;
    port = parsed.port;
  }
  if (port) return 'sibling';
  if (host !== 'github.com') {
    const githubImposter = host.includes('github.com') || pathname.includes('/github.com/') || host.startsWith('xn--');
    return githubImposter ? 'sibling' : null;
  }

  const selfPaths = new Set([
    '/velvetmonkey/seal',
    '/velvetmonkey/seal/',
    '/velvetmonkey/seal.git',
    '/velvetmonkey/seal.git/',
  ]);
  if (!selfPaths.has(pathname)) {
    // These are repository-shaped URLs with an extra segment; do not
    // silently accept them as unrelated document links.
    if (/^\/[^/]+\/velvetmonkey\/seal(?:\.git)?\/?$/.test(pathname)
      || /^\/velvetmonkey\/seal(?:\.git)?\/[^/]+\/?$/.test(pathname)
      || /^\/[^/]+\/[^/]+\/[^/]+\.git\/?$/.test(pathname)) return 'sibling';
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    const repository = parts[1];
    if (!/^(?:[^/]+|[^/]+\.git)$/.test(repository)) return null;
  }

  const parts = pathname.split('/').filter(Boolean);
  const owner = parts[0];
  const repository = parts[1];
  const repositoryName = repository.endsWith('.git') ? repository.slice(0, -4) : repository;
  if (username || owner !== 'velvetmonkey' || repositoryName !== 'seal') return 'sibling';
  return 'self';
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

for (const link of repositoryLinks(readme)) {
  let verdict;
  try {
    verdict = repositoryLinkVerdict(link);
  } catch (error) {
    fail(`README contains an unreadable repository URL: ${link}: ${error.message}`);
  }
  if (verdict === 'sibling') fail('README links a sibling repository; the developer route carries no repository family');
}

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
const approvalOrigin = 'Seal asks you to approve one exact call. It will not run that call twice, and it might not run it at all. On the Claude Code path, Seal trusts Claude Code to present the request to a human and faithfully return the human\'s choice; Seal cannot distinguish a human click from a client-generated acceptance.'; // CLAIM-COVERAGE: README.md
const originCount = readme.split(approvalOrigin).length - 1;
if (originCount !== 1) fail(`README must carry the canonical approval-origin sentence verbatim exactly once; found ${originCount}`);

// The platform sentence, verbatim (roadmap section 7), stated plainly.
const platformSentence = '**macOS source portability is CI-exercised for install, demo and receipt checking. Protect is not supported on macOS yet.**';
const platformCount = readme.split(platformSentence).length - 1;
if (platformCount !== 1 || /supports Linux x86-64 and macOS x64\/arm64|source builds support Linux x86-64 and macOS/i.test(readme)) fail(platformCount !== 1 ? `README must state the macOS portability and Protect boundary verbatim exactly once; found ${platformCount}` : 'README claims macOS support without excluding Protect');

// The signed-receipt claim was the fifth false user-visible string in this
// build: the demo signs receipts with a per-run key, the protected path
// Protected activation creates or loads a durable signer (spine/proxy-cli.cjs),
// while the demo uses a key generated for that run. Keep both lifetimes plain.
if (!readme.includes('protected path creates or reuses a machine-local signing key')) fail('README must disclose the protected path\'s durable machine-local receipt key');
if (!readme.includes("demo's key is generated fresh for that run")) fail('README must distinguish the demo\'s temporary receipt key from the protected path\'s durable key');

// Claims removed from the developer route must not creep back without their
// qualifications. If one of these words returns, re-add the qualified wording
// from git history and update this gate in the same change.
if (/live-agent|attack replay/i.test(readme)) fail('README reintroduces replay/live-agent language; the qualified wording and this gate must change together');
if (/mesh/i.test(readme)) fail('README reintroduces a mesh claim; the dated qualification and this gate must change together');
// --- Landing page and comparison surfaces: corrections stay in place ---

requireMatch(landingPage, /scripted attack replay/, 'landing page must identify the demonstration as a scripted attack replay'); // CLAIM-COVERAGE: docs/assurance/index.html
if (/replayed live-agent attack|see a live-agent attack blocked/i.test(landingPage)) fail('the landing page describes the replay as a live-agent attack');
if (/fail-open heuristic guard/i.test(landingPage)) fail('landing page makes an overbroad fail-open comparison');

requireMatch(comparison, /^LLM judges and prompt filters for agent tools work by judgment:/m, 'comparison must be narrowed to LLM judges and prompt filters'); // CLAIM-COVERAGE: docs/archive/WHY-DIFFERENT.md
requireMatch(comparison, /when one of these heuristic guards guesses wrong it can fail\s+\*\*open\*\*/m, 'comparison must use the qualified “can fail open” claim');
if (/Most guardrails|heuristic guard guesses wrong it fails \*\*open\*\*|\| \*\*Failure direction\*\* \| Fails open/i.test(comparison)) fail('comparison makes an overbroad fail-open claim');

// --- Evaluator surface: dated corrections stay dated ---

requireMatch(evaluator, /> \*\*Dated correction, measured \d{4}-\d{2}-\d{2}\.\*\*[\s\S]{0,1200}28bb3ae71985357163e3b651791e2a70c462ea5d1313a59b4967d4c20ea77657/, 'fleet hash must remain inside its dated correction'); // CLAIM-COVERAGE: docs/assurance/evaluator-start.md
requireMatch(evaluator, /The module axiom gate is derived evidence: run `lake exe module_axiom_check`[\s\S]{0,900}Re-run it for the counts in any later tree;/, 'module census must remain derived from the executable gate instead of copied as current prose');
if (/expected 51 production modules and 25 kernel-baseline assignments/.test(evaluator)) fail('time-dependent module and assignment counts were copied back into the evaluator prose');
requireMatch(evaluator, /\*\*CLOSED, AS OF \d{4}-\d{2}-\d{2}\.\*\*[\s\S]{0,500}28bb3ae7/, 'current fleet disposition must remain explicitly dated');

console.log(`LAUNCH TRUTH OK: ${umbrellaName}; one badge, the approval-origin and platform sentences, and the standing corrections all hold`);
