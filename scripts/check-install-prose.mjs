#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// This is an independently reviewed claim roster, not generator output. Unknown
// prose fails closed, including additions/deletions. Never regenerate this roster
// from the document to make a failure pass: review its observable first.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import tempRoot from './temp-root.cjs';
import { carriesClaim } from './claim-bearing-file-inventory.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DOCS_ROOT = process.env.SEAL_INSTALL_PROSE_ROOT || ROOT;
const normalize = text => text.replace(/\s+/g, ' ').trim();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const flip = value => (value[0] === '0' ? '1' : '0') + value.slice(1);
const generatedRegion = /<!-- generated from published release; do not edit -->([\s\S]*?)<!-- end generated release docs -->/g;
const regions = text => [...text.matchAll(generatedRegion)].map(m => m[1]);

// Each entry names the executable observation below, or explicitly admits the
// limit. Sentence 14 was corrected after the published installer accepted an
// omitted --bytes flag. The two resulting sentences share that one claim ID.
// The 2026-09 install-experience rework moved this whole page's payoff
// (platform choice, install, demo) ahead of this "verification wall"
// paragraph and the release-identity sentence, into a "More detail" section
// near the bottom. Both stay inside one generated region there (rather than
// becoming static prose) specifically so tampering with any sentence here
// still fails the exhaustive generated-prose accounting below — moving
// content must not also remove its coverage. 07 and 12 said "below" when
// the wall sat above the commands; they now say "on this page" / "here"
// since the wall sits after every command instead.
const claims = [
  ['01', 'UNPROVABLE: full Protect execution on all named hosts', 'This checkout supports Protect on Linux x86-64 and macOS x64/arm64.'],
  ['02', 'UNPROVABLE: independent reproduction is external evidence', 'The native macOS process-start witness helper is release-produced, not independently reproduced.'],
  ['03', 'platform refusal', 'Windows and Linux ARM are unsupported.'],
  ['04', 'UNPROVABLE: minimum Node major across supported hosts', 'Node 20+ is required.'],
  ['05', 'platform refusal', 'The installer refuses before changing anything on an unsupported or mismatched platform.'],
  ['40', 'spine/demo.cjs: no reference to the `claude` command anywhere in the demo path; spine/protection.cjs: spawns `claude` only for protect/unprotect/recover', "Claude Code's `claude` command is required only to protect a real tool; it is not required to install, verify, or run the demo below."],
  ['06', 'both fences: success and corruption', 'The [README](../../README.md) short form uses the same shell gate.'],
  ['07', 'both fences: corruption, status, mode, no install', 'In every install command on this page, a failed checksum comparison prevents both `chmod` and execution of the artifact.'],
  ['08', 'shell execution; unavailable shells explicitly reported', 'The commands use POSIX syntax for `sh`, `dash`, `bash`, and `zsh`.'],
  ['09', 'unmodified fence in fresh shells', 'Copy each whole command, including its continuation backslashes and `&&` operators; there is no shell-option preamble.'],
  ['10', 'omitted version with corruption', 'The release version is a separate assignment; omitting it cannot remove the verification gate.'],
  ['11', 'every continuation parsed alone', 'Each continuation starts with `&&`, so copying a continuation alone produces a syntax error.'],
  ['12', 'OS digest tools, corrupted artifacts and checksum file', 'The digest comparison here is *your* check, with the OS SHA-256 tool, against the `SHA256SUMS` asset attached to the same GitHub release.'],
  ['13', 'mode 644 plus no execution trace after corruption', 'That is not the installer checking itself.'],
  ['14', 'direct installer with omitted and wrong pins', 'The `--sha256` flag is a second pin the installer demands and will refuse without. The optional `--bytes` flag adds a length check.'],
  ['15', 'success, corrupt artifact, wrong digest and byte count', 'Together they answer "did I download the bytes the release named?"'],
  ['16', 'UNPROVABLE: publisher honesty is not a byte observable', 'They do not answer "is the publisher honest?"'],
];

