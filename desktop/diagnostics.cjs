'use strict';
const fs=require('node:fs'),path=require('node:path');
// Local, bounded process diagnostics. Never record chat, clipboard or profile data.
function diagnosticLog(directory,version){
 return (event,details={})=>{try{
  const entry={time:new Date().toISOString(),version,event};
  for(const key of ['type','reason','exitCode','serviceName','name','code','origin'])if(details[key]!==undefined)entry[key]=String(details[key]).slice(0,100);
  if(details.stack)entry.frames=String(details.stack).split('\n').slice(1,8).map(line=>line.slice(0,300));
  fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'process.log');
  if(fs.existsSync(file)&&fs.statSync(file).size>256*1024)fs.renameSync(file,path.join(directory,'process.previous.log'));
  fs.appendFileSync(file,JSON.stringify(entry)+'\n');
 }catch{}};
}
module.exports={diagnosticLog};
