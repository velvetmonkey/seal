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
const claims = [
  ['01', 'UNPROVABLE: full Protect execution on all named hosts', 'This checkout supports Protect on Linux x86-64 and macOS x64/arm64.'],
  ['02', 'UNPROVABLE: independent reproduction is external evidence', 'The native macOS process-start witness helper is release-produced, not independently reproduced.'],
  ['03', 'platform refusal', 'Windows and Linux ARM are unsupported.'],
  ['04', 'UNPROVABLE: minimum Node major across supported hosts', 'Node 20+ is required.'],
  ['05', 'platform refusal', 'The installer refuses before changing anything on an unsupported or mismatched platform.'],
  ['06', 'both fences: success and corruption', 'The [README](../../README.md) short form uses the same shell gate.'],
  ['07', 'both fences: corruption, status, mode, no install', 'In every install command below, a failed checksum comparison prevents both `chmod` and execution of the artifact.'],
  ['08', 'shell execution; unavailable shells explicitly reported', 'The commands use POSIX syntax for `sh`, `dash`, `bash`, and `zsh`.'],
  ['09', 'unmodified fence in fresh shells', 'Copy each whole command, including its continuation backslashes and `&&` operators; there is no shell-option preamble.'],
  ['10', 'omitted version with corruption', 'The release version is a separate assignment; omitting it cannot remove the verification gate.'],
  ['11', 'every continuation parsed alone', 'Each continuation starts with `&&`, so copying a continuation alone produces a syntax error.'],
  ['12', 'OS digest tools, corrupted artifacts and checksum file', 'The digest comparison below is *your* check, with the OS SHA-256 tool, against the `SHA256SUMS` asset attached to the same GitHub release.'],
  ['13', 'mode 644 plus no execution trace after corruption', 'That is not the installer checking itself.'],
  ['14', 'direct installer with omitted and wrong pins', 'The `--sha256` flag is a second pin the installer demands and will refuse without. The optional `--bytes` flag adds a length check.'],
  ['15', 'success, corrupt artifact, wrong digest and byte count', 'Together they answer "did I download the bytes the release named?"'],
  ['16', 'UNPROVABLE: publisher honesty is not a byte observable', 'They do not answer "is the publisher honest?"'],
  ['17', 'published installer stdout and installed command', 'Success prints `installed seal @VERSION@ linux-x64` and the store, command, and tree lines.'],
  ['18', 'success at two isolated prefixes', 'Path prefixes on `store:` and `command:` differ per machine.'],
  ['19', 'checker corruption and no checker execution', 'The downloaded checker is only checked against `SHA256SUMS`; from a source checkout, run `node checker/seal-receipt-v2.mjs docs/reference/receipt-operations-v1/receipt-block.json`.'],
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
  ],
  'README.md': [
    ['21', 'test/frontdoor.test.mjs: README exact-call demo', 'Seal is a local approval boundary for AI-agent tool calls.'],
    ['22', 'test/frontdoor.test.mjs: README exact-call demo', 'Seal decides whether that exact call may cross the boundary.'],
    ['23', 'UNPROVABLE: full Protect execution on all named hosts (claim 01)', 'Seal supports install, demo, receipt checking and Protect on Linux x86-64 and macOS x64/arm64.'],
    ['24', 'test/frontdoor.test.mjs#readme: approval, replay refusal, child count', 'Seal holds each exact call, asks once, permits at most one execution, and writes a signed receipt.'],
    ['25', 'test/protect3b.test.cjs: protect and unprotect leave project .mcp.json byte-identical by hash', "The command removes Seal's local override and reports that the sealed MCP route is outside Seal."],
    ['26', 'UNPROVABLE here: command absence in the historical published release', '`seal recover` is not in the currently published release, v0.2.1.'],
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
  assert.equal(parts.length, 2, 'install generated-region population');
  const readmeParts = regions(readme);
  assert.equal(readmeParts.length, 1, 'README generated-region population');
  const fence = parts.join('\n').match(/```bash\n(SEAL_VERSION=[\s\S]*?)\n```/)?.[1];
  assert.ok(fence, 'published install fence absent');
  const tag = fence.match(/^SEAL_VERSION=(\S+)/)[1];
  const version = tag.slice(1);
  const value = name => {
    const found = fence.match(new RegExp(`(?:^|&& )${name}="?([^"\\s]+)`, 'm'));
    assert.ok(found, `missing ${name}`);
    return found[1];
  };
  // Facts retain their independent published-release checks. Remove only their
  // entire known sentence shapes; never discard an arbitrary line of prose.
  let prose = normalize(parts.join('\n').replace(/```[^\n]*\n[\s\S]*?```/g, '')
    .replace(`# Install Seal ${tag}`, '')
    .replace('## Verify, then install', '')
    .replace(/The \[v[^\]]+ release\]\([^)]*\) publishes `[^`]+`(?:, `[^`]+`)*, and `[^`]+`; its tag resolves to commit \[\x60[0-9a-f]{40}\x60\]\([^)]*\)\./g, '')
    .replace(/Its `release-manifest\.json` uses schema `seal\.release\/v\d+`\./g, '')
    .replace(/The tree hash of the published v[^ ]+ asset is pinned here:/g, '')
    .replace('**Seal installed-tree pin role:** `published-asset`', ''));
  for (const [id, observable, raw] of claims) {
    const sentence = raw.replace('@VERSION@', version);
    assert.equal(prose.split(sentence).length - 1, 1,
      `claim ${id} wording changed or absent; evidence required: ${observable}; expected: ${sentence}`);
    prose = prose.replace(sentence, '');
  }
  for (const nonClaim of [
    'This page is the SHA256SUMS verification wall.',
    'Add `~/.local/bin` to PATH:',
    'Further distribution detail, including what each payload contains, is in [DISTRIBUTION.md](../assurance/distribution.md).',
  ]) prose = prose.replace(nonClaim, '');
  assert.equal(normalize(prose), '', 'unreviewed generated install prose');
  assert.equal(normalize(readmeParts[0].replace(/```[^\n]*\n[\s\S]*?```/g, '')), '',
    'new generated README prose needs a claim and observable');

  const root = tempRoot.makeTempRoot(ROOT, 'install-prose');
  try {
    const assets = path.join(root, 'assets');
    fs.mkdirSync(assets);
    const names = [value('artifact_name'), value('checker_name'), value('sums_name')];
    for (const name of names) assert.equal(path.basename(name), name, 'asset name must be a basename');
    await Promise.all(names.map(async name => {
      const response = await fetch(`https://github.com/velvetmonkey/seal/releases/download/${tag}/${name}`, { signal: AbortSignal.timeout(30000) });
      assert.ok(response.ok, `cannot fetch published ${name}: HTTP ${response.status}`);
      fs.writeFileSync(path.join(assets, name), Buffer.from(await response.arrayBuffer()), { mode: 0o644 });
      // The suite uses umask 077. Give the refusal experiment an explicit
      // non-executable starting mode, independent of the caller's umask.
      fs.chmodSync(path.join(assets, name), 0o644);
    }));
    for (const [name, pin] of [[names[0], 'artifact_sha256'], [names[1], 'checker_sha256'], [names[2], 'sums_sha256']]) {
      assert.equal(digest(fs.readFileSync(path.join(assets, name))), value(pin), `published ${name} digest`);
    }
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
    function refused(result, box, artifactMayBeAbsent = false, installerEntered = false) {
      assert.equal(result.status, 1, result.stdout + result.stderr);
      const artifact = path.join(box.cwd, names[0]);
      if (!artifactMayBeAbsent || fs.existsSync(artifact)) assert.equal(fs.statSync(artifact).mode & 0o777, 0o644, 'artifact mode after refusal');
      assert.equal(fs.existsSync(path.join(box.cwd, 'chmod-called')), false, 'refusal reached chmod');
      assert.equal(fs.existsSync(path.join(box.cwd, 'node-called')), installerEntered, 'unexpected artifact/checker execution');
      assert.deepEqual(fs.readdirSync(box.home), [], 'refusal created install state');
    }
    const short = readmeParts[0].match(/```bash\n([\s\S]*?)\n```/)[1];
    for (const [label, command] of [['install', fence], ['README', short]]) {
      for (const shell of shells) {
        const good = sandbox();
        const success = execute(shell, command, good);
        assert.equal(success.status, 0, success.stdout + success.stderr);
        assert.ok(fs.existsSync(path.join(good.home, '.local/bin/seal')));
        assert.ok(success.stdout.includes(`installed seal ${version} linux-x64\n`));
        const executions = fs.readFileSync(path.join(good.cwd, 'node-called'), 'utf8');
        assert.ok(executions.includes(names[0]), 'success must execute the artifact');
        assert.ok(!executions.includes(names[1]), 'downloaded checker must not be executed');
        assert.ok(success.stdout.includes(`store: ${good.home}/.local/lib/seal/store/`));
        assert.ok(success.stdout.includes(`command: ${good.home}/.local/bin/seal\n`));
        const tree = success.stdout.match(/^tree: ([0-9a-f]{64})$/m)?.[1];
        assert.ok(tree && install.includes(`tree: ${tree}`), 'published tree transcript');
        for (const mutation of ['digest', 'bytes', 'artifact', 'sums', ...(label === 'install' ? ['checker'] : []), 'omit-version']) {
          const box = sandbox();
          let changed = command;
          if (mutation === 'digest' || mutation === 'omit-version') changed = changed.replace(value('artifact_sha256'), flip(value('artifact_sha256')));
          if (mutation === 'bytes') changed = changed.replace(`artifact_bytes=${value('artifact_bytes')}`, `artifact_bytes=${Number(value('artifact_bytes')) + 1}`);
          if (mutation === 'omit-version') changed = changed.replace(/^SEAL_VERSION=.*\n/, '');
          if (['artifact', 'sums', 'checker'].includes(mutation)) {
            const name = names[{ artifact: 0, checker: 1, sums: 2 }[mutation]];
            fs.appendFileSync(path.join(box.cwd, 'bin/curl'), `if [ "$name" = '${name}' ]; then printf x >> "$name"; fi\n`);
          }
          refused(execute(shell, changed, box), box, mutation === 'omit-version');
          console.log(`PASS claim 07 ${label}/${shell}/${mutation}: exit 1, ${fs.existsSync(path.join(box.cwd, names[0])) ? 'mode 644' : 'artifact absent'}, no chmod, no install`);
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
    for (const [label, env] of [['Windows', { SEAL_SPINE_PLATFORM: 'win32', SEAL_SPINE_ARCH: 'x64' }], ['Linux ARM', { SEAL_SPINE_PLATFORM: 'linux', SEAL_SPINE_ARCH: 'arm64' }], ['mismatch', { SEAL_SPINE_PLATFORM: 'darwin', SEAL_SPINE_ARCH: 'x64' }]]) {
      const box = sandbox();
      Object.assign(box.env, env);
      fs.copyFileSync(path.join(assets, names[0]), path.join(box.cwd, names[0]));
      const result = execute('sh', `sh '${names[0]}' --sha256 ${value('artifact_sha256')} --bytes ${value('artifact_bytes')} --prefix "$HOME/.local"`, box);
      refused(result, box, false, true);
      assert.match(result.stderr, /REFUSE unsupported_platform/);
      console.log(`PASS claims 03/05 ${label}: exit 1, no install`);
    }
    for (const [label, flags, status] of [
      ['missing digest', `--bytes ${value('artifact_bytes')}`, 1],
      ['missing bytes', `--sha256 ${value('artifact_sha256')}`, 0],
      ['wrong digest', `--sha256 ${flip(value('artifact_sha256'))}`, 1],
      ['wrong bytes', `--sha256 ${value('artifact_sha256')} --bytes ${Number(value('artifact_bytes')) + 1}`, 1],
    ]) {
      const box = sandbox();
      fs.copyFileSync(path.join(assets, names[0]), path.join(box.cwd, names[0]));
      const result = execute('sh', `sh '${names[0]}' ${flags} --prefix "$HOME/.local"`, box);
      assert.equal(result.status, status, result.stdout + result.stderr);
      if (status === 1) refused(result, box, false, true);
      else assert.ok(fs.existsSync(path.join(box.home, '.local/bin/seal')));
      console.log(`PASS claim 14 ${label}: exit ${status}`);
    }
    for (const [id, evidence] of claims.filter(([, evidence]) => evidence.startsWith('UNPROVABLE'))) console.log(`UNPROVABLE claim ${id}: ${evidence.slice(12)}`);
    console.log('PASS install prose: 19 reviewed behavioural claims (20 sentences after pin clarification), 15 probe-bound, 4 UNPROVABLE; all generated prose accounted for');
  } finally {
    tempRoot.cleanup(root);
  }
}
main().catch(error => { console.error(`FAIL install prose: ${error.message}`); process.exitCode = 1; });
