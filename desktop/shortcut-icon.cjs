'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function avatarIcon({directory,id,avatar,nativeImage}){
 if(!UUID.test(id))throw Error('Invalid saved computer.');
 if(typeof avatar!=='string'||avatar.length>24000||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(avatar))return '';
 const png=Buffer.from(avatar.slice(22),'base64');if(png.length<33||!png.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||png.toString('ascii',12,16)!=='IHDR'||!png.readUInt32BE(16)||!png.readUInt32BE(20)||png.readUInt32BE(16)>2048||png.readUInt32BE(20)>2048)return '';
 const file=path.join(directory,`${id}-${crypto.createHash('sha256').update(avatar).digest('hex').slice(0,20)}.ico`);
 if(fs.existsSync(file))return file;
 try{
  const image=nativeImage.createFromDataURL(avatar),size=image.getSize();if(image.isEmpty()||size.width>2048||size.height>2048)return '';
  const edge=Math.min(size.width,size.height),square=image.crop({x:Math.floor((size.width-edge)/2),y:Math.floor((size.height-edge)/2),width:edge,height:edge});
  const sizes=[16,32,48,256],images=sizes.map(width=>square.resize({width,height:width,quality:'best'}).toPNG());
  const header=Buffer.alloc(6+16*images.length);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);let offset=header.length;
  images.forEach((png,index)=>{const entry=6+16*index;header[entry]=header[entry+1]=sizes[index]===256?0:sizes[index];header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(png.length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=png.length;});
  fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(file,Buffer.concat([header,...images]),{flag:'wx'});return file;
 }catch{return '';}
}
// Remove only this favorite's obsolete generated images after its link has been updated.
function pruneIcons(directory,id,keep=''){
 if(!UUID.test(id)||!fs.existsSync(directory))return;
 for(const name of fs.readdirSync(directory))if(new RegExp('^'+id+'-[a-f0-9]{20}\\.ico$','i').test(name)){const file=path.join(directory,name);if(file!==keep)try{fs.unlinkSync(file);}catch{}}
}
module.exports={avatarIcon,pruneIcons};
