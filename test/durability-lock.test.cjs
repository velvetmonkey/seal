// SPDX-License-Identifier: Apache-2.0
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');
const { spawnSync, spawn } = require('node:child_process');
const ROOT = process.env.SEAL_DURABILITY_CHECKOUT || path.resolve(__dirname, '..');
const { testTmpdir } = require(path.join(ROOT, 'scripts/temp-root.cjs'));
const { createJournal, openJournal } = require(path.join(ROOT, 'spine/store.cjs'));
const { openReceiptEmitter } = require(path.join(ROOT, 'spine/receipts.cjs'));
const { generateSigner } = require(path.join(ROOT, 'spine/receipt-v2.cjs'));
const record = {tool:'demo.mutate', arguments:{line:'λ'.repeat(30)}, now:1, kernel_config:{}, granted_capabilities:[], kernel_inputs:{}, verdict:'allow', reason:'test'};

for (const site of ['journal', 'receipt']) {
  for (const mode of ['short', 'zero', 'ENOSPC', 'prefix-then-error', 'normal']) {
    test(`durability ${site} ${mode}`, () => {
      const root = testTmpdir('seal-durability-');
      const journalPath = path.join(root, 'journal');
      createJournal(journalPath);
      const journal = openJournal(journalPath);
      const receipts = path.join(root, 'receipts');
      const emitter = openReceiptEmitter(receipts, generateSigner());
      const real = fs.writeSync;
      let injected = false;
      let forwarded = 0;
      fs.writeSync = function(fd, data, ...args) {
        // Direct append now acquires the journal lock itself. Keep this
        // fault on the event write, rather than the lock-owner publication.
        if (site === 'journal' && !String(data).includes('"type":"consumption"')) {
          return real.call(fs, fd, data, ...args);
        }
        if (!injected) {
          injected = true;
          const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
          if (mode === 'ENOSPC') throw Object.assign(new Error('disk full'), {code:'ENOSPC'});
          if (mode === 'zero') return 0;
          if (mode === 'short' || mode === 'prefix-then-error') {
            const n = real(fd, bytes.subarray(0, Math.floor(bytes.length / 2)));
            if (mode === 'prefix-then-error') throw Object.assign(new Error('disk full after prefix'), {code:'ENOSPC'});
            return n;
          }
        }
        return real.call(fs, fd, data, ...args);
      };
      let error;
      try {
        if (site === 'journal') journal.append({type:'consumption', note:'λ'.repeat(30)});
        else emitter.emit(record, 'allow');
        forwarded++;
      } catch (e) { error = e; }
      finally { fs.writeSync = real; }
      assert.ok(injected, 'fault reached real write boundary');
      assert.equal(forwarded, mode === 'normal' ? 1 : 0, 'dispatch after persistence');
      if (mode !== 'normal') assert.ok(error);
      assert.equal(journal.events.length, site === 'journal' && mode === 'normal' ? 1 : 0);
      assert.deepEqual(openJournal(journalPath).events, journal.events, 'failed append leaves reopenable journal');
      for (const file of fs.readdirSync(receipts)) JSON.parse(fs.readFileSync(path.join(receipts,file),'utf8'));
    });
  }
}

