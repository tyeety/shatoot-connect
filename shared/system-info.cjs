'use strict';
function normalize(value){
 const invalid=()=>{throw Error('Invalid system details.');};
 if(!value||value.schema!==1||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.deviceId))invalid();
 const text=(v,n)=>{if(typeof v!=='string'||v.length>n)invalid();return v.replace(/[\x00-\x1f\x7f]/g,' ');};
 const number=(v,max=Number.MAX_SAFE_INTEGER,min=0)=>{if(!Number.isFinite(v)||v<min||v>max)invalid();return v;};
 const list=(v,max,fn)=>{if(!Array.isArray(v)||v.length>max)invalid();return v.map(item=>{if(!item||typeof item!=='object'||Array.isArray(item))invalid();return fn(item);});};
 const appVersion=require('./profile.cjs').profile(value).appVersion;if(!appVersion)invalid();
 const memory=number(value.totalMemory),free=number(value.freeMemory,memory);
 return {schema:1,deviceId:value.deviceId,appVersion,capturedAt:number(value.capturedAt,8640000000000000),hostName:text(value.hostName,128),osName:text(value.osName,200),osRelease:text(value.osRelease,64),architecture:text(value.architecture,32),cpuModel:text(value.cpuModel,200),logicalCores:number(value.logicalCores,65536),totalMemory:memory,freeMemory:free,uptimeSeconds:number(value.uptimeSeconds),gpus:list(value.gpus,8,g=>({name:text(g.name,200),driver:text(g.driver,128)})),displays:list(value.displays,16,d=>({width:number(d.width,65536,1),height:number(d.height,65536,1),scale:number(d.scale,16,.1),refreshRate:number(d.refreshRate,1000)})),drives:list(value.drives,26,d=>({name:text(d.name,32),total:number(d.total),free:number(d.free,d.total)}))};
}
module.exports={normalize};
