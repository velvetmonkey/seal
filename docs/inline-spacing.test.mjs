// SPDX-License-Identifier: Apache-2.0
// Run against the real Astro output, after finalization. Removing tags must not
// invent spaces: doing so would hide newline loss beside inline links.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./dist/index.html', import.meta.url), 'utf8');
const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<!--[^]*?-->/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/\s+/g, ' ');

for (const sentence of [
  'Only selected calls routed through Seal are gated. Bash, direct access and other routes remain outside its control. Read the limits.',
  'The decision leaves a signed receipt. Open it in the browser checker or use the assurance CLI to see what the recorded evidence establishes.',
  'Read the current assurance scope for the evidence and remaining assumptions.',
  'open the browser checker guide to run this yourself against the example receipt and its demo public key.',
]) {
  test(`built inline links preserve word boundaries: ${sentence}`, () => {
    assert.ok(text.includes(sentence), `built page lost whitespace: ${sentence}`);
  });
}
