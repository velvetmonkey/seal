// SPDX-License-Identifier: Apache-2.0
// Truth gate for the launch surfaces.
import fs from 'node:fs';
import path from 'node:path';
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
  // Markdown occasionally wraps a long destination immediately after a path
  // slash. Reassemble that one lexical continuation before extracting tokens;
  // do not otherwise remove or collapse whitespace inside a URL.
  const joinedContinuations = source.replace(
    /((?<![A-Za-z0-9+.-])(?:(?:(?:https?|git\+https|git):\/\/|\/\/)[^\s<>()\[\]{}"'`]*\/|git@github\.com:[^\s<>()\[\]{}"'`]*\/))[ \t]*\r?\n[ \t]*(?=[A-Za-z0-9%])/gi,
    '$1',
  );
  const links = joinedContinuations.match(
    /(?<![A-Za-z0-9+.-])(?:(?:(?:https?|git\+https|git):\/\/|\/\/)[^\s<>()\[\]{}"'`]+|git@github\.com:[^\s<>()\[\]{}"'`]+)/gi,
  ) ?? [];
  for (const line of joinedContinuations.split(/\r?\n/u)) { const candidate = line.trim(); if (/^(?:(?:(?:https?|file|git\+https|git):)|\/\/|git@github\.com:)/iu.test(candidate)) links.push(candidate); }
  return [...new Set(links.filter((link) => !link.startsWith('///')))];
}

/* RFC 3986 supplies the literal URL character set: unreserved, sub-delims,
 * gen-delims, and percent. The gate no longer infers malformation from parser
 * behaviour; this check is decided before parsing. */
const RFC3986_LITERAL = /^[A-Za-z0-9._~!$&'()*+,;=:/?#\[\]@%-]+$/u;
const VALID_PERCENT_ESCAPE = /%(?:[0-9A-Fa-f]{2})/gu;

function hasInvalidRawUrlCharacters(token) { return !RFC3986_LITERAL.test(token) || token.replace(VALID_PERCENT_ESCAPE, '').includes('%'); }

function repositoryLinkVerdict(link) {
  if (link.startsWith('//')) throw new Error('scheme-relative URL is not allowed');

  let parsed;
  if (link.startsWith('git@github.com:')) {
    parsed = new URL(`ssh://github.com/${link.slice('git@github.com:'.length)}`);
  } else {
    parsed = new URL(link.startsWith('//') ? `https:${link}` : link);
  }

  const allowedSchemes = new Set(['http:', 'https:', 'git+https:', 'git:', 'ssh:']);
  if (!allowedSchemes.has(parsed.protocol)) throw new Error('unsupported URL scheme: ' + parsed.protocol);
  if (!parsed.hostname) throw new Error('URL host is empty');

  const selfPaths = new Set([
    '/velvetmonkey/seal',
    '/velvetmonkey/seal/',
    '/velvetmonkey/seal.git',
    '/velvetmonkey/seal.git/',
  ]);
  if (parsed.hostname === 'github.com') {
    // Sibling status is decided by the host and repository path alone; port
    // numbers and userinfo components never decide repository classification.
    if (selfPaths.has(parsed.pathname)) return 'self';

    // These are the non-repository GitHub endpoints already required by the
    // fixed README. Everything else on github.com is fail-closed as a sibling
    // repository reference; no path miss receives a second self decision.
    const nonRepositoryPaths = new Set([
      '/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg',
      '/velvetmonkey/seal/actions/workflows/ci.yml',
      '/velvetmonkey/seal/releases/download/$SEAL_VERSION/SHA256SUMS',
      '/velvetmonkey/seal/releases/download/$SEAL_VERSION/seal-$SEAL_VERSION-linux-x64',
    ]);
    return nonRepositoryPaths.has(parsed.pathname) ? null : 'sibling';
  }

  // A clone-shaped URL on any other exact hostname is not an unrelated web
  // link. It is a repository reference and therefore cannot be this repo.
  const finalComponentExtension = path.posix.extname(path.posix.basename(parsed.pathname));
  return finalComponentExtension === '.git' ? 'sibling' : null;
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
  if (hasInvalidRawUrlCharacters(link)) {
    fail(`README contains a URL character that must be percent-encoded: ${link}`);
  }
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

// The signed-receipt claim was the fifth false user-visible string in this build; the demo signs per-run while the protected path uses a durable signer.
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
