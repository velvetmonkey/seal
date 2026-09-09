// SPDX-License-Identifier: Apache-2.0
// Execute the CLI; source literals are never used to discover emitted members.
// Coverage: help and successful receipt inspection with/without a caller key,
// each under pipes and an 80x24 controlling Unix pseudo-terminal, each with
// cache/data overrides present and absent. Children use a minimal environment:
// PATH, isolated HOME/TMPDIR, C.UTF-8 locale, TERM=dumb; the configured profile
// adds SEAL_CACHE_DIR and XDG_DATA_HOME. Inherited runtime/debug flags are absent.
// The PTY master captures stdout, stderr AND writes to that child's /dev/tty.
// Requires python3 with Unix pty support; unavailable/broken capture fails closed.
// Other environments, terminal sizes/types, inputs, timing, platforms, commands,
// errors/refusals and unexecuted branches are outside these finite observations.
// A line printed only outside these conditions is not routed. This is not every
// sentence a user can see. Catalogue membership is not truth or human approval.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeTempRoot, cleanup } = require('./temp-root.cjs');
const { canonical, generateSigner, sealReceipt } = require('../spine/receipt-v2.cjs');
const { createKernelAuthorizationAdapter } = require('../contract/kernel-authorization.cjs');
const ROOT = path.resolve(__dirname, '..');
// SGR changes presentation, not text. Do not discard cursor movement, OSC or
// arbitrary escape sequences. End padding includes NBSP; internal text is exact.
const normalize = text => text.replace(/\x1b\[[0-9;:]*m/g, '').replace(/^[ \t\u00a0]+|[ \t\u00a0]+$/g, '');
const lines = text => text.split(/\r?\n/).map(normalize).filter(text => text !== '');
// Pinned authored spans may wrap across Markdown quotes or source comments.
const pinnedText = text => text.replace(/^\s*(?:\/\/|>) ?/gm, '').replace(/\s+/g, ' ').trim();
// Embedded adapter keeps this within the existing capture control. pty.fork
// gives the child a controlling terminal, unlike redirecting only its streams.
const PTY = `import errno, fcntl, os, pty, struct, sys, termios
pid, master = pty.fork()
if pid == 0:
    fcntl.ioctl(1, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
    os.execv(sys.argv[1], sys.argv[1:])
try:
    while True:
        try:
            data = os.read(master, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise
        if not data:
            break
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
finally:
    os.close(master)
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status) if os.WIFEXITED(status) else 125)
`;
function capture() {
  const box = makeTempRoot(ROOT, 'claim-channel');
  try {
    const tool = 'db.execute';
    const args = { database: 'demo', sql: 'drop table users' };
    const record = createKernelAuthorizationAdapter().authorize({
      epoch: 1, issuedTool: tool, issuedArgs: args, retryTool: tool,
      retryArgs: args, accepted: true, now: 1000,
    }).receipt_record;
    const signer = generateSigner();
    const receipt = path.join(box, 'receipt.json');
    fs.writeFileSync(receipt, canonical(sealReceipt(signer, record, 'ALLOW')), { mode: 0o600 });
    const surfaces = [
      ['help', ['--help'], 0],
      ['verify-no-key', ['verify', receipt], 1],
      ['verify-caller-key', ['verify', receipt, '--pubkey', signer.publicKeyHex], 0],
    ];
    const observations = [];
    for (const [surface, args, expected] of surfaces) {
      for (const configured of [true, false]) for (const terminal of [false, true]) {
        const condition = `${terminal ? 'pty' : 'pipe'}-${configured ? 'configured' : 'plain'}`;
        const home = path.join(box, `${surface}-${condition}-home`);
        fs.mkdirSync(home);
        const env = {
          PATH: process.env.PATH || '/usr/bin:/bin', HOME: home, TMPDIR: box,
          LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TERM: 'dumb',
          ...(configured ? { SEAL_CACHE_DIR: path.join(home, 'cache'), XDG_DATA_HOME: home } : {}),
        };
        const command = [process.execPath, path.join(ROOT, 'bin/seal'), ...args];
        const result = spawnSync(terminal ? 'python3' : command[0],
          terminal ? ['-c', PTY, ...command] : command.slice(1), {
            cwd: box, encoding: 'utf8', timeout: 30000, env,
          });
        const label = `${surface}/${condition}`;
        const statusFile = path.join(box, `${surface}-${condition}.exit`);
        fs.writeFileSync(statusFile, String(result.status));
        assert.ifError(result.error);
        assert.equal(result.signal, null, `${label}: runner terminated`);
        assert.equal(fs.readFileSync(statusFile, 'utf8'), String(expected), `${label}: runner failed: ${result.stdout}${result.stderr}`);
        const output = lines(result.stdout + result.stderr);
        assert.ok(output.length > 0, `${label}: runner emitted nothing`);
        observations.push({ surface, condition, lines: output });
      }
    }
    return observations;
  } finally { cleanup(box); }
}
module.exports = { capture, normalize, lines, pinnedText };
