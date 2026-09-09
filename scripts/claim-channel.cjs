// SPDX-License-Identifier: Apache-2.0
// Execute the CLI; source literals are never used to discover emitted members.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeTempRoot, cleanup } = require('./temp-root.cjs');
const { canonical, generateSigner, sealReceipt } = require('../spine/receipt-v2.cjs');
const { createKernelAuthorizationAdapter } = require('../contract/kernel-authorization.cjs');
const ROOT = path.resolve(__dirname, '..');
// Only horizontal ASCII padding at the ends of each emitted line is discarded.
const normalize = text => text.replace(/^[ \t]+|[ \t]+$/g, '');
const lines = text => text.split(/\r?\n/).map(normalize).filter(text => text !== '');
// Pinned authored spans may wrap across Markdown quotes or source comments.
const pinnedText = text => text.replace(/^\s*(?:\/\/|>) ?/gm, '').replace(/\s+/g, ' ').trim();
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
    return surfaces.map(([surface, args, expected]) => {
      const result = spawnSync(process.execPath, [path.join(ROOT, 'bin/seal'), ...args], {
        cwd: box, encoding: 'utf8', timeout: 30000,
        env: { ...process.env, SEAL_CACHE_DIR: path.join(box, 'cache'), XDG_DATA_HOME: box },
      });
      const statusFile = path.join(box, `${surface}.exit`);
      fs.writeFileSync(statusFile, String(result.status));
      assert.ifError(result.error);
      assert.equal(result.signal, null, `${surface}: runner terminated`);
      assert.equal(fs.readFileSync(statusFile, 'utf8'), String(expected), `${surface}: runner failed: ${result.stdout}${result.stderr}`);
      const output = lines(result.stdout + result.stderr);
      assert.ok(output.length > 0, `${surface}: runner emitted nothing`);
      return { surface, lines: output };
    });
  } finally { cleanup(box); }
}
module.exports = { capture, normalize, lines, pinnedText };
