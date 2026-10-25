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

test('crash capture is local-only and lifecycle diagnostics distinguish hiding from renderer or process exit',t=>{
 const{EventEmitter}=require('node:events'),root=fs.mkdtempSync(path.join(os.tmpdir(),'shatoot-crash-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const app=new EventEmitter(),process=new EventEmitter();process.pid=123;app.getPath=()=>root;app.getVersion=()=> '0.20.6';let capture,location;app.setPath=(name,value)=>location={name,value};
 const log=require('../desktop/diagnostics.cjs').installProcessDiagnostics({app,process,crashReporter:{start:options=>capture=options}});
 assert.equal(capture.uploadToServer,false);assert.equal(capture.submitURL,undefined);assert.equal(location.name,'crashDumps');assert.equal(location.value,path.join(root,'crashes'));
 log('window-hidden',{type:'viewer'});app.emit('render-process-gone',{},null,{reason:'crashed',exitCode:5});process.emit('exit',1);
 const entries=fs.readFileSync(path.join(root,'logs/process.log'),'utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(entries.map(e=>e.event),['started','window-hidden','renderer-exit','process-exit']);assert.equal(entries[0].pid,123);
});
