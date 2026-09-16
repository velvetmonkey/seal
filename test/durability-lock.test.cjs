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
