'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const{startUpdateWorker}=require('../desktop/update-launch.cjs');
test('the exact Node launch confirms a PowerShell worker, quotes Unicode paths and reports early exit output',{skip:process.platform!=='win32'},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"shatoot-update's-"));t.after(async()=>{
  for(let attempt=0;attempt<200;attempt++){let active=false;for(const name of fs.readdirSync(root).filter(n=>n.endsWith('.worker.launch.json')))try{const{pid}=JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));process.kill(pid,0);active=true;}catch{}if(!active)break;await new Promise(r=>setTimeout(r,50));}
  fs.rmSync(root,{recursive:true,force:true,maxRetries:20,retryDelay:100});
 });
 const worker=path.join(root,'worker.ps1'),powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
 fs.writeFileSync(worker,"param($ParentId,$Package,$Target,$Digest,$Version,$ReadyToken,$CacheDirectory,[switch]$Portable)\n[IO.File]::WriteAllText((Join-Path $CacheDirectory ($ReadyToken+'.worker.json')),(@{token=$ReadyToken;version=$Version}|ConvertTo-Json -Compress));Start-Sleep -Milliseconds 400");
 const launch=()=>startUpdateWorker({powershell,worker,directory:root,parameters:{ParentId:process.pid,Package:path.join(root,'فایل.exe'),Target:'target.exe',Digest:'abc',Version:'0.19.4',ReadyToken:crypto.randomUUID(),CacheDirectory:root,Portable:true}});
 const proc=await launch();await new Promise(r=>proc.exitCode!==null?r():proc.once('exit',r));assert.equal(proc.exitCode,0);
 const marker=path.join(root,'parent-exited');
 fs.writeFileSync(worker,"param($ParentId,$Version,$ReadyToken,$CacheDirectory)\n[IO.File]::WriteAllText((Join-Path $CacheDirectory ($ReadyToken+'.worker.json')),(@{token=$ReadyToken;version=$Version}|ConvertTo-Json -Compress));$parent=Get-Process -Id $ParentId -ErrorAction SilentlyContinue;if($parent){$parent.WaitForExit(5000)|Out-Null};[IO.File]::WriteAllText((Join-Path $CacheDirectory 'parent-exited'),'ready')");
 const parameters={Version:'0.19.4',ReadyToken:crypto.randomUUID(),CacheDirectory:root},modulePath=path.resolve(__dirname,'../desktop/update-launch.cjs');
 const code=`require(${JSON.stringify(modulePath)}).startUpdateWorker(${JSON.stringify({powershell,worker,directory:root,parameters})}).then(()=>process.exit(0),e=>{console.error(e);process.exit(1)})`.replace('"parameters":{','"parameters":{"ParentId":process.pid,');
 await new Promise((resolve,reject)=>require('node:child_process').execFile(process.execPath,['-e',code],{windowsHide:true,timeout:10000},error=>error?reject(error):resolve()));
 for(let i=0;i<100&&!fs.existsSync(marker);i++)await new Promise(r=>setTimeout(r,50));assert.equal(fs.readFileSync(marker,'utf8'),'ready','Worker must continue after the application exits');
 fs.writeFileSync(worker,"[Console]::Error.WriteLine('startup fixture failure');exit 0");await assert.rejects(launch(),/startup fixture failure/);
});
