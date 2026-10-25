'use strict';
const fs=require('node:fs');
const {execFile}=require('node:child_process');
function wallpaperReader({nativeImage,executable,run=execFile}){
  let cached,expires=0;
  return ()=>{
    if(cached&&Date.now()<expires)return cached;expires=Date.now()+30000;
    cached=new Promise((resolve,reject)=>run(executable(),['--wallpaper'],{windowsHide:true,timeout:5000,maxBuffer:131072},(error,text)=>{
      if(error){reject(new Error('Windows wallpaper could not be read.'));return;}
      try{
        const info=JSON.parse(text);let image;
        if(info.path){const stat=fs.statSync(info.path);if(!stat.isFile()||stat.size>50*1024**2)throw new Error();image=nativeImage.createFromPath(info.path);if(image.isEmpty())throw new Error();}
        else{const color=Number(info.color)||0,bytes=Buffer.alloc(320*180*4);for(let i=0;i<bytes.length;i+=4){bytes[i]=(color>>>16)&255;bytes[i+1]=(color>>>8)&255;bytes[i+2]=color&255;bytes[i+3]=255;}image=nativeImage.createFromBitmap(bytes,{width:320,height:180});}
        resolve('data:image/jpeg;base64,'+image.resize({width:320,height:180,quality:'good'}).toJPEG(65).toString('base64'));
      }catch{reject(new Error('Windows wallpaper could not be read.'));}
    }));return cached;
  };
}
module.exports={wallpaperReader};