function waitFor(file, ms = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (fs.existsSync(file)) { clearInterval(timer); resolve(); }
      else if (Date.now() - start > ms) { clearInterval(timer); reject(new Error(`barrier timed out: ${file}`)); }
    }, 10);
  });
}
const holderSource = `
const fs = require('node:fs');
const [root, journal, marker, mode] = process.argv.slice(1);
const {openJournal} = require(root + '/spine/store.cjs');
const wait = file => {const end=Date.now()+10000; while(!fs.existsSync(file)) {if(Date.now()>end) throw Error('barrier timeout'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);}};
const open = fs.openSync, write = fs.writeSync, read = fs.readFileSync;
let staleRead = false;
fs.readFileSync = function(file, ...args) {
 const bytes = read.call(fs,file,...args);
 if(mode==='stale' && !staleRead && String(bytes).includes('\"startWitness\":\"dead\"')) {
  staleRead=true; fs.writeFileSync(marker+'.created',''); wait(marker+'.go');
 }
 return bytes;
};
fs.openSync = function(file, flags, ...args) {
 const fd = open.call(fs,file,flags,...args);
 if(mode==='creation' && flags==='wx' && String(file).includes('.lock')) {fs.writeFileSync(marker+'.created',''); wait(marker+'.go');}
 return fd;
};
fs.writeSync = function(fd,data,...args) {
 if(mode==='short' && String(data).includes('startWitness')) {
  const bytes=Buffer.from(data); const n=write(fd,bytes.subarray(0,Math.floor(bytes.length/2)));
  fs.writeFileSync(marker+'.created',''); wait(marker+'.go'); return n;
 }
 return write.call(fs,fd,data,...args);
};
try {openJournal(journal).withLock(()=> {fs.writeFileSync(marker+'.entered',''); wait(marker+'.release');});}
catch(e) {fs.writeFileSync(marker+'.error',e.message);}
fs.writeFileSync(marker+'.done','');
`;
for (const mode of ['creation', 'short']) {
  test(`durability lock ${mode} barrier prevents overlapping holders`, async t => {
    const root = testTmpdir('seal-lock-barrier-');
    const journal = path.join(root,'journal'); createJournal(journal);
    const a = path.join(root,'a'), b = path.join(root,'b');
    const first = spawn(process.execPath,['-e',holderSource,ROOT,journal,a,mode], {stdio:'ignore'});
    t.after(()=>first.kill());
    await waitFor(a+'.created');
    const second = spawn(process.execPath,['-e',holderSource,ROOT,journal,b,'normal'], {stdio:'ignore'});
    t.after(()=>second.kill());
    try {
      await waitFor(b+'.entered');
      fs.writeFileSync(a+'.go','');
      await new Promise(r=>setTimeout(r,150));
      assert.equal(fs.existsSync(a+'.entered'),false,'first must not enter while competitor owns published lock');
      assert.equal(fs.existsSync(journal+'.lock'),true,'failed holder must not release competitor lock');
    } finally {
      fs.writeFileSync(a+'.go',''); fs.writeFileSync(b+'.release',''); fs.writeFileSync(a+'.release','');
      await Promise.all([waitFor(a+'.done'),waitFor(b+'.done')]);
    }
    if(mode==='short') assert.equal(fs.existsSync(a+'.error'),true,'short owner publication must fail');
    else assert.equal(fs.existsSync(a+'.entered'),true,'normal contender eventually enters');
  });
}

test('durability release leaves a replacement lock untouched', () => {
  const root=testTmpdir('seal-lock-release-'); const file=path.join(root,'journal'); createJournal(file);
  const replacement=JSON.stringify({pid:process.pid,startWitness:'replacement'});
  openJournal(file).withLock(()=> {
    fs.unlinkSync(file+'.lock'); fs.writeFileSync(file+'.lock',replacement,{flag:'wx'});
  });
  assert.equal(fs.readFileSync(file+'.lock','utf8'),replacement);
});

test('durability dead owner recovered and incomplete owner refused', () => {
  const root=testTmpdir('seal-lock-dead-'); const file=path.join(root,'journal'); createJournal(file);
  const dead=spawnSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{encoding:'utf8'});
  assert.equal(dead.status,0);
  fs.writeFileSync(file+'.lock',JSON.stringify({pid:Number(dead.stdout),startWitness:'dead'}));
  let entered=0; openJournal(file).withLock(()=>entered++); assert.equal(entered,1);
  fs.writeFileSync(file+'.lock','');
  assert.throws(()=>openJournal(file).withLock(()=>entered++),/incomplete|invalid/);
  assert.equal(entered,1);
});

