'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const{diagnosticLog}=require('../desktop/diagnostics.cjs');
test('process diagnostics are bounded, exclude payloads/messages and never throw on a failed log write',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shatoot-diagnostic-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const log=diagnosticLog(root,'0.19.2');log('renderer-exit',{reason:'crashed',exitCode:5,message:'private',password:'secret',stack:'Error: private\n at safe(frame:1)'});
 const file=path.join(root,'process.log'),entry=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(entry.reason,'crashed');assert.equal(entry.exitCode,'5');assert.ok(!fs.readFileSync(file,'utf8').includes('private'));assert.ok(!fs.readFileSync(file,'utf8').includes('secret'));
 fs.writeFileSync(file,Buffer.alloc(257*1024));log('child-process-exit',{type:'GPU',reason:'crashed'});assert.ok(fs.statSync(file).size<1024);assert.equal(fs.statSync(path.join(root,'process.previous.log')).size,257*1024);
 diagnosticLog(file,'0.19.2')('cannot-write');
});
