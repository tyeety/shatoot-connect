'use strict';
const fs=require('node:fs'),path=require('node:path');
// Local, bounded process diagnostics. Never record chat, clipboard or profile data.
function diagnosticLog(directory,version){
 return (event,details={})=>{try{
  const entry={time:new Date().toISOString(),version,event};
  for(const key of ['type','reason','exitCode','serviceName','name','code','origin'])if(details[key]!==undefined)entry[key]=String(details[key]).slice(0,100);
  for(const key of ['pid','width','height'])if(Number.isFinite(details[key]))entry[key]=details[key];
  if(details.stack)entry.frames=String(details.stack).split('\n').slice(1,8).map(line=>line.slice(0,300));
  fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'process.log');
  if(fs.existsSync(file)&&fs.statSync(file).size>256*1024)fs.renameSync(file,path.join(directory,'process.previous.log'));
  fs.appendFileSync(file,JSON.stringify(entry)+'\n');
 }catch{}};
}
function installProcessDiagnostics({app,process,crashReporter}){
 const log=diagnosticLog(path.join(app.getPath('userData'),'logs'),app.getVersion());
 try{const directory=path.join(app.getPath('userData'),'crashes');fs.mkdirSync(directory,{recursive:true});app.setPath('crashDumps',directory);crashReporter.start({uploadToServer:false,productName:'Shatoot Connect'});}catch(error){log('crash-recorder-unavailable',{name:error.name,code:error.code});}
 log('started',{pid:process.pid});
 process.on('uncaughtExceptionMonitor',(error,origin)=>log('uncaught-exception',{name:error?.name,code:error?.code,stack:error?.stack,origin}));
 process.on('exit',exitCode=>log('process-exit',{exitCode}));
 app.on('before-quit',()=>log('before-quit'));
 app.on('render-process-gone',(_event,_contents,details)=>log('renderer-exit',details));
 app.on('child-process-gone',(_event,details)=>log('child-process-exit',details));
 return log;
}
module.exports={diagnosticLog,installProcessDiagnostics};
