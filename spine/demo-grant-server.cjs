// SPDX-License-Identifier: Apache-2.0
// Single-user demonstration: protocol validation, NOT same-user shell isolation.
// Trusted setup provisions DATAFILE, DATAFILE.count (0\n), DATAFILE.grant.json,
// and DATAFILE.spends/identity containing the configured audience. Startup never
// creates/resets them. Configuration is operator-owned, never an RPC input:
// {audience, clock_trusted:true, keys:[{id,key_id,purpose,public_key_pem,
// revoked:false,audiences:[...],profiles:[...],tools:['demo.mutate']}]}
// All users of a resource MUST use this one path/store/lock. Protect its parents.
// An exclusive lifetime lock fences other children. After an unclean exit the
// operator must confirm all old executors are dead before removing the lock.
// Every startup waits 124 monotonic seconds AND L > startup U+120. No auto-retry.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const v = require('./demo-grant.cjs');
const { writeCompleteSync } = require('./write.cjs');
const NOFOLLOW = fs.constants.O_NOFOLLOW;
function syncDir(dir) { const fd = fs.openSync(dir, fs.constants.O_RDONLY | NOFOLLOW); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function regular(file, flags) {
  const fd = fs.openSync(file, flags | NOFOLLOW);
  if (!fs.fstatSync(fd).isFile()) { fs.closeSync(fd); throw new Error('not regular'); }
  return fd;
}
function read(file) { const fd = regular(file, fs.constants.O_RDONLY); try { return fs.readFileSync(fd, 'utf8'); } finally { fs.closeSync(fd); } }
function same(file, fd) { const a = fs.lstatSync(file), b = fs.fstatSync(fd); return a.isFile() && a.dev === b.dev && a.ino === b.ino && a.nlink === 1; }

function createTarget(dataFile, { clock = () => { const n = Date.now()/1000; return { L: n-1, U: n+1 }; },
  monotonic = () => Number(process.hrtime.bigint())/1e9 } = {}) {
  // Injectable clocks are module-level test dependencies, never command flags,
  // environment variables, config values or request fields.
  dataFile = path.resolve(dataFile);
  const store = dataFile + '.spends', lock = dataFile + '.grant-lock';
  let dataFd, countFd, lockFd, storeStat, startup, started, previous, previousMono, audience, poison;
  const close = () => {
    for (const fd of [dataFd, countFd]) if (fd !== undefined) fs.closeSync(fd);
    dataFd = countFd = undefined;
    if (lockFd !== undefined) {
      if (same(lock, lockFd)) { fs.unlinkSync(lock); syncDir(path.dirname(lock)); }
      fs.closeSync(lockFd); lockFd = undefined;
    }
  };
  function config() {
    let c;
    try { c = v.parse(read(dataFile + '.grant.json'), 65536, 5, 'target_unready').value; } catch { v.fail('target_unready'); }
    if (!c || typeof c.audience !== 'string' || !v.ID.test(c.audience) || !Array.isArray(c.keys) || !c.keys.length || (audience && c.audience !== audience)) v.fail('target_unready');
    if (c.clock_trusted !== true) v.fail('clock_untrusted');
    return c;
  }
  function interval() {
    const t = clock(), m = monotonic();
    if (!Number.isFinite(t.L) || !Number.isFinite(t.U) || t.L < 0 || t.U < t.L || t.U-t.L > 2 ||
        !Number.isFinite(m) || (previous && (t.L < previous.L || t.U < previous.U || m < previousMono || Math.abs((t.L-previous.L)-(m-previousMono)) > 2))) {
      poison = 'clock_untrusted'; v.fail(poison);
    }
    previous = t; previousMono = m; return t;
  }
  function storeReady() {
    try {
      const s = fs.lstatSync(store);
      if (!s.isDirectory() || s.dev !== storeStat.dev || s.ino !== storeStat.ino || read(path.join(store,'identity')) !== audience+'\n') throw new Error();
    } catch { poison = 'store_quarantine'; v.fail(poison); }
  }
  function resources() {
    try {
      if (!same(dataFile,dataFd) || !same(dataFile+'.count',countFd) || !same(lock,lockFd)) throw new Error();
      const buf = Buffer.alloc(64); const n = fs.readSync(countFd,buf,0,64,0);
      if (!/^(0|[1-9][0-9]*)\n$/.test(buf.subarray(0,n).toString()) || !Number.isSafeInteger(Number(buf.subarray(0,n).toString())+1)) throw new Error();
      return Number(buf.subarray(0,n).toString());
    } catch { v.fail('resource_unavailable'); }
  }
  function ready() {
    if (poison) v.fail(poison);
    const c = config(), t = interval(); storeReady();
    try { if (!same(lock,lockFd)) throw new Error(); } catch { poison='target_unready'; v.fail(poison); }
    if (monotonic()-started < 124 || t.L <= startup.U+120) v.fail('store_quarantine');
    return { c, t };
  }
  try {
    const c = config(); audience=c.audience;
    lockFd=fs.openSync(lock,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|NOFOLLOW,0o600);
    writeCompleteSync(lockFd, String(process.pid)+'\n'); fs.fsyncSync(lockFd); syncDir(path.dirname(lock));
    storeStat=fs.lstatSync(store); storeReady();
    dataFd=regular(dataFile,fs.constants.O_WRONLY|fs.constants.O_APPEND);
    countFd=regular(dataFile+'.count',fs.constants.O_RDWR);
    resources(); startup=interval(); started=monotonic();
  } catch (e) { poison=e.refusal ? e.code : 'target_unready'; }

  function spend(frozen, t) {
    storeReady();
    const {g,body_sha256,effect}=frozen;
    const key=v.sha(v.canonical({issuer:g.issuer.id,audience,grant_id:g.grant_id}));
    const dest=path.join(store,key);
    let fd;
    try { fd=fs.openSync(dest,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|NOFOLLOW,0o600); }
    catch(e) {
      if (e.code !== 'EEXIST') v.fail('store_unavailable');
      let old;
      try { old=JSON.parse(read(dest)); } catch { poison='store_uncertain'; v.fail(poison); }
      if (old.status !== 'SPENT' || typeof old.body_sha256 !== 'string') { poison='store_uncertain'; v.fail(poison); }
      // Atomic O_EXCL insert: an existing tombstone NEVER authorizes execution.
      v.fail(old.body_sha256 === body_sha256 ? 'already_spent' : 'grant_id_conflict');
    }
    try {
      writeCompleteSync(fd,JSON.stringify({issuer:g.issuer.id,audience,grant_id:g.grant_id,profile:g.profile,key_id:g.issuer.key_id,
        body_sha256,effect,effect_sha256:g.effect_sha256,expires_at:g.expires_at,consumed_at:t.U,attempt:crypto.randomUUID(),status:'SPENT'})+'\n');
      fs.fsyncSync(fd); syncDir(store);
    } catch { poison='store_uncertain'; v.fail(poison); }
    finally { fs.closeSync(fd); }
  }
  function call(params) {
    try {
      const {c,t}=ready();
      const frozen=v.verify(params,c,t); resources();
      const latest=ready(); v.recheck(frozen,latest.c,latest.t);
      spend(frozen,latest.t);
      let count;
      try { const now=ready(); v.recheck(frozen,now.c,now.t); count=resources(); }
      catch { v.fail('consumed_not_started'); }
      // Count invocation BEFORE attempting append. A failed write may be partial;
      // neither this count nor the response claims transactional completion.
      try {
        const bytes=Buffer.from(String(count+1)+'\n');
        fs.ftruncateSync(countFd,0);
        if (fs.writeSync(countFd,bytes,0,bytes.length,0) !== bytes.length) throw new Error('short counter write');
        fs.fsyncSync(countFd);
        writeCompleteSync(dataFd,frozen.bytes); fs.fsyncSync(dataFd);
      } catch { poison='target_unready'; v.fail('outcome_unknown'); }
      return {code:'ALLOW',effect_count:count+1};
    } catch(e) { return {code:e.refusal ? e.code : 'target_unready'}; }
  }
  function frame(bytes) {
    let id=null;
    try {
      // Read-only initialization/listing do not authorize effects. Even malformed
      // mutation frames must not bypass the stage-0 readiness refusal.
      ready();
      const f=v.parse(bytes,8192,4,'request_malformed').value;
      if (!v.exact(f,['jsonrpc','id','method','params']) || f.jsonrpc !== '2.0' ||
          !(typeof f.id === 'string' || Number.isSafeInteger(f.id)) || typeof f.method !== 'string') v.fail('request_malformed');
      id=f.id;
      if(f.method==='initialize') return {jsonrpc:'2.0',id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'single-user demonstration grant child',version:'0'}}};
      if(f.method==='tools/list') return {jsonrpc:'2.0',id,result:{tools:[{name:'demo.mutate',description:'single-user demonstration; execution grant required',inputSchema:{type:'object',properties:{line:{type:'string'}},required:['line'],additionalProperties:false}}]}};
      if(f.method!=='tools/call') v.fail('request_malformed');
      const result=call(f.params);
      if(result.code!=='ALLOW') v.fail(result.code);
      return {jsonrpc:'2.0',id,result};
    } catch(e) { return {jsonrpc:'2.0',id,error:{code:-32000,message:e.refusal ? e.code : 'target_unready'}}; }
  }
  return {call,frame,close};
}
function run(dataFile) {
  if (!dataFile) throw new Error('single-user demonstration: seal __demo-grant-server DATAFILE');
  const target=createTarget(dataFile);
  let buffer=Buffer.alloc(0), discarding=false;
  const reply=b=>process.stdout.write(JSON.stringify(target.frame(b))+'\n');
  process.stdin.on('data',chunk=>{
    for (const byte of chunk) {
      if(byte===10) { if(!discarding) reply(buffer); buffer=Buffer.alloc(0); discarding=false; }
      else if(!discarding) {
        if(buffer.length===8192) { reply(Buffer.alloc(8193)); buffer=Buffer.alloc(0); discarding=true; }
        else buffer=Buffer.concat([buffer,Buffer.from([byte])]);
      }
    }
  });
  process.stdin.on('end',()=>{ if(buffer.length&&!discarding) reply(buffer); target.close(); });
  process.on('exit',()=>target.close());
}
module.exports={createTarget,run};
