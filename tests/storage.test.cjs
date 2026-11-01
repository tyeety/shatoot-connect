'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const{Storage}=require('../desktop/storage.cjs');
test('storage cleanup is scoped to managed copies, skips links/protected files, and ages temporary setup files',async t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'shatoot-storage-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));const root=path.join(base,'profile'),downloads=path.join(base,'Downloads');fs.mkdirSync(root);fs.mkdirSync(downloads);
 const put=(relative,data='keep')=>{const file=path.join(base,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);return file;};
 const original=put('Downloads/original.txt'),received=put('Downloads/Receive-abc123/file.txt');put('Downloads/Receive-abc123/.shatoot-receive');const unknown=put('Downloads/Receive-xyz123/unrelated.txt');
 const old=put('profile/updates/ShatootConnect-Setup-0.10.0-win-x64.exe'),current=put('profile/updates/ShatootConnect-Setup-0.11.0-win-x64.exe'),other=put('profile/updates/other.exe');const date=new Date(Date.now()-10*86400000);fs.utimesSync(old,date,date);fs.utimesSync(current,date,date);
 const manager=new Storage({root,downloads,temp:base,protectedFiles:()=>[current]});const rows=await manager.snapshot();assert.equal(rows.find(r=>r.id==='received').count,2);await manager.maintain();assert.equal(fs.existsSync(old),false);assert.ok(fs.existsSync(current)&&fs.existsSync(other));await manager.clear('received');assert.equal(fs.existsSync(received),false);assert.ok(fs.existsSync(original)&&fs.existsSync(unknown));
 const outside=put('outside/keep.txt');fs.symlinkSync(path.join(base,'outside'),path.join(root,'story-media'),'junction');await manager.clear('stories');assert.ok(fs.existsSync(outside));await assert.rejects(manager.clear('../outside'),/Invalid/);
});