for (const site of ['journal','receipt']) for (const mode of ['short','ENOSPC','normal']) {
  test(`durability real proxy ${site} ${mode} dispatch count`, async t => {
    const {createProxy} = require(path.join(ROOT,'spine/proxy.cjs'));
    const root=testTmpdir('seal-durable-proxy-'); const file=path.join(root,'journal'); createJournal(file);
    const data=path.join(root,'data'); const receipts=path.join(root,'receipts'); const frames=[];
    const proxy=createProxy({signer:generateSigner(),guardTool:'demo.mutate',storePath:file,receiptsDir:receipts,
      childArgv:[process.execPath,path.join(ROOT,'contract/fixtures/counting-child.cjs'),data],
      onClientLine(line){frames.push(JSON.parse(line));}});
    t.after(()=>proxy.stop());
    await waitFor(data+'.count');
    proxy.write(JSON.stringify({jsonrpc:'2.0',id:90,method:'initialize',params:{capabilities:{elicitation:{}}}}));
    const until=async predicate=>{const end=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<end,'child response timed out');await new Promise(r=>setTimeout(r,10));}};
    await until(()=>Number(fs.readFileSync(data+'.count','utf8'))===1);
    const before=Number(fs.readFileSync(data+'.count','utf8'));
    proxy.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'demo.mutate',arguments:{line:'durability'}}}));
    const request=frames.find(f=>f.method==='elicitation/create'); assert.ok(request);
    const real=fs.writeSync;let injected=false,error;
    fs.writeSync=function(fd,bytes,...args){
      const text=bytes.toString();
      const matches=site==='journal' ? text.includes('"status":"consumed"') : text.includes('"action":"ALLOW"');
      if(matches && !injected){injected=true;
        if(mode==='ENOSPC') throw Object.assign(new Error('disk full'),{code:'ENOSPC'});
        if(mode==='short'){const buffer=Buffer.from(bytes);return real(fd,buffer.subarray(0,Math.floor(buffer.length/2)));}
      }
      return real.call(fs,fd,bytes,...args);
    };
    try {proxy.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{action:'accept',content:{approve:true}}}));}
    catch(e){error=e;}finally{fs.writeSync=real;}
    assert.ok(injected,'fault reached consumption or ALLOW receipt');
    if(mode==='normal') await until(()=>Number(fs.readFileSync(data+'.count','utf8'))===before+1);
    else {assert.ok(error);await new Promise(r=>setTimeout(r,100));}
    assert.equal(Number(fs.readFileSync(data+'.count','utf8'))-before,mode==='normal'?1:0,'count read from real child');
    openJournal(file);
    for(const name of fs.readdirSync(receipts)) JSON.parse(fs.readFileSync(path.join(receipts,name),'utf8'));
  });
}

test('durability published live owner is respected', () => {
  const root=testTmpdir('seal-lock-live-');const file=path.join(root,'journal');createJournal(file);
  openJournal(file).withLock(()=>{
    const bytes=fs.readFileSync(file+'.lock');
    const contender=spawnSync(process.execPath,['-e',`require(process.argv[1]).openJournal(process.argv[2]).withLock(()=>process.stdout.write('entered'))`,path.join(ROOT,'spine/store.cjs'),file],{encoding:'utf8',timeout:200});
    assert.equal(contender.error?.code,'ETIMEDOUT');
    assert.equal(contender.stdout,'');assert.deepEqual(fs.readFileSync(file+'.lock'),bytes);
  });
});

