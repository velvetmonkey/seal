// SPDX-License-Identifier: Apache-2.0
// Test-only process/crash driver for the single-user demonstration. No signing.
const fs=require('node:fs');
const {createTarget}=require('../../../spine/demo-grant-server.cjs');
const fixture=require('./vectors.json');
const [file,phase]=process.argv.slice(2);
let now=fixture.vectors[0].now-125, mono=0;
const target=createTarget(file,{clock:()=>({L:now,U:now}),monotonic:()=>mono});
now+=125;mono+=125;
const original=fs.fsyncSync, inode=fs.statSync(file).ino;
fs.fsyncSync=fd=>{
 original(fd);const stat=fs.fstatSync(fd);
 if((phase==='after-spend'&&stat.isDirectory())||(phase==='after-effect'&&stat.isFile()&&stat.ino===inode)) process.kill(process.pid,'SIGKILL');
};
if(phase==='before-spend')process.kill(process.pid,'SIGKILL');
const x=fixture.vectors[0];
console.log(JSON.stringify(target.call({name:x.effect.tool,arguments:x.effect.arguments,grant:x.wire,receipt_sha256:x.effect.receipt_sha256})));
target.close();
