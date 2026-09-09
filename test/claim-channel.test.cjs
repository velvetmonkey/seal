// SPDX-License-Identifier: Apache-2.0
// Execution conditions and uncovered routes are specified in claim-channel.cjs.
// Stage one routes every non-empty line captured from CLI help and the
// reachable seal verify result templates, with and without a caller key.
// It also checks the recorded authored spans exactly once at their pinned files.
// It does NOT route README or docs prose outside those pinned spans. Error and
// refusal strings, caller-fed receipt fields, MCP approval text, generated docs
// regions, and other CLI commands are outside this channel. Unexecuted branches
// are not covered. Membership does not establish truth or authenticated approval;
// an author can change both text and catalogue. The existing word scan stays.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { sha256Hex } = require('../spine/receipt-v2.cjs');
const { capture, normalize, pinnedText, productRoutes } = require('../scripts/claim-channel.cjs');
const ROOT = path.resolve(__dirname, '..');
const entries = fs.readFileSync(path.join(ROOT, 'scripts/claim-catalogue.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
assert.equal(new Set(entries.map(e => e.id)).size, entries.length, 'duplicate catalogue ID');
for (const entry of entries) {
  assert.ok(['emitted', 'pinned'].includes(entry.kind), `unknown member kind: ${entry.id}`);
  assert.equal(entry.text, entry.kind === 'emitted' ? normalize(entry.text) : pinnedText(entry.text));
  assert.ok(entry.text.length > 0);
  assert.equal(entry.sha256, sha256Hex(entry.text), `catalogue digest: ${entry.id}`);
}

// CLAIM-COVERAGE: scripts/claim-catalogue.jsonl#catalogue-membership
test('every captured CLI line has exact text and product digest membership', () => {
  const members = entries.filter(e => e.kind === 'emitted');
  assert.ok(members.length > 0, 'emitted catalogue is empty');
  assert.equal(new Set(members.map(e => e.text)).size, members.length, 'duplicate emitted member');
  const surfaces = capture();
  const routes = productRoutes();
  for (const surface of ['help', 'verify-no-key', 'verify-caller-key']) {
    for (const route of routes[surface === 'help' ? 'help' : 'verify']) {
      assert.deepEqual(surfaces.filter(s => s.surface === surface && s.route === route).map(s => s.condition).sort(),
        ['pipe-configured', 'pipe-plain', 'pty-configured', 'pty-plain'], `${surface}/${route ?? '<bare>'}: required observation missing`);
    }
  }
  for (const [surface, found] of Object.entries(routes)) console.log(`ROUTES ${surface} ${found.length} ${JSON.stringify(found)}`);
  for (const { surface, route, condition, lines } of surfaces) for (const text of lines) {
    // Absence is red inside the channel, even when no claim word occurs.
    assert.ok(members.some(e => e.text === text && e.sha256 === sha256Hex(text)),
      `ABSENCE IS RED INSIDE THE CHANNEL: ${surface}/${route ?? '<bare>'}/${condition}: ${JSON.stringify(text)}`);
  }
  for (const { surface, route, condition, lines } of surfaces) console.log(`CAPTURE ${surface} ${route ?? '<bare>'} ${condition} LINES ${lines.length}`);
  console.log(`SURFACES ${new Set(surfaces.map(s => s.surface)).size} CONDITIONS ${surfaces.length} LINES CAPTURED ${surfaces.reduce((n, s) => n + s.lines.length, 0)} CATALOGUE EMITTED ${members.length}`);
});

test('authored catalogue members occur exactly once at their recorded files', () => {
  const pinned = entries.filter(e => e.kind === 'pinned');
  assert.equal(pinned.length, 22, 'authored population must remain accounted for');
  for (const entry of pinned) {
    assert.ok(entry.file && !path.isAbsolute(entry.file) && !entry.file.split('/').includes('..'));
    const text = pinnedText(fs.readFileSync(path.join(ROOT, entry.file), 'utf8'));
    let count = 0;
    for (let at = text.indexOf(entry.text); at !== -1; at = text.indexOf(entry.text, at + 1)) count++;
    assert.equal(count, 1, `${entry.id}: wording absent or duplicated at ${entry.file}`);
  }
  console.log(`CATALOGUE PINNED ${pinned.length}`);
});

test('presentation normalization preserves textual changes and terminal controls', () => {
  assert.equal(normalize('\x1b[1mknown line\x1b[0m\u00a0'), 'known line');
  assert.equal(normalize('known\u00a0line'), 'known\u00a0line');
  assert.equal(normalize('known line\x1b[2K\rnew claim'), 'known line\x1b[2K\rnew claim');
  assert.equal(normalize('an un\x1b[1mcatalogued\x1b[0m claim'), 'an uncatalogued claim');
});