for(const mode of ['short','zero','ENOSPC','normal']) {
  test(`durability project owner ${mode}`,()=>{
    const {acquireProjectLock}=require(path.join(ROOT,'spine/protection.cjs'));
    const root=testTmpdir('seal-project-write-');const real=fs.writeSync;let injected=false,lock,error;
    fs.writeSync=function(fd,data,...args){injected=true;
      if(mode==='zero')return 0;
      if(mode==='ENOSPC')throw Object.assign(new Error('disk full'),{code:'ENOSPC'});
      if(mode==='short'){const b=Buffer.from(data);return real(fd,b.subarray(0,b.length>>1));}
      return real.call(fs,fd,data,...args);
    };
    try{lock=acquireProjectLock(root,{...process.env,XDG_DATA_HOME:root});}catch(e){error=e;}finally{fs.writeSync=real;}
    assert.ok(injected);
    if(mode==='normal'){assert.ok(lock);JSON.parse(fs.readFileSync(lock.filePath,'utf8'));lock.release();}
    else{assert.ok(error);assert.equal(lock,undefined);}
  });
  test(`durability lifecycle exit ${mode}`,()=>{
    // Execute the actual registered exit handler without booting the kernel.
    const vm=require('node:vm');const {createRequire}=require('node:module');
    const worker=path.join(ROOT,'contract/kernel-authorization-worker.cjs');
    const callbacks={};
    const context={require:createRequire(worker),process:{on(name,fn){callbacks[name]=fn;},hrtime:process.hrtime,_getActiveHandles:()=>[],_getActiveRequests:()=>[]}};
    vm.runInNewContext(fs.readFileSync(worker,'utf8').split('async function main()')[0],context);
    const root=testTmpdir('seal-exit-write-');const fd=fs.openSync(path.join(root,'exit'),'wx');const real=fs.writeSync;let injected=false,error;
    fs.writeSync=function(target,data,...args){assert.equal(target,2);injected=true;
      if(mode==='zero')return 0;
      if(mode==='ENOSPC')throw Object.assign(new Error('disk full'),{code:'ENOSPC'});
      if(mode==='short'){const b=Buffer.from(data);return real(fd,b.subarray(0,b.length>>1));}
      return real.call(fs,fd,data,...args);
    };
    try{callbacks.exit();}catch(e){error=e;}finally{fs.writeSync=real;fs.closeSync(fd);}
    assert.ok(injected);assert.equal(Boolean(error),mode!=='normal');
    if(mode==='normal')assert.match(fs.readFileSync(path.join(root,'exit'),'utf8'),/^SEAL_KERNEL_LIFECYCLE .*"name":"exit".*\n$/);
  });
}

test('durability delayed stale reaper cannot evict a new live holder',async t=>{
  const root=testTmpdir('seal-reaper-barrier-');const journal=path.join(root,'journal');createJournal(journal);
  const dead=spawnSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{encoding:'utf8'});
  assert.equal(dead.status,0);fs.writeFileSync(journal+'.lock',JSON.stringify({pid:Number(dead.stdout),startWitness:'dead'}));
  const a=path.join(root,'a'),b=path.join(root,'b');
  const first=spawn(process.execPath,['-e',holderSource,ROOT,journal,a,'stale'],{stdio:'ignore'});
  const second=spawn(process.execPath,['-e',holderSource,ROOT,journal,b,'stale'],{stdio:'ignore'});
  t.after(()=>first.kill());t.after(()=>second.kill());
  try {
    await Promise.all([waitFor(a+'.created'),waitFor(b+'.created')]);
    fs.writeFileSync(a+'.go','');await waitFor(a+'.entered');
    const owner=fs.readFileSync(journal+'.lock');
    fs.writeFileSync(b+'.go','');await new Promise(r=>setTimeout(r,150));
    assert.equal(fs.existsSync(b+'.entered'),false);
    assert.deepEqual(fs.readFileSync(journal+'.lock'),owner);
  }finally{
    for(const marker of [a,b]){fs.writeFileSync(marker+'.go','');fs.writeFileSync(marker+'.release','');}
    await Promise.all([waitFor(a+'.done'),waitFor(b+'.done')]);
  }
  assert.equal(fs.existsSync(b+'.entered'),true);
});

// Checkpoints are checked against an independent replay of the legacy source.
const { replayApprovalEvents } = require(path.join(ROOT, 'spine/store.cjs'));
const { createApprovalContract } = require(path.join(ROOT, 'contract/contract.cjs'));
const { sha256Hex } = require(path.join(ROOT, 'contract/canonical.cjs'));
function checkpointFixture() {
  const root = testTmpdir('seal-checkpoint-');
  const file = path.join(root, 'journal'); createJournal(file);
  const journal = openJournal(file);
  const contract = createApprovalContract({ store: journal });
  const handles = [];
  const statuses = ['consumed', 'declined', 'cancelled', 'expired', 'restart_invalidated'];
  for (let i = 0; i < 8; i++) {
    const result = contract.begin({ tool: 'demo.mutate', args: { line: `checkpoint λ ${i}` } });
    handles.push(result.result.requestState);
    if (i < statuses.length) journal.withLock(() => journal.append({
      type: 'status', handle_hash: sha256Hex(handles[i]), status: statuses[i], at: Date.now(),
    }));
  }
  const expected = new Map();
  for (const event of journal.events) {
    if (event.type === 'issued') {
      const {type, ...pending} = event;
      expected.set(event.handle_hash, {...pending, status: 'pending'});
    } else expected.set(event.handle_hash, {handle_hash:event.handle_hash, status:event.status});
  }
  return { root, file, journal, contract, handles, expected };
}

