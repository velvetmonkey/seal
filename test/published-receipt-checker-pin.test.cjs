#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const workflowPath = process.argv[2] === '--workflow' ? process.argv[3] : path.join(root, '.github/workflows/published-receipt-checker.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const field = name => workflow.match(new RegExp(`^      ${name}: (.+)$`, 'm'))?.[1];
const tag = field('PUBLISHED_CHECKER_TAG');
const pin = field('PUBLISHED_CHECKER_SHA256');

test('published checker tag is current with VERSION', () => {
  assert.match(tag || '', /^v\d+\.\d+\.\d+$/);
  const pinned = tag.slice(1).split('.').map(Number);
  const current = version.split('.').map(Number);
  assert.ok(pinned[0] > current[0] || pinned[0] === current[0] && pinned[1] >= current[1],
    `${tag} is behind VERSION ${version}`);
});

test('published checker has one reviewed lowercase SHA-256 constant', () => {
  assert.equal((workflow.match(/^      PUBLISHED_CHECKER_SHA256:/gm) || []).length, 1);
  assert.match(pin || '', /^[0-9a-f]{64}$/);
});

test('verify step rejects a self-consistent forged checker and sums entry', () => {
  const match = workflow.match(/node --input-type=module - "\$RUNNER_TEMP\/published-checker" <<'JS'\n([\s\S]*?)^          JS$/m);
  assert.ok(match, 'verify program exists');
  assert.match(pin || '', /^[0-9a-f]{64}$/);
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'seal-checker-pin-'));
  try {
    const asset = Buffer.from('console.log("stub")\n');
    const digest = crypto.createHash('sha256').update(asset).digest('hex');
    fs.writeFileSync(path.join(dir, 'seal-receipt-v2.mjs'), asset);
    fs.writeFileSync(path.join(dir, 'SHA256SUMS'), `${digest}  ${asset.length}  seal-receipt-v2.mjs\n`);
    const run = spawnSync(process.execPath, ['--input-type=module', '-', dir], {
      input: match[1], encoding: 'utf8', env: { ...process.env, PUBLISHED_CHECKER_SHA256: pin },
    });
    assert.notEqual(run.status, 0, 'forged pair passed verification');
    assert.match(run.stderr, /::error::seal-receipt-v2\.mjs digest mismatch: reviewed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
