'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises'),{Transform}=require('node:stream');
const CHUNK=4*1024*1024;
const header=(res,key)=>{const value=res.headers?.[key];return Array.isArray(value)?value[0]:value;};
async function download({asset,partial,request,progress,chunkSize=CHUNK,idleMs=20000,retryDelay=500}){
 const checkpoint=partial+'.json',count=Math.ceil(asset.size/chunkSize);let done={},inflight=new Map(),lastAt=Date.now(),lastBytes=0;
 const hashFile=async(start,end)=>{const hash=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(partial,{start,end}))hash.update(bytes);return hash.digest('hex');};
 try{const saved=JSON.parse(fs.readFileSync(checkpoint,'utf8'));if(saved.digest===asset.digest&&saved.size===asset.size&&saved.chunkSize===chunkSize&&fs.statSync(partial).size===asset.size){for(const [key,hash]of Object.entries(saved.done||{})){const n=Number(key);if(Number.isSafeInteger(n)&&n>=0&&n<count&&/^[a-f0-9]{64}$/.test(hash)&&await hashFile(n*chunkSize,Math.min(asset.size,(n+1)*chunkSize)-1)===hash)done[n]=hash;}}}catch{}
 const length=n=>Math.min(chunkSize,asset.size-n*chunkSize);
 const report=(force=false)=>{const bytes=Object.keys(done).reduce((n,k)=>n+length(Number(k)),0)+[...inflight.values()].reduce((a,b)=>a+b,0),now=Date.now();if(force||now-lastAt>=200){const speed=Math.max(0,(bytes-lastBytes)*1000/Math.max(1,now-lastAt));progress({percent:Math.min(99,Math.floor(bytes*100/asset.size)),received:bytes,total:asset.size,speed,retrying:false});lastAt=now;lastBytes=bytes;}};
 const save=()=>{fs.writeFileSync(checkpoint+'.tmp',JSON.stringify({digest:asset.digest,size:asset.size,chunkSize,done}),{mode:0o600});fs.renameSync(checkpoint+'.tmp',checkpoint);};
 const retry=async(fn)=>{for(let attempt=0;;attempt++){try{return await fn(attempt);}catch(error){if(error.integrity||attempt>=3){if(!error.integrity)error.resumable=true;throw error;}progress({retrying:true});await new Promise(r=>setTimeout(r,retryDelay*2**attempt));}}};
 const consume=async(res,start,end,onBytes)=>{let size=0,timer;const hash=crypto.createHash('sha256'),idle=()=>{clearTimeout(timer);timer=setTimeout(()=>res.destroy(Error('Update download stalled.')),idleMs);};idle();try{await pipeline(res,new Transform({transform(bytes,_encoding,callback){idle();size+=bytes.length;if(size>end-start+1){const error=Error('Update size mismatch.');error.integrity=true;callback(error);return;}hash.update(bytes);onBytes(size);callback(null,bytes);}}),fs.createWriteStream(partial,{flags:'r+',start}));if(size!==end-start+1)throw Error('Update download ended early.');return hash.digest('hex');}finally{clearTimeout(timer);}};
 const rangeError=()=>{const error=Error('Invalid update range response.');error.integrity=true;return error;};
 const receive=async(n,existing)=>retry(async()=>{const start=n*chunkSize,end=start+length(n)-1,res=existing||await request(asset.url,{start,end});existing=null;if(res.statusCode!==206||header(res,'content-range')!==`bytes ${start}-${end}/${asset.size}`){res.destroy();throw rangeError();}try{const hash=await consume(res,start,end,size=>{inflight.set(n,size);report();});done[n]=hash;inflight.delete(n);save();report(true);}catch(error){inflight.delete(n);throw error;}});
 try{
  report(true);
  if(!Object.keys(done).length){
   const first=await retry(()=>request(asset.url,{start:0,end:length(0)-1}));
   const fd=fs.openSync(partial,'w',0o600);fs.ftruncateSync(fd,asset.size);fs.closeSync(fd);
   if(first.statusCode!==206){
    let response=first;
    await retry(async()=>{const res=response||await request(asset.url);response=null;if(res.statusCode&&res.statusCode!==200){res.destroy();throw rangeError();}await consume(res,0,asset.size-1,size=>{inflight.set(0,size);progress({percent:Math.min(99,Math.floor(size*100/asset.size)),received:size,total:asset.size,retrying:false});});});
   }else{await receive(0,first);}
  }
  if(Object.keys(done).length){let next=0,failure;const worker=async()=>{while(!failure){while(next<count&&done[next])next++;if(next>=count)return;const n=next++;try{await receive(n);}catch(error){failure||=error;}}};await Promise.allSettled(Array.from({length:Math.min(4,count)},worker));if(failure)throw failure;}
  if(await hashFile(0,asset.size-1)!==asset.digest){const error=Error('Update integrity check failed. The existing application was kept.');error.integrity=true;throw error;}
  fs.rmSync(checkpoint,{force:true});fs.rmSync(checkpoint+'.tmp',{force:true});
 }catch(error){if(!error.resumable){fs.rmSync(partial,{force:true});fs.rmSync(checkpoint,{force:true});fs.rmSync(checkpoint+'.tmp',{force:true});}throw error;}
}
module.exports={download};