test('checkpoint retains live pending and every terminal refusal, legacy evidence and subsequent appends', () => {
  const {file,journal,contract,handles,expected} = checkpointFixture();
  const original = fs.readFileSync(file);
  const result = journal.compact();
  assert.deepEqual(fs.readFileSync(result.archive), original, 'full legacy history remains available');
  assert.deepEqual(replayApprovalEvents(openJournal(file).events), expected);
  const refusals = ['already_consumed','terminally_declined','cancelled','expired','restart_invalidated'];
  for (let i = 0; i < handles.length; i++) {
    const result = contract.retry({tool:'demo.mutate', args:{line:`checkpoint λ ${i}`},
      requestState:handles[i], inputResponses:{approval:{action:'accept',content:{approve:true}}}});
    if (i < 5) assert.equal(result.refusal,refusals[i]);
    else assert.equal(result.kind,'allow','live continuation remains usable exactly once');
  }
  journal.compact();
  for (let i = 5; i < handles.length; i++) assert.equal(contract.retry({requestState:handles[i]}).refusal,'already_consumed');
  assert.equal(replayApprovalEvents(openJournal(file).events).size,8);
});

for (const mode of ['drop-pending','revive-terminal','short','zero','ENOSPC']) {
  test(`checkpoint refuses planted ${mode} before replacing the source`, () => {
    const {file,journal,expected} = checkpointFixture();
    const original = fs.readFileSync(file);
    const real = fs.writeSync; let planted = false;
    fs.writeSync = function(fd,data,...args) {
      if (String(data).includes('"type":"approval_checkpoint"')) {
        planted = true;
        if (mode === 'short') return real(fd,Buffer.from(data).subarray(0,20));
        if (mode === 'zero') return 0;
        if (mode === 'ENOSPC') throw Object.assign(new Error('planted disk full'),{code:'ENOSPC'});
        const candidate = JSON.parse(String(data));
        if (mode === 'drop-pending') candidate.records.splice(candidate.records.findIndex(r=>r.status==='pending'),1);
        else candidate.records.find(r=>r.status==='consumed').status='pending';
        // Even a self-consistent checksum cannot excuse a changed state.
        candidate.count = candidate.records.length;
        candidate.sha256 = sha256Hex(JSON.stringify(candidate.records));
        real(fd,Buffer.from(JSON.stringify(candidate)+'\n'));
        return Buffer.byteLength(data);
      }
      return real.call(fs,fd,data,...args);
    };
    try { assert.throws(()=>journal.compact(),/changes authorization state|incomplete write|planted disk full/); }
    finally { fs.writeSync=real; }
    assert.ok(planted);
    assert.deepEqual(fs.readFileSync(file),original);
    assert.deepEqual(replayApprovalEvents(openJournal(file).events),expected);
  });
}

