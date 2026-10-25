'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const quote=value=>"'"+String(value).replace(/'/g,"''")+"'";
function startUpdateWorker({powershell,worker,parameters,directory,timeout=30000,run=spawn}){
 const token=parameters.ReadyToken,handshake=path.join(directory,token+'.worker.json'),log=path.join(directory,token+'.worker.log'),errorLog=path.join(directory,token+'.worker.error.log'),exitFile=path.join(directory,token+'.worker.exit.json'),launchFile=path.join(directory,token+'.worker.launch.json');
 if(!/^[a-f0-9-]{36}$/i.test(token))throw Error('Invalid update token.');
 const retained=fs.readdirSync(directory).filter(name=>/^[a-f0-9-]{36}\.worker\.(ps1|log|error\.log|exit\.json|launch\.json)$/i.test(name)).map(name=>({file:path.join(directory,name),stat:fs.lstatSync(path.join(directory,name))})).filter(item=>item.stat.isFile()&&!item.stat.isSymbolicLink()).sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);
 for(const item of retained.slice(25))if(Date.now()-item.stat.mtimeMs>3600000)try{fs.unlinkSync(item.file);}catch{}
 const values=Object.entries(parameters).map(([key,value])=>{if(!/^[A-Za-z]+$/.test(key))throw Error('Invalid worker argument.');return key+'='+(typeof value==='boolean'?(value?'$true':'$false'):quote(value));}).join(';');
 const command=`$ErrorActionPreference='Stop';$code=0;try{$arguments=@{${values}};& ${quote(worker)} @arguments;if($LASTEXITCODE){$code=$LASTEXITCODE}}catch{[Console]::Error.WriteLine($_.Exception.Message);$code=1}finally{[IO.File]::WriteAllText(${quote(exitFile)},(@{token=${quote(token)};code=$code}|ConvertTo-Json -Compress))};exit $code`;
 const encoded=Buffer.from(command,'utf16le').toString('base64');
 const bootstrap=`$ErrorActionPreference='Stop';try{$p=Start-Process -FilePath ${quote(powershell)} -ArgumentList '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}' -WindowStyle Hidden -RedirectStandardOutput ${quote(log)} -RedirectStandardError ${quote(errorLog)} -PassThru;[IO.File]::WriteAllText(${quote(launchFile)},(@{token=${quote(token)};pid=$p.Id}|ConvertTo-Json -Compress))}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}`;
 const proc=run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(bootstrap,'utf16le').toString('base64')],{detached:false,windowsHide:true,stdio:['ignore','pipe','pipe'],cwd:directory});
 let bootstrapError='';proc.stdout.on('data',()=>{});proc.stderr.on('data',chunk=>{bootstrapError=(bootstrapError+chunk).slice(-1500);});
 return new Promise((resolve,reject)=>{
  let settled=false;const acknowledged=()=>{try{const value=JSON.parse(fs.readFileSync(handshake,'utf8'));return value.token===token&&value.version===parameters.Version;}catch{return false;}};
  const finish=error=>{if(settled)return;settled=true;clearInterval(poll);clearTimeout(deadline);proc.removeListener('error',failed);proc.removeListener('exit',exited);if(error){let detail='';try{detail=fs.readFileSync(errorLog,'utf8').trim().slice(-1500);}catch{}detail=detail||bootstrapError;reject(new Error(detail||error.message));}else{proc.unref();resolve(proc);}};
  const failed=error=>finish(error),exited=code=>{if(code!==0)finish(acknowledged()?undefined:new Error(`Update launcher exited before confirming readiness (${code}). Diagnostic log: ${errorLog}`));};
  const poll=setInterval(()=>{if(acknowledged()){finish();return;}try{const result=JSON.parse(fs.readFileSync(exitFile,'utf8'));if(result.token===token)finish(new Error(`Update helper stopped before confirming readiness. Diagnostic log: ${errorLog}`));}catch{}},100);
  const deadline=setTimeout(()=>{if(acknowledged()){finish();return;}try{const child=JSON.parse(fs.readFileSync(launchFile,'utf8'));if(child.token===token&&Number.isInteger(child.pid))process.kill(child.pid);}catch{}proc.kill();finish(new Error(`Update helper did not become ready. Diagnostic log: ${log}`));},timeout);
  proc.once('error',failed);proc.once('exit',exited);
 });
}
module.exports={startUpdateWorker};
