'use strict';
const fs=require('node:fs'),path=require('node:path'),{Readable}=require('node:stream');
const types={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',m4a:'audio/mp4',ogg:'audio/ogg',wav:'audio/wav'};
function mime(file){return types[path.extname(file).slice(1).toLowerCase()];}
async function response(file,request){
 const stat=await fs.promises.lstat(file),type=mime(file);if(!type||!stat.isFile()||stat.isSymbolicLink())return new Response(null,{status:404});
 let start=0,end=stat.size-1,status=200;const range=request.headers.get('range');
 if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416});start=match[1]?Number(match[1]):Math.max(0,stat.size-Number(match[2]));end=match[1]&&match[2]?Math.min(end,Number(match[2])):end;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=stat.size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${stat.size}`}});status=206;}
 const headers={'Content-Type':type,'Content-Length':String(Math.max(0,end-start+1)),'Accept-Ranges':'bytes','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;
 return new Response(request.method==='HEAD'||!stat.size?null:Readable.toWeb(fs.createReadStream(file,{start,end})),{status,headers});
}
module.exports={mime,response};