// Crash the real process, without executing finally blocks. Include the
// archive link as well as all writes, renames and fsyncs inside compaction.
const checkpointCrashSource = `
const fs=require('node:fs');
const [root,file,target,phase]=process.argv.slice(1);
const journal=require(root+'/spine/store.cjs').openJournal(file);
let step=0;
 for(const name of ['writeSync','fsyncSync','renameSync','linkSync']) {
  const real=fs[name]; fs[name]=function(...args) {
   const current=++step;
   const die=()=>process.kill(process.pid,'SIGKILL');
   if(current===Number(target) && phase==='before') die();
   if(current===Number(target) && phase==='partial') {real(args[0],Buffer.from(args[1]).subarray(0,31));die();}
   const result=real.apply(fs,args);
   if(current===Number(target) && phase==='after') die();
   return result;
  };
 }
 journal.compact();
 process.stdout.write(String(step));
`;
const checkpointSteps = ['lock owner write','lock owner fsync','lock publication link','recovery directory fsync','source fsync','archive link','archive directory fsync','checkpoint write','checkpoint fsync','rename','publish directory fsync'];
for (let step=1;step<=checkpointSteps.length;step++) for (const phase of ['before','after']) {
  test(`checkpoint crash ${phase} ${checkpointSteps[step-1]} recovers the full replay state`, () => {
    const {file,expected}=checkpointFixture();
    const crashed=spawnSync(process.execPath,['-e',checkpointCrashSource,ROOT,file,String(step),phase],{encoding:'utf8',timeout:10000});
    assert.equal(crashed.signal,'SIGKILL',crashed.stderr);
    const recovered=openJournal(file);
    recovered.withLock(()=>assert.deepEqual(replayApprovalEvents(recovered.events),expected));
    // The recovered writer must target the current inode, not an archive.
    const pending=[...expected.values()].find(r=>r.status==='pending');
    recovered.append({type:'status',handle_hash:pending.handle_hash,status:'consumed',at:Date.now()});
    expected.set(pending.handle_hash,{handle_hash:pending.handle_hash,status:'consumed'});
    assert.deepEqual(replayApprovalEvents(openJournal(file).events),expected);
  });
}
test('checkpoint crash during a partial candidate write leaves the legacy journal intact',()=>{
  const {file,expected}=checkpointFixture();
  const crashed=spawnSync(process.execPath,['-e',checkpointCrashSource,ROOT,file,'8','partial'],{encoding:'utf8',timeout:10000});
  assert.equal(crashed.signal,'SIGKILL',crashed.stderr);
  const recovered=openJournal(file);
  recovered.withLock(()=>assert.deepEqual(replayApprovalEvents(recovered.events),expected));
});

test('checkpoint mutation count covers every persistence boundary',()=>{
  const {file}=checkpointFixture();
  const run=spawnSync(process.execPath,['-e',checkpointCrashSource,ROOT,file,'0','none'],{encoding:'utf8',timeout:10000});
  assert.equal(run.status,0,run.stderr);
  assert.equal(Number(run.stdout),checkpointSteps.length,'new persistence operations need crash cuts');
});

test('checkpoint rejects physical digest damage and replay that resurrects a terminal hash',()=>{
  const {file,journal,handles}=checkpointFixture();
  journal.compact();
  const valid=fs.readFileSync(file,'utf8');
  const checkpoint=JSON.parse(valid);
  checkpoint.records[0].status='pending';
  fs.writeFileSync(file,JSON.stringify(checkpoint)+'\n');
  assert.throws(()=>createApprovalContract({store:openJournal(file)}),/digest/);
  fs.writeFileSync(file,valid);
  journal.append({type:'issued',handle_hash:sha256Hex(handles[0])});
  assert.throws(()=>createApprovalContract({store:openJournal(file)}),/duplicate handle/);
  fs.writeFileSync(file,valid);
  journal.append({type:'status',handle_hash:sha256Hex(handles[0]),status:'pending'});
  assert.throws(()=>createApprovalContract({store:openJournal(file)}),/non-monotonic/);
  fs.writeFileSync(file,valid+'{"type":"status"');
  assert.throws(()=>openJournal(file),/not JSON/,'a torn tail is never ignored');
});