// Reuse the inventory's product-entity/predicate definition, in Markdown mode.
// Join wrapped prose before classifying; examples and structural lines are not
// sentences. The generated region retains its stronger, exhaustive accounting.
const outsideClaims = text => text.replace(generatedRegion, '\n\n')
  .replace(/```[^\n]*\n[\s\S]*?```/g, '\n\n')
  .replace(/^\s*(?:#{1,6}\s.*|<p[^\n]*|\[!\[[^\n]*)$/gm, '')
  .split(/\n\s*\n/).flatMap(paragraph => normalize(paragraph).split(/(?<=[.!?])\s+/))
  .map(sentence => sentence.replace(/^(?:>\s*|[-*]\s+|\*+)/, '').replace(/\*+$/, '').trim())
  .filter(sentence => carriesClaim(sentence, 'README.md'));

// Independently reviewed outside sentences use the same ID/observable/wording
// vocabulary as the release roster. Observations in other product tests run in
// the full suite; limits remain explicit instead of claiming a local proof.
const outsideReviews = {
  'docs/start/install.md': [
    ['37', 'test/dist3d.test.cjs: fresh distribution build output', 'A build of this checkout (not the published release asset) writes `dist/seal-v<identity>-linux-x64`.'],
    ['20', 'test/dist3d.test.cjs: built artifact payload; UNPROVABLE here: hash algorithm across every payload', "The installed tree is exactly the regular payload files named by the artifact's payload manifest (a fresh build includes `checker/seal-receipt-v2.mjs` for `seal verify`)."],
    ['19', 'checker corruption and no checker execution', 'The downloaded checker is only checked against `SHA256SUMS`; from a source checkout, run `node checker/seal-receipt-v2.mjs docs/reference/receipt-operations-v1/receipt-block.json`.'],
    ['38', 'test/frontdoor.test.mjs: README exact-call demo (same reviewed sentence, repeated verbatim on this page)', 'Seal is a local approval boundary for AI-agent tool calls.'],
    ['39', 'architectural: seal-check (velvetmonkey/seal-check) is a static browser page plus a receipt checker with no MCP server and no elicitation/approval mechanism; docs/start/evaluator-walk.md makes the same "does not check/run" distinction for that product', "The separate browser product at [seal-check](https://velvetmonkey.github.io/seal-check/) can check an already-produced receipt from any browser on any platform; it does not run Seal's approval gate."],
  ],
  'README.md': [
    ['21', 'test/frontdoor.test.mjs: README exact-call demo', 'Seal is a local approval boundary for AI-agent tool calls.'],
    ['22', 'test/frontdoor.test.mjs: README exact-call demo', 'Seal decides whether that exact call may cross the boundary.'],
    ['23', 'UNPROVABLE: full Protect execution on all named hosts (claim 01)', 'Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64.'],
    ['24', 'test/frontdoor.test.mjs#readme: approval, replay refusal, child count', 'Seal holds each exact call, asks once, permits at most one execution, and writes a signed receipt.'],
    ['25', 'test/protect3b.test.cjs: protect and unprotect leave project .mcp.json byte-identical by hash', "The command removes Seal's local override and reports that the sealed MCP route is outside Seal."],
    ['26', 'test/protect3b.test.cjs: explicit recovery archives incompatible bytes, preserves evidence, and permits fresh protect', 'Seal includes `seal recover`.'],
    ['27', 'test/protect3b.test.cjs: stored schema compatibility and explicit recovery', 'Seal accepts stored state with a schema it can read, regardless of the Seal version that created it.'],
    ['28', 'test/protect3b.test.cjs: explicit recovery archives incompatible bytes, preserves evidence, and permits fresh protect', 'If Seal reports `incompatible_state` for an unsupported schema, stop Claude Code and run this in the affected project:'],
    ['29', 'test/protect3b.test.cjs: exact archive bytes and recovery ownership refusals', "It saves the exact old state to the printed `state.json.recovered-…` path before removing Seal's local override, using the same ownership checks as unprotect."],
    ['30', 'UNPROVABLE here: exhaustive absence of downloads; recovery tests exercise the local fake Claude CLI', 'Recovery runs locally with the current Seal binary and the installed Claude CLI; it does not download anything.'],
    ['31', 'test/protect3b.test.cjs: recovery status is outside Seal', 'The route is now outside Seal.'],
    ['32', 'test/protect3b.test.cjs: fresh protect after recovery', 'Review the archived server, tools and predicates, then run `seal protect SERVER TOOL [TOOL...]` with your chosen selections.'],
    ['33', 'test/readme-protect-state-witness.test.cjs: restart and activation status', 'Restart Claude Code and use `seal status` to check activation.'],
    ['34', 'UNPROVABLE here: formal anchoring; no Lean build is performed by this guard', 'Seal is a formally anchored authorization gate for selected MCP `tools/call` effects.'],
    ['35', 'UNPROVABLE: product-category and human-judgement limits are not byte observables', 'Seal is not an agent framework, a sandbox, an IAM platform, a policy language, a general AI safety product, or a replacement for human judgement.'],
    ['36', 'test/frontdoor.test.mjs: exact-call demo and outside-boundary effect', 'Seal protects selected calls that pass through its boundary.'],
  ],
};

function checkOutsideClaims(file, text) {
  const sentences = outsideClaims(text);
  const reviews = outsideReviews[file];
  for (const sentence of sentences) {
    assert.ok(reviews.some(([, observable, raw]) => observable && raw === sentence),
      `${file}: unreviewed outside install prose needs a claim and observable: ${sentence}`);
  }
  for (const [id, observable, sentence] of reviews) {
    assert.equal(sentences.filter(actual => actual === sentence).length, 1,
      `claim ${id} wording changed or absent; evidence required: ${observable}; expected: ${sentence}`);
  }
}

async function main() {
  const install = fs.readFileSync(path.join(DOCS_ROOT, 'docs/start/install.md'), 'utf8');
  const readme = fs.readFileSync(path.join(DOCS_ROOT, 'README.md'), 'utf8');
  checkOutsideClaims('docs/start/install.md', install);
  checkOutsideClaims('README.md', readme);
  const parts = regions(install);
  assert.equal(parts.length, 8, 'install generated-region population');
  const readmeParts = regions(readme);
  assert.equal(readmeParts.length, 1, 'README generated-region population');
  // Fixed emission order from scripts/generate-release-docs.mjs's
  // installRegions(): title, prereqs, one command per platform (in manifest
  // order darwin-arm64/darwin-x64/linux-x64), release identity, optional
  // checker download, installed-tree pins.
  const bashFence = region => region.match(/```bash\n(SEAL_VERSION=[\s\S]*?)\n```/)?.[1];
  const platformFences = {
    'darwin-arm64': bashFence(parts[2]),
    'darwin-x64': bashFence(parts[3]),
    'linux-x64': bashFence(parts[4]),
  };
  for (const [platform, platformFence] of Object.entries(platformFences)) {
    assert.ok(platformFence, `published install fence absent for ${platform}`);
  }
  const checkerFence = bashFence(parts[6]);
  assert.ok(checkerFence, 'published optional checker fence absent');
  const tag = platformFences['linux-x64'].match(/^SEAL_VERSION=(\S+)/)[1];
  const version = tag.slice(1);
  for (const platformFence of Object.values(platformFences)) {
    assert.equal(platformFence.match(/^SEAL_VERSION=(\S+)/)[1], tag, 'every platform command must name the same release');
  }
  const valueFrom = (fenceText, name) => {
    const found = fenceText.match(new RegExp(`(?:^|&& )${name}="?([^"\\s]+)`, 'm'));
    assert.ok(found, `missing ${name}`);
    return found[1];
  };
  // Facts retain their independent published-release checks. Remove only their
  // entire known sentence shapes; never discard an arbitrary line of prose.
  let prose = normalize(parts.join('\n').replace(/```[^\n]*\n[\s\S]*?```/g, '')
    .replace(`# Install Seal ${tag}`, '')
    .replace(/The \[v[^\]]+ release\]\([^)]*\) publishes `[^`]+`(?:, `[^`]+`)*, and `[^`]+`; its tag resolves to commit \[\x60[0-9a-f]{40}\x60\]\([^)]*\)\./g, '')
    .replace(/Its `release-manifest\.json` uses schema `seal\.release\/v\d+`\./g, ''));
  for (const [id, observable, raw] of claims) {
    const sentence = raw.replace('@VERSION@', version);
    assert.equal(prose.split(sentence).length - 1, 1,
      `claim ${id} wording changed or absent; evidence required: ${observable}; expected: ${sentence}`);
    prose = prose.replace(sentence, '');
  }
  for (const nonClaim of ['This page is the SHA256SUMS verification wall.']) prose = prose.replace(nonClaim, '');
  assert.equal(normalize(prose), '', 'unreviewed generated install prose');
  assert.equal(normalize(readmeParts[0].replace(/```[^\n]*\n[\s\S]*?```/g, '')), '',
    'new generated README prose needs a claim and observable');

  const root = tempRoot.makeTempRoot(ROOT, 'install-prose');
  try {
    const assets = path.join(root, 'assets');
    fs.mkdirSync(assets);
    const artifactNames = Object.fromEntries(
      Object.entries(platformFences).map(([platform, platformFence]) => [platform, valueFrom(platformFence, 'artifact_name')]),
    );
    const checkerName = valueFrom(checkerFence, 'checker_name');
    const sumsName = valueFrom(platformFences['linux-x64'], 'sums_name');
    const allNames = [...Object.values(artifactNames), checkerName, sumsName];
    for (const name of allNames) assert.equal(path.basename(name), name, 'asset name must be a basename');
    await Promise.all(allNames.map(async name => {
      const response = await fetch(`https://github.com/velvetmonkey/seal/releases/download/${tag}/${name}`, { signal: AbortSignal.timeout(30000) });
      assert.ok(response.ok, `cannot fetch published ${name}: HTTP ${response.status}`);
      fs.writeFileSync(path.join(assets, name), Buffer.from(await response.arrayBuffer()), { mode: 0o644 });
      // The suite uses umask 077. Give the refusal experiment an explicit
      // non-executable starting mode, independent of the caller's umask.
      fs.chmodSync(path.join(assets, name), 0o644);
    }));
    for (const [platform, platformFence] of Object.entries(platformFences)) {
      assert.equal(digest(fs.readFileSync(path.join(assets, artifactNames[platform]))), valueFrom(platformFence, 'artifact_sha256'), `published ${artifactNames[platform]} digest`);
    }
    assert.equal(digest(fs.readFileSync(path.join(assets, checkerName))), valueFrom(checkerFence, 'checker_sha256'), `published ${checkerName} digest`);
    assert.equal(digest(fs.readFileSync(path.join(assets, sumsName))), valueFrom(platformFences['linux-x64'], 'sums_sha256'), `published ${sumsName} digest`);
    const shells = process.platform === 'linux' ? ['sh', 'dash', 'bash'] : ['sh', 'bash', 'zsh'];
    if (spawnSync('zsh', ['-c', 'exit 0']).status === 0 && !shells.includes('zsh')) shells.push('zsh');
    if (!shells.includes('zsh')) console.log('UNPROVABLE claim 08 in this run: zsh is unavailable; sh/dash/bash execute below');
    let sequence = 0;
    function sandbox() {
      const cwd = path.join(root, `probe-${sequence++}`);
      fs.mkdirSync(cwd);
      const home = path.join(cwd, 'home');
      fs.mkdirSync(home);
      const bin = path.join(cwd, 'bin');
      fs.mkdirSync(bin);
      // Transport only: serve already authenticated published bytes locally.
      // Hash tools, comparisons, chmod, and the artifact run for real.
      fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\nfor arg do url="$arg"; done\nname=${url##*/}\ncp -p "$PROBE_ASSETS/$name" "$name"\n', { mode: 0o755 });
      const chmod = spawnSync('sh', ['-c', 'command -v chmod'], { encoding: 'utf8' }).stdout.trim();
      fs.writeFileSync(path.join(bin, 'chmod'), `#!/bin/sh\nprintf called > chmod-called\nexec '${chmod}' "$@"\n`, { mode: 0o755 });
      fs.writeFileSync(path.join(bin, 'node'), `#!/bin/sh\nprintf '%s\\n' "$*" >> node-called\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
      return { cwd, home, env: { ...process.env, HOME: home, TMPDIR: cwd, PATH: `${bin}:${process.env.PATH}`, PROBE_ASSETS: assets } };
    }
    function execute(shell, command, box) {
      // Shell status is persisted before it is inspected, never obtained via a pipe.
      fs.writeFileSync(path.join(box.cwd, 'command.sh'), command + '\n');
      const result = spawnSync(shell, ['command.sh'], { cwd: box.cwd, env: box.env, encoding: 'utf8', timeout: 30000 });
      fs.writeFileSync(path.join(box.cwd, 'exit-status'), String(result.status));
      assert.equal(result.error, undefined, result.error?.message);
      result.status = Number(fs.readFileSync(path.join(box.cwd, 'exit-status'), 'utf8'));
      return result;
    }
    function refused(result, box, primaryName, artifactMayBeAbsent = false, installerEntered = false) {
      assert.equal(result.status, 1, result.stdout + result.stderr);
      const artifact = path.join(box.cwd, primaryName);
      if (!artifactMayBeAbsent || fs.existsSync(artifact)) assert.equal(fs.statSync(artifact).mode & 0o777, 0o644, 'artifact mode after refusal');
      assert.equal(fs.existsSync(path.join(box.cwd, 'chmod-called')), false, 'refusal reached chmod');
      assert.equal(fs.existsSync(path.join(box.cwd, 'node-called')), installerEntered, 'unexpected artifact/checker execution');
      assert.deepEqual(fs.readdirSync(box.home), [], 'refusal created install state');
    }
    // Every documented install command, whichever file or platform it names,
    // shares one shell shape (this is one template with three sets of pinned
    // values, not three hand-written commands). The digest/byte/name
    // corruption battery below is therefore run identically against all
    // four; only the real, uncorrupted run at the end distinguishes a
    // platform this CI host can actually complete an install on (linux-x64)
    // from one it can only prove refuses cleanly (darwin-arm64, darwin-x64:
    // this runner cannot become a Mac, so it proves the documented command
    // downloads, verifies, and then hits the installer's own platform gate
    // — the real macOS success path is separately proved on macOS runners
    // in .github/workflows/macos.yml, from a source build of the same
    // platform gate, not from this published-asset command).
    const commands = [
      ['darwin-arm64 install (docs/start/install.md)', platformFences['darwin-arm64'], artifactNames['darwin-arm64'], 'darwin-arm64'],
      ['darwin-x64 install (docs/start/install.md)', platformFences['darwin-x64'], artifactNames['darwin-x64'], 'darwin-x64'],
      ['linux-x64 install (docs/start/install.md)', platformFences['linux-x64'], artifactNames['linux-x64'], 'linux-x64'],
      ['README', readmeParts[0].match(/```bash\n([\s\S]*?)\n```/)[1], artifactNames['linux-x64'], 'linux-x64'],
    ];
    for (const [label, command, artifactName, platform] of commands) {
      const value = name => valueFrom(command, name);
      for (const shell of shells) {
        const good = sandbox();
        const success = execute(shell, command, good);
        if (platform === 'linux-x64') {
          assert.equal(success.status, 0, success.stdout + success.stderr);
          assert.ok(fs.existsSync(path.join(good.home, '.local/bin/seal')));
          assert.ok(success.stdout.includes(`installed seal ${version} linux-x64\n`));
          const executions = fs.readFileSync(path.join(good.cwd, 'node-called'), 'utf8');
          assert.ok(executions.includes(artifactName), 'success must execute the artifact');
          assert.ok(success.stdout.includes(`store: ${good.home}/.local/lib/seal/store/`));
          assert.ok(success.stdout.includes(`command: ${good.home}/.local/bin/seal\n`));
          const tree = success.stdout.match(/^tree: ([0-9a-f]{64})$/m)?.[1];
          assert.ok(tree && install.includes(`${platform}: ${tree}`), 'published tree pin');
        } else {
          // This CI host is linux-x64: the darwin commands' own digest and
          // byte checks pass for real (real published bytes), chmod runs,
          // and the artifact really executes — then Seal's own platform
          // gate refuses it, exactly as it would refuse a Linux artifact
          // run on a Mac (see macos.yml's "Negative control").
          assert.equal(success.status, 1, success.stdout + success.stderr);
          assert.match(success.stderr, new RegExp(`REFUSE unsupported_platform: artifact platform is ${platform}, running host is linux-x64`));
          assert.ok(fs.existsSync(path.join(good.cwd, 'chmod-called')), 'digest/bytes must verify and chmod must run before the platform refusal');
          const executions = fs.readFileSync(path.join(good.cwd, 'node-called'), 'utf8');
          assert.ok(executions.includes(artifactName), 'the artifact must actually execute to prove the refusal is the installer\'s, not the shell gate\'s');
          assert.deepEqual(fs.readdirSync(good.home), [], 'a platform refusal must not create install state');
        }
        for (const mutation of ['digest', 'bytes', 'artifact', 'sums', 'omit-version']) {
          const box = sandbox();
          let changed = command;
          if (mutation === 'digest' || mutation === 'omit-version') changed = changed.replace(value('artifact_sha256'), flip(value('artifact_sha256')));
          if (mutation === 'bytes') changed = changed.replace(`artifact_bytes=${value('artifact_bytes')}`, `artifact_bytes=${Number(value('artifact_bytes')) + 1}`);
          if (mutation === 'omit-version') changed = changed.replace(/^SEAL_VERSION=.*\n/, '');
          if (['artifact', 'sums'].includes(mutation)) {
            const name = mutation === 'artifact' ? artifactName : sumsName;
            fs.appendFileSync(path.join(box.cwd, 'bin/curl'), `if [ "$name" = '${name}' ]; then printf x >> "$name"; fi\n`);
          }
          refused(execute(shell, changed, box), box, artifactName, mutation === 'omit-version');
          console.log(`PASS claim 07 ${label}/${shell}/${mutation}: exit 1, ${fs.existsSync(path.join(box.cwd, artifactName)) ? 'mode 644' : 'artifact absent'}, no chmod, no install`);
        }
        for (const line of command.split('\n').filter(line => line.startsWith('&&'))) {
          const box = sandbox();
          const result = execute(shell, line.replace(/\\$/, ''), box);
          assert.ok(result.status > 0, 'continuation alone must be a syntax error');
          assert.match(result.stderr, /syntax error|parse error/i);
          assert.deepEqual(fs.readdirSync(box.home), []);
        }
      }
    }
    // The optional standalone checker download never chmods or executes
    // anything (it is a plain file fetched for later ad hoc use), so its
    // corruption battery only needs the shell-level digest/byte/name gate.
    for (const mutation of ['digest', 'bytes', 'name', 'sums']) {
      const box = sandbox();
      let changed = checkerFence;
      if (mutation === 'digest') changed = changed.replace(valueFrom(checkerFence, 'checker_sha256'), flip(valueFrom(checkerFence, 'checker_sha256')));
      if (mutation === 'bytes') changed = changed.replace(`checker_bytes=${valueFrom(checkerFence, 'checker_bytes')}`, `checker_bytes=${Number(valueFrom(checkerFence, 'checker_bytes')) + 1}`);
      if (['name', 'sums'].includes(mutation)) {
        const name = mutation === 'name' ? checkerName : sumsName;
        fs.appendFileSync(path.join(box.cwd, 'bin/curl'), `if [ "$name" = '${name}' ]; then printf x >> "$name"; fi\n`);
      }
      const result = execute('sh', changed, box);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      console.log(`PASS claim 19 optional checker/${mutation}: exit 1`);
    }
    for (const [label, env] of [['Windows', { SEAL_SPINE_PLATFORM: 'win32', SEAL_SPINE_ARCH: 'x64' }], ['Linux ARM', { SEAL_SPINE_PLATFORM: 'linux', SEAL_SPINE_ARCH: 'arm64' }], ['mismatch', { SEAL_SPINE_PLATFORM: 'darwin', SEAL_SPINE_ARCH: 'x64' }]]) {
      const box = sandbox();
      Object.assign(box.env, env);
      const linuxName = artifactNames['linux-x64'];
      fs.copyFileSync(path.join(assets, linuxName), path.join(box.cwd, linuxName));
      const result = execute('sh', `sh '${linuxName}' --sha256 ${valueFrom(platformFences['linux-x64'], 'artifact_sha256')} --bytes ${valueFrom(platformFences['linux-x64'], 'artifact_bytes')} --prefix "$HOME/.local"`, box);
      refused(result, box, linuxName, false, true);
      assert.match(result.stderr, /REFUSE unsupported_platform/);
      console.log(`PASS claims 03/05 ${label}: exit 1, no install`);
    }
    for (const [label, flags, status] of [
      ['missing digest', `--bytes ${valueFrom(platformFences['linux-x64'], 'artifact_bytes')}`, 1],
      ['missing bytes', `--sha256 ${valueFrom(platformFences['linux-x64'], 'artifact_sha256')}`, 0],
      ['wrong digest', `--sha256 ${flip(valueFrom(platformFences['linux-x64'], 'artifact_sha256'))}`, 1],
      ['wrong bytes', `--sha256 ${valueFrom(platformFences['linux-x64'], 'artifact_sha256')} --bytes ${Number(valueFrom(platformFences['linux-x64'], 'artifact_bytes')) + 1}`, 1],
    ]) {
      const box = sandbox();
      const linuxName = artifactNames['linux-x64'];
      fs.copyFileSync(path.join(assets, linuxName), path.join(box.cwd, linuxName));
      const result = execute('sh', `sh '${linuxName}' ${flags} --prefix "$HOME/.local"`, box);
      assert.equal(result.status, status, result.stdout + result.stderr);
      if (status === 1) refused(result, box, linuxName, false, true);
      else assert.ok(fs.existsSync(path.join(box.home, '.local/bin/seal')));
      console.log(`PASS claim 14 ${label}: exit ${status}`);
    }
    for (const [id, evidence] of claims.filter(([, evidence]) => evidence.startsWith('UNPROVABLE'))) console.log(`UNPROVABLE claim ${id}: ${evidence.slice(12)}`);
    console.log('PASS install prose: reviewed behavioural claims probe-bound across three platform commands, the README command, and the optional checker download; all generated prose accounted for');
  } finally {
    tempRoot.cleanup(root);
  }
}
main().catch(error => { console.error(`FAIL install prose: ${error.message}\n${error.stack}`); process.exitCode = 1; });
