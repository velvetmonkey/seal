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
  const joinedContinuations = withoutHtmlCommentClosers(source).replace(
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
  let parsed;
  if (link.startsWith('git@github.com:')) {
    parsed = new URL(`ssh://github.com/${link.slice('git@github.com:'.length)}`);
  } else {
    parsed = new URL(link.startsWith('//') ? `https:${link}` : link);
  }

  const allowedSchemes = new Set(['http:', 'https:', 'git+https:', 'git:', 'ssh:']);
  if (!allowedSchemes.has(parsed.protocol)) throw new Error('unsupported URL scheme: ' + parsed.protocol);
  if (!parsed.hostname) throw new Error('URL host is empty');
  if (parsed.username || parsed.password) throw new Error('URL userinfo is not allowed');

  const selfPaths = new Set([
    '/velvetmonkey/seal',
    '/velvetmonkey/seal/',
    '/velvetmonkey/seal.git',
    '/velvetmonkey/seal.git/',
  ]);
  if (parsed.hostname === 'github.com') {
    // An explicit non-default port identifies a different origin; URL parses an explicit default port (for example :443 on https) as the empty port,
    // so only a non-empty port needs to be rejected here.
    if (parsed.port) return 'sibling';
    if (selfPaths.has(parsed.pathname)) return 'self';

    // These are the non-repository GitHub endpoints already required by the
    // fixed README. Everything else on github.com is fail-closed as a sibling
    // repository reference; no path miss receives a second self decision.
    const nonRepositoryPaths = new Set([
      '/velvetmonkey/seal/actions/workflows/ci.yml/badge.svg',
      '/velvetmonkey/seal/actions/workflows/ci.yml',
      '/velvetmonkey/seal/releases/download/$SEAL_VERSION/SHA256SUMS',
      '/velvetmonkey/seal/releases/download/$SEAL_VERSION/seal-$SEAL_VERSION-linux-x64', '/velvetmonkey/seal/releases/download/$SEAL_VERSION/seal-receipt-check.mjs',
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

for (const link of rawCheckedRepositoryLinks(readme)) {
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
const frontDoorClaims = [
  'Seal is a local approval boundary for AI-agent tool calls.',
  'Claude can ask. Seal decides whether that exact call may cross the boundary.',
  'The decision rule is proved. The product seam and state machine are tested. The client and machine remain trusted.',
];
for (const claim of frontDoorClaims) {
  if (readme.split(claim).length - 1 !== 1) fail(`README must carry the canonical front-door sentence exactly once: ${claim}`);
}
if (!readme.includes("Protect is not supported on macOS yet")) fail('README must state the macOS Protect boundary');

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

console.log(`LAUNCH TRUTH OK: ${umbrellaName}; the canonical front door, platform boundary, and standing corrections all hold`);

function withoutHtmlCommentClosers(source) {
  // A paired HTML comment closer is carrier syntax, not destination text.
  // Mask only the exact `-->` delimiter, preserving offsets and every byte of
  // the comment's destination; a genuine `>` elsewhere remains rejectable.
  return source.replace(/<!--[\s\S]*?-->/gu, (comment) => `${comment.slice(0, -3)}   `);
}

function literalCodeRanges(source) {
  const ranges = [];
  let fence = null;
  let offset = 0;

  for (const line of source.split(/(?<=\n)/u)) {
    const content = line.replace(/\r?\n$/u, '');
    const fenceMatch = content.match(/^ {0,3}(`{3,}|~{3,})/u);
    if (fence) {
      ranges.push([offset, offset + line.length]);
      if (fenceMatch && fenceMatch[1][0] === fence.character && fenceMatch[1].length >= fence.length) fence = null;
    } else if (fenceMatch) {
      fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
      ranges.push([offset, offset + line.length]);
    } else {
      for (let index = 0; index < content.length;) {
        if (content[index] !== '`') {
          index += 1;
          continue;
        }
        let end = index;
        while (content[end] === '`') end += 1;
        const marker = content.slice(index, end);
        const close = content.indexOf(marker, end);
        if (close === -1) {
          index = end;
          continue;
        }
        ranges.push([offset + index, offset + close + marker.length]);
        index = close + marker.length;
      }
    }
    offset += line.length;
  }
  return ranges;
}

function rawUrlDestinations(source) {
  source = withoutHtmlCommentClosers(source);
  const codeRanges = literalCodeRanges(source);
  // An exact HTML comment opener is a destination-start boundary even though
  // its final byte is `-`; arbitrary hyphen-preceded schemes remain excluded.
  const starts = source.matchAll(/(?:(?<=<!--)|(?<![A-Za-z0-9+.-]))(?:(?:https?|git\+https|git):\/\/|\/\/|git@github\.com:)/giu);
  const destinations = [];

  function markdownDestinationEnd(begin, enclosedEnd) {
    const candidate = source.slice(begin, enclosedEnd);
    const separator = candidate.search(/[ \t]/u);
    if (separator === -1) return enclosedEnd;

    // CommonMark titles are separated from the destination and consume the
    // remainder of the carrier. Whitespace that does not introduce a title is
    // still part of the raw destination and must be rejected.
    const suffix = candidate.slice(separator);
    const title = /^(?:[ \t]+(?:(?:"(?:\\.|[^"\\])*")|(?:'(?:\\.|[^'\\])*')|(?:\((?:\\.|[^)\\])*\)))[ \t]*|[ \t]+)$/u;
    return title.test(suffix) ? begin + separator : enclosedEnd;
  }

  function matchingRoundBracket(begin, lineEnd) {
    let depth = 1;
    let titleQuote = null;
    let sawWhitespace = false;
    for (let index = begin; index < lineEnd; index += 1) {
      const character = source[index];
      if (titleQuote) {
        if (character === '\\') index += 1;
        else if (character === titleQuote) titleQuote = null;
        continue;
      }
      if (character === ' ' || character === '\t') {
        sawWhitespace = true;
        continue;
      }
      if (sawWhitespace && (character === '"' || character === "'")) {
        titleQuote = character;
        continue;
      }
      if (character === '(') depth += 1;
      if (character === ')' && --depth === 0) return index;
    }
    return lineEnd;
  }

  function isReferenceDestination(begin) {
    const lineStart = source.lastIndexOf('\n', begin - 1) + 1;
    return /^ {0,3}\[[^\]]+\]:[ \t]*$/u.test(source.slice(lineStart, begin));
  }

  function isRepositoryToken(token) {
    try {
      return repositoryLinkVerdict(token) !== null;
    } catch {
      return true;
    }
  }

  function proseDestinationEnd(begin, lineEnd) {
    const candidate = source.slice(begin, lineEnd);
    const separator = candidate.search(/[ \t]/u);
    if (separator === -1) return lineEnd;
    const prefix = candidate.slice(0, separator);
    const remainder = candidate.slice(separator).trimStart();
    const next = remainder.match(/^[^ \t\r\n<>"']+/u)?.[0] ?? '';

    // A punctuation-led continuation, or a host interrupted before it becomes
    // repository-shaped, is still the same destination. Ordinary following
    // prose is outside it.
    if (/^[./?#%:;,@&=+]/u.test(next)
      || (!isRepositoryToken(prefix) && next && isRepositoryToken(prefix + next))) return lineEnd;
    return begin + separator;
  }

  for (const start of starts) {
    const begin = start.index;
    if (codeRanges.some(([from, to]) => begin >= from && begin < to)) continue;

    const opener = source[begin - 1];
    const closer = new Map([['(', ')'], ['<', '>'], ['"', '"'], ["'", "'"]]).get(opener);
    let end = source.indexOf('\n', begin);
    if (end === -1) end = source.length;

    if (closer) {
      if (opener === '(') {
        end = markdownDestinationEnd(begin, matchingRoundBracket(begin, end));
      } else {
        const enclosedEnd = source.indexOf(closer, begin);
        if (enclosedEnd !== -1 && enclosedEnd < end) end = enclosedEnd;
      }
    } else if (isReferenceDestination(begin)) {
      end = markdownDestinationEnd(begin, end);
    } else {
      end = proseDestinationEnd(begin, end);
    }

    destinations.push(source.slice(begin, end).replace(/\r$/u, ''));
  }
  return destinations;
}

function rawCheckedRepositoryLinks(source) {
  for (const destination of rawUrlDestinations(source)) {
    if (hasInvalidRawUrlCharacters(destination)) {
      fail(`README contains a URL character that must be percent-encoded: ${destination}`);
    }
  }
  return repositoryLinks(source);
}