test('checkpoint readers see complete generations and a waiting decision appends once to the replacement',async t=>{
  const {root,file,journal,expected}=checkpointFixture();
  const ready=path.join(root,'ready'),go=path.join(root,'go'),started=path.join(root,'started');
  const hash=[...expected.values()].find(r=>r.status==='pending').handle_hash;
  const compactor=spawn(process.execPath,['-e',`
    const fs=require('node:fs');const [root,file,ready,go]=process.argv.slice(1);
    const journal=require(root+'/spine/store.cjs').openJournal(file);const rename=fs.renameSync;
    fs.renameSync=function(...args){fs.writeFileSync(ready,'');const end=Date.now()+10000;
      while(!fs.existsSync(go)){if(Date.now()>end)throw Error('barrier timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);}
      return rename.apply(fs,args);};journal.compact();`,ROOT,file,ready,go],{stdio:'ignore'});
  t.after(()=>compactor.kill());
  const compactorDone=new Promise(resolve=>compactor.once('close',(code,signal)=>resolve({code,signal})));
  await waitFor(ready);
  assert.deepEqual(replayApprovalEvents(openJournal(file).events),expected,'reader before rename sees full old state');
  const writer=spawn(process.execPath,['-e',`
    const fs=require('node:fs');const [root,file,hash,started]=process.argv.slice(1);
    const journal=require(root+'/spine/store.cjs').openJournal(file);fs.writeFileSync(started,'');
    journal.append({type:'status',handle_hash:hash,status:'consumed',at:1});`,ROOT,file,hash,started],{stdio:'ignore'});
  t.after(()=>writer.kill());
  const writerDone=new Promise(resolve=>writer.once('close',(code,signal)=>resolve({code,signal})));
  await waitFor(started);
  await new Promise(r=>setTimeout(r,100));
  assert.deepEqual(replayApprovalEvents(openJournal(file).events),expected,'writer waits at compactor lock');
  fs.writeFileSync(go,'');
  assert.deepEqual(await compactorDone,{code:0,signal:null});
  assert.deepEqual(await writerDone,{code:0,signal:null});
  expected.set(hash,{handle_hash:hash,status:'consumed'});
  assert.deepEqual(replayApprovalEvents(openJournal(file).events),expected);
  assert.equal(openJournal(file).events.filter(e=>e.type==='status' && e.handle_hash===hash).length,1);
  // A store opened before compaction must refresh before its next decision.
  journal.withLock(()=>assert.deepEqual(replayApprovalEvents(journal.events),expected));
});

test('checkpoint failed publication fsync is completed before the next decision',()=>{
  const {file,journal,expected}=checkpointFixture();
  const sync=fs.fsyncSync,rename=fs.renameSync;let published=false,failed=false;
  fs.renameSync=function(...args){const result=rename.apply(fs,args);published=true;return result;};
  fs.fsyncSync=function(fd){if(published&&!failed){failed=true;throw Error('planted publish sync failure');}return sync(fd);};
  try{assert.throws(()=>journal.compact(),/planted publish sync failure/);}
  finally{fs.fsyncSync=sync;fs.renameSync=rename;}
  assert.ok(failed);
  let directorySynced=false;
  fs.fsyncSync=function(fd){if(fs.fstatSync(fd).isDirectory())directorySynced=true;return sync(fd);};
  try{journal.withLock(()=>{
    assert.ok(directorySynced,'recovery sync must precede decision callback');
    assert.deepEqual(replayApprovalEvents(journal.events),expected);
  });}finally{fs.fsyncSync=sync;}
});

test('checkpoint automatically bounds a large event prefix and keeps all terminal tombstones',()=>{
  const {file,journal,expected}=checkpointFixture();
  const pending=[...expected.values()].find(r=>r.status==='pending');
  journal.withLock(()=>{
    for(let i=0;i<2050;i++){
      const hash=sha256Hex('automatic checkpoint '+i);
      journal.append({type:'issued',...pending,handle_hash:hash,canonical_effect_bytes:'x'.repeat(2048)});
      journal.append({type:'status',handle_hash:hash,status:'consumed',at:1});
      expected.set(hash,{handle_hash:hash,status:'consumed'});
    }
  });
  const before=fs.statSync(file).size;
  assert.ok(before>4*1024*1024);
  journal.withLock(()=>assert.equal(journal.events[0].type,'approval_checkpoint'));
  assert.deepEqual(replayApprovalEvents(openJournal(file).events),expected);
  assert.ok(fs.statSync(file).size<before/4);
});
