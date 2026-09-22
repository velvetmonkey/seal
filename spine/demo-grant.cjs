// SPDX-License-Identifier: Apache-2.0
// Single-user demonstration. No issuance and no protection from a same-user shell.
'use strict';
const crypto = require('node:crypto');
const PROFILE = 'seal-execution-grant/v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const HEX = /^[0-9a-f]{64}$/;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, names) => object(x) && Object.keys(x).sort().join(',') === [...names].sort().join(',');
const fail = code => { throw Object.assign(new Error(code), { refusal: true, code }); };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
// JCS on the admitted ASCII-string / safe-integer / object subset.
function canonical(x) {
  if (object(x)) return `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
  return JSON.stringify(x);
}

// Scan before JSON.parse: bounded recursion, decoded duplicate names, fatal UTF-8.
function parse(bytes, limit, depth, malformed) {
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8');
  if (raw.length > limit || raw.subarray(0, 3).equals(Buffer.from([239,187,191]))) fail(malformed);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { fail(malformed); }
  let i = 0;
  const ws = () => { while (/[\t\r\n ]/.test(text[i] || '')) i++; };
  function string() {
    const start = i;
    if (text[i++] !== '"') fail(malformed);
    while (i < text.length) {
      const c = text[i++];
      if (c === '\\') i++;
      else if (c === '"') {
        try { return JSON.parse(text.slice(start, i)); } catch { fail(malformed); }
      }
    }
    fail(malformed);
  }
  function value(d) {
    ws();
    if (text[i] === '"') { string(); return; }
    if (text[i] === '{' || text[i] === '[') {
      if (d > depth) fail(malformed);
      const obj = text[i++] === '{', end = obj ? '}' : ']';
      const names = new Set(); ws();
      if (text[i] === end) { i++; return; }
      for (;;) {
        if (obj) {
          ws(); const name = string();
          if (names.has(name)) fail('duplicate_member');
          names.add(name); ws(); if (text[i++] !== ':') fail(malformed);
        }
        value(d + 1); ws();
        if (text[i] === end) { i++; return; }
        if (text[i++] !== ',') fail(malformed);
      }
    }
    const m = text.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/);
    if (!m) fail(malformed);
    i += m[0].length;
  }
  value(1); ws(); if (i !== text.length) fail(malformed);
  try { return { value: JSON.parse(text), text }; } catch { fail(malformed); }
}
function policy(g, config) {
  const key = config.keys.find(k => k.id === g.issuer.id && k.key_id === g.issuer.key_id);
  if (!key || key.purpose !== PROFILE) fail('key_not_enrolled');
  if (key.revoked) fail('key_revoked');
  let publicKey;
  try { publicKey = crypto.createPublicKey(key.public_key_pem); } catch { fail('key_not_enrolled'); }
  if (publicKey.asymmetricKeyType !== 'ed25519') fail('key_not_enrolled');
  return { key, publicKey };
}
function scope(key, config) {
  if (!key.audiences?.includes(config.audience) || !key.profiles?.includes(PROFILE) || !key.tools?.includes('demo.mutate')) fail('issuer_scope_refused');
}
function time(g, interval) {
  const { L, U } = interval;
  if (!Number.isFinite(L) || !Number.isFinite(U) || L < 0 || U < L || U - L > 2) fail('clock_untrusted');
  if (U >= g.expires_at) fail('expired');
  if (g.expires_at > L + 120) fail('expiry_too_far');
}
function verify(params, config, interval) {
  if (!object(params)) fail('request_malformed');
  if (!Object.hasOwn(params, 'grant')) fail('grant_missing');
  if (!exact(params, ['name','arguments','grant','receipt_sha256']) || typeof params.grant !== 'string') fail('request_malformed');
  const { value: g, text } = parse(params.grant, 2048, 2, 'grant_malformed');
  if (!exact(g, ['profile','issuer','audience','grant_id','effect_sha256','expires_at','signature']) ||
      typeof g.profile !== 'string' || !/^[\x20-\x7e]*$/.test(g.profile) ||
      !exact(g.issuer, ['id','key_id']) || ![g.issuer.id,g.issuer.key_id,g.audience].every(x => typeof x === 'string' && ID.test(x)) ||
      ![g.grant_id,g.effect_sha256].every(x => typeof x === 'string' && HEX.test(x)) ||
      !Number.isSafeInteger(g.expires_at) || g.expires_at < 0 ||
      typeof g.signature !== 'string' || !/^[0-9a-f]{128}$/.test(g.signature)) fail('schema_invalid');
  if (text !== canonical(g)) fail('encoding_noncanonical');
  if (g.profile !== PROFILE) fail('profile_unsupported');
  const { key, publicKey } = policy(g, config);
  const { signature, ...unsigned } = g;
  const body = canonical(unsigned);
  if (!crypto.verify(null, Buffer.from('SEAL-EXECUTION-GRANT/v1\0' + body), publicKey, Buffer.from(signature, 'hex'))) fail('signature_invalid');
  if (g.audience !== config.audience) fail('audience_mismatch');
  scope(key, config);
  time(g, interval);
  if (params.name !== 'demo.mutate' || !exact(params.arguments, ['line']) ||
      typeof params.arguments.line !== 'string' || !/^[\x20-\x7e]{0,256}$/.test(params.arguments.line) ||
      typeof params.receipt_sha256 !== 'string' || !HEX.test(params.receipt_sha256)) fail('effect_invalid');
  const effect = { profile: 'seal-demo-effect/v1', audience: config.audience, resource: 'demo-data',
    tool: params.name, arguments: { line: params.arguments.line }, receipt_sha256: params.receipt_sha256 };
  if (sha(canonical(effect)) !== g.effect_sha256) fail('effect_mismatch');
  return { g, key_sha256: sha(publicKey.export({ type: 'spki', format: 'der' })), body_sha256: sha(body), effect, bytes: Buffer.from(params.arguments.line + '\n', 'ascii') };
}
// A key ID is a lookup name, not permission to substitute its key mid-call.
function recheck(frozen, config, interval) {
  let current;
  try { current = policy(frozen.g, config); } catch { fail('key_revoked'); }
  if (sha(current.publicKey.export({ type: 'spki', format: 'der' })) !== frozen.key_sha256) fail('key_revoked');
  scope(current.key, config);
  time(frozen.g, interval);
}
module.exports = { PROFILE, ID, exact, fail, sha, canonical, parse, policy, scope, time, verify, recheck };
