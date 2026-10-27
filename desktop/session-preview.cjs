'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
class SessionPreviews{
 constructor({file,encrypt,decrypt,now=Date.now}){Object.assign(this,{file,encrypt,decrypt,now});}
 key(target){return crypto.createHash('sha256').update(target.key).digest('hex');}
 load(){try{const value=JSON.parse(fs.readFileSync(this.file,'utf8'));return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return{};}}
 get(target,deviceId){try{const record=this.load()[this.key(target)];if(!record)return null;const value=JSON.parse(this.decrypt(Buffer.from(record.value,'base64')));if(deviceId&&value.deviceId!==deviceId)return null;if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value.image)||value.image.length>200000)return null;return {...value,kind:'session'};}catch{return null;}}
 put(target,{image,deviceId=''}){if(typeof image!=='string'||image.length>200000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(image))throw Error('Invalid session preview.');const capturedAt=this.now(),data=this.load();data[this.key(target)]={at:capturedAt,value:this.encrypt(JSON.stringify({image,deviceId,capturedAt})).toString('base64')};const sorted=Object.entries(data).sort((a,b)=>b[1].at-a[1].at).slice(0,64);fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(Object.fromEntries(sorted)),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);return true;}
}
module.exports={SessionPreviews};
