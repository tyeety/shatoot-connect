'use strict';
const os=require('node:os'),fs=require('node:fs');
function createSystemInfo({app,screen,platform=os,files=fs,systemDrive=process.env.SystemDrive||'C:'}){
 let cached,expires=0;
 async function collect(){
  const cpus=platform.cpus(),drives=[];try{const disk=files.statfsSync(systemDrive+'\\');drives.push({name:systemDrive,total:disk.blocks*disk.bsize,free:disk.bavail*disk.bsize});}catch{}
  let gpu={},timer;try{gpu=await Promise.race([app.getGPUInfo('complete'),new Promise(resolve=>{timer=setTimeout(()=>resolve({}),1500);})]);}catch{}finally{clearTimeout(timer);}
  const vendors={32902:'Intel',4318:'NVIDIA',4098:'AMD',5140:'Microsoft'};
  return {schema:1,appVersion:app.getVersion(),capturedAt:Date.now(),hostName:platform.hostname().slice(0,128),osName:platform.version().slice(0,200),osRelease:platform.release().slice(0,64),architecture:platform.arch(),cpuModel:(cpus[0]?.model||'').slice(0,200),logicalCores:cpus.length,totalMemory:platform.totalmem(),freeMemory:platform.freemem(),uptimeSeconds:Math.floor(platform.uptime()),gpus:(gpu.gpuDevice||[]).slice(0,8).map(g=>({name:String(g.deviceString||g.vendorString||vendors[g.vendorId]||'GPU').slice(0,200),driver:String(gpu.auxAttributes?.driverVersion||g.driverVersion||'').slice(0,128)})),displays:screen.getAllDisplays().slice(0,16).map(d=>({width:d.size.width,height:d.size.height,scale:d.scaleFactor,refreshRate:d.displayFrequency||0})),drives};
 }
 return async deviceId=>{if(!cached||Date.now()>=expires){expires=Date.now()+30000;cached=collect().catch(error=>{cached=null;throw error;});}return require('../shared/system-info.cjs').normalize({...await cached,deviceId});};
}
module.exports={createSystemInfo};
