// SPDX-License-Identifier: Apache-2.0
// Single-user demonstration. The fixture key is a THROWAWAY TEST KEY, not an issuer.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {testTmpdir}=require('../scripts/temp-root.cjs');
const {createTarget}=require('../spine/demo-grant-server.cjs');
const v=require('../spine/demo-grant.cjs');
const fixture=require('./fixtures/demo-grant/vectors.json');
const valid=fixture.vectors[0];
const params=x=>({name:x.effect.tool,arguments:x.effect.arguments,grant:x.wire,receipt_sha256:x.effect.receipt_sha256});
function setup(t) {
 const dir=testTmpdir(path.join(os.tmpdir(),'seal-grant-')); const file=path.join(dir,'data');
 const config={audience:fixture.audience,clock_trusted:true,keys:[{...fixture.issuer,purpose:v.PROFILE,public_key_pem:fixture.public_key_pem,revoked:false,audiences:[fixture.audience],profiles:[v.PROFILE],tools:['demo.mutate']}]};
 fs.writeFileSync(file,'preserve-existing\n');fs.writeFileSync(file+'.count','0\n');fs.writeFileSync(file+'.grant.json',JSON.stringify(config));
 fs.mkdirSync(file+'.spends');fs.writeFileSync(path.join(file+'.spends','identity'),fixture.audience+'\n');
 let now=valid.now-125, mono=0;
 const options={clock:()=>({L:now,U:now}),monotonic:()=>mono};
 const target=createTarget(file,options);t.after(()=>target.close());
 const advance=(delta)=>{now+=delta;mono+=delta;};
 advance(125);
 return {file,config,target,options,advance,setNow:n=>{mono+=n-now;now=n;},save:()=>fs.writeFileSync(file+'.grant.json',JSON.stringify(config)),bytes:()=>fs.readFileSync(file,'utf8'),count:()=>Number(fs.readFileSync(file+'.count','utf8'))};
}
for(const vector of fixture.vectors) test(`single-user demonstration vector: ${vector.name}`,t=>{
 const s=setup(t);s.setNow(vector.now);
 if(vector.already_spent) assert.equal(s.target.call(params(valid)).code,'ALLOW');
 const before=s.bytes(),count=s.count();
 const result=s.target.call(params(vector));
 assert.equal(result.code,vector.expected);
 assert.equal(s.count()-count,vector.expected==='ALLOW'?1:0);
 assert.equal(s.bytes(),vector.expected==='ALLOW'?before+vector.effect.arguments.line+'\n':before);
});
test('single-user demonstration: direct no-grant, erase, startup preservation and hidden dispatch',t=>{
 const s=setup(t);const before=s.bytes();
 assert.equal(s.target.call({name:'demo.mutate',arguments:valid.effect.arguments}).code,'grant_missing');
 assert.equal(s.target.call({...params(valid),name:'demo.erase'}).code,'effect_invalid');
 assert.equal(s.count(),0);assert.equal(s.bytes(),before);
 s.target.close();
 const req=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'demo.mutate',arguments:valid.effect.arguments}})+'\n';
 const child=spawnSync(process.execPath,[path.join(__dirname,'../bin/seal'),'__demo-grant-server',s.file],{input:req,encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/store_quarantine/);assert.equal(s.bytes(),before);assert.equal(s.count(),0);
 const help=spawnSync(process.execPath,[path.join(__dirname,'../bin/seal'),'--help'],{encoding:'utf8'});
 assert.doesNotMatch(help.stdout,/__demo-grant-server/);
});
test('single-user demonstration: concurrent owner refused, sequential replay spent, restart quarantined',t=>{
 const s=setup(t);const other=createTarget(s.file,s.options);t.after(()=>other.close());
 assert.equal(other.call(params(valid)).code,'target_unready');
 assert.equal(s.target.call(params(valid)).code,'ALLOW');assert.equal(s.target.call(params(valid)).code,'already_spent');
 s.target.close();const restarted=createTarget(s.file,s.options);t.after(()=>restarted.close());
 assert.equal(restarted.call(params(valid)).code,'store_quarantine');s.advance(125);
 assert.equal(restarted.call(params(valid)).code,'expired');assert.equal(s.count(),1);
});
test('single-user demonstration: store loss quarantines and clock rollback stays closed',t=>{
 const s=setup(t);fs.renameSync(s.file+'.spends',s.file+'.lost');
 assert.equal(s.target.call(params(valid)).code,'store_quarantine');
 fs.renameSync(s.file+'.lost',s.file+'.spends');assert.equal(s.target.call(params(valid)).code,'store_quarantine');assert.equal(s.count(),0);
 const r=setup(t);assert.equal(r.target.call({}).code,'grant_missing');r.setNow(valid.now-1);assert.equal(r.target.call(params(valid)).code,'clock_untrusted');r.setNow(valid.now+1);
 assert.equal(r.target.call(params(valid)).code,'clock_untrusted');assert.equal(r.count(),0);
});
test('single-user demonstration: parser and operation inputs refuse without effect',t=>{
 const s=setup(t);const base={jsonrpc:'2.0',id:1,method:'tools/call',params:params(valid)};
 for(const [bytes,code] of [
  [Buffer.from([0xff]),'request_malformed'],[Buffer.from('\ufeff{}'),'request_malformed'],
  ['[]','request_malformed'],['{','request_malformed'],[JSON.stringify({...base,id:undefined}),'request_malformed'],
  ['{"x":1,"\\u0078":2}','duplicate_member'],[' '.repeat(8193),'request_malformed'],
  ['{"x":{"x":{"x":{"x":{}}}}}','request_malformed']]) {
  assert.equal(s.target.frame(bytes).error.message,code);
 }
 for(const [p,code] of [
  [{...params(valid),grant:'{"a":1,"a":2}'},'duplicate_member'],
  [{...params(valid),grant:'\ufeff'+valid.wire},'grant_malformed'],
  [{...params(valid),arguments:{line:'\n'}},'effect_invalid'],
  [{...params(valid),arguments:{line:'x'.repeat(257)}},'effect_invalid'],
  [{...params(valid),arguments:{line:'x',extra:1}},'effect_invalid'],
  [{...params(valid),receipt_sha256:'0'.repeat(64)},'effect_mismatch'],
  [{...params(valid),extra:1},'request_malformed']]) assert.equal(s.target.call(p).code,code);
 assert.equal(s.count(),0);assert.equal(s.bytes(),'preserve-existing\n');
});
test('single-user demonstration: revocation, scope, resource substitution and untrusted clock',t=>{
 for(const [change,code] of [
  [s=>{s.config.keys[0].revoked=true;s.save();},'key_revoked'],
  [s=>{s.config.keys[0].tools=[];s.save();},'issuer_scope_refused'],
  [s=>{s.config.clock_trusted=false;s.save();},'clock_untrusted'],
  [s=>{fs.renameSync(s.file,s.file+'.original');fs.symlinkSync(s.file+'.original',s.file);},'resource_unavailable']]) {
  const s=setup(t);change(s);assert.equal(s.target.call(params(valid)).code,code);assert.equal(s.count(),0);
 }
});
test('single-user demonstration: uncertain durable spend never invokes or retries',t=>{
 const s=setup(t);const original=fs.fsyncSync;
 t.mock.method(fs,'fsyncSync',fd=>{if(fs.fstatSync(fd).isFile()) throw new Error('injected commit uncertainty');return original(fd);});
 assert.equal(s.target.call(params(valid)).code,'store_uncertain');t.mock.restoreAll();
 assert.equal(s.target.call(params(valid)).code,'store_uncertain');assert.equal(s.count(),0);assert.equal(s.bytes(),'preserve-existing\n');
});
test('single-user demonstration: post-spend unsafe time consumes without effect',t=>{
 const s=setup(t);const original=fs.fsyncSync;
 t.mock.method(fs,'fsyncSync',fd=>{original(fd);if(fs.fstatSync(fd).isDirectory())s.advance(121);});
 assert.equal(s.target.call(params(valid)).code,'consumed_not_started');t.mock.restoreAll();assert.equal(s.count(),0);
 assert.equal(fs.readdirSync(s.file+'.spends').length,2);
});
for(const phase of ['before-spend','after-spend','after-effect'])test(`single-user demonstration: real SIGKILL ${phase}, fence then quarantine`,t=>{
 const s=setup(t);s.target.close();
 const result=spawnSync(process.execPath,[path.join(__dirname,'fixtures/demo-grant/crash-child.cjs'),s.file,phase],{encoding:'utf8'});
 assert.equal(result.signal,'SIGKILL',result.stderr);
 assert.equal(s.count(),phase==='after-effect'?1:0);
 assert.equal(s.bytes(),'preserve-existing\n'+(phase==='after-effect'?valid.effect.arguments.line+'\n':''));
 assert.equal(fs.readdirSync(s.file+'.spends').length,phase==='before-spend'?1:2);
 const fenced=createTarget(s.file,s.options);assert.equal(fenced.call(params(valid)).code,'target_unready');fenced.close();
 // The child has exited (waitpid via spawnSync). Only this trusted test operator
 // removes its stale lock; product code never infers death from a PID timeout.
 fs.unlinkSync(s.file+'.grant-lock');
 const recovered=createTarget(s.file,s.options);t.after(()=>recovered.close());
 assert.equal(recovered.call(params(valid)).code,'store_quarantine');s.advance(125);
 assert.equal(recovered.call(params(valid)).code,'expired');assert.equal(s.count(),phase==='after-effect'?1:0);
});
test('single-user demonstration: competing actual process cannot acquire target',t=>{
 const s=setup(t);const other=spawnSync(process.execPath,[path.join(__dirname,'fixtures/demo-grant/crash-child.cjs'),s.file,'compete'],{encoding:'utf8'});
 assert.equal(other.status,0,other.stderr);assert.equal(JSON.parse(other.stdout).code,'target_unready');
 assert.equal(s.target.call(params(valid)).code,'ALLOW');assert.equal(s.count(),1);
});
test('single-user demonstration: distinct key IDs share spend namespace',t=>{
 const s=setup(t);assert.equal(s.target.call(params(valid)).code,'ALLOW');
 const row=fs.readdirSync(s.file+'.spends').find(n=>n!=='identity');
 const record=JSON.parse(fs.readFileSync(path.join(s.file+'.spends',row)));
 assert.equal(row,v.sha(v.canonical({issuer:fixture.issuer.id,audience:fixture.audience,grant_id:JSON.parse(valid.wire).grant_id})));
 assert.equal(record.key_id,fixture.issuer.key_id);assert.equal(record.status,'SPENT');
 assert.deepEqual(record.effect,valid.effect);assert.equal(record.effect_sha256,JSON.parse(valid.wire).effect_sha256);
});
