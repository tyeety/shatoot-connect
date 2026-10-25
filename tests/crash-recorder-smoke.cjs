'use strict';
// The development-only smoke flag isolates all paths before the crash recorder
// starts. Only a blank test renderer is crashed; the installed app is untouched.
module.exports=async({app,BrowserWindow,crashReporter})=>{
 const fs=require('node:fs'),path=require('node:path');
 if(crashReporter.getUploadToServer())throw Error('Crash uploads were enabled.');
 const probe=new BrowserWindow({show:false,webPreferences:{sandbox:false,nodeIntegration:true,contextIsolation:false}});
 const exited=new Promise(resolve=>probe.webContents.once('render-process-gone',(_event,details)=>resolve(details)));
 await probe.loadURL('data:text/html,<title>Isolated crash recorder probe</title>');
 probe.webContents.executeJavaScript("process.crash()").catch(()=>{});
 const deadline=Date.now()+20000,details=await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('Probe renderer did not exit.')),20000))]);
 const dumps=()=>{const found=[];function scan(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const name=path.join(directory,entry.name);if(entry.isDirectory())scan(name);else if(entry.name.endsWith('.dmp')&&fs.statSync(name).size>0)found.push(name);}}scan(app.getPath('crashDumps'));return found;};
 while(!dumps().length&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
 if(!dumps().length)throw Error('No local minidump was recorded.');
 const log=fs.readFileSync(path.join(app.getPath('userData'),'logs/process.log'),'utf8').trim().split('\n').map(JSON.parse);
 if(!log.some(entry=>entry.event==='renderer-exit'&&entry.reason===details.reason))throw Error('Renderer exit diagnostic is missing.');
 probe.destroy();console.log('SHATOOTCONNECT_CRASH_RECORDER_SMOKE passed: local minidump and renderer exit recorded, uploads disabled');app.quit();
};
