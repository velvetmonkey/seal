#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Explicit single emitted-line admission after review, never automatic capture.
// Usage: node scripts/admit-claim-line.cjs ID 'reviewed new text'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256Hex } = require('../spine/receipt-v2.cjs');
const { normalize } = require('./claim-channel.cjs');
const [id, raw, ...extra] = process.argv.slice(2);
assert.ok(id && raw && extra.length === 0, 'usage: admit-claim-line.cjs ID TEXT');
assert.ok(!/[\r\n]/.test(raw), 'admit one line only');
const text = normalize(raw);
assert.ok(text.length > 0);
const file = path.join(__dirname, 'claim-catalogue.jsonl');
const entries = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
const index = entries.findIndex(e => e.id === id);
assert.ok(index === -1 || entries[index].kind === 'emitted', 'pinned entries need separate evidence review');
assert.ok(!entries.some(e => e.id !== id && e.kind === 'emitted' && e.text === text), 'already admitted');
const entry = { id, kind: 'emitted', text, sha256: sha256Hex(text) };
if (index === -1) entries.push(entry); else entries[index] = entry;
fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
console.log(JSON.stringify(entry));
