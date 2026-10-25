'use strict';
const{test}=require('node:test');const assert=require('node:assert/strict');
const{wallpaperReader}=require('../desktop/wallpaper.cjs');
test('wallpaper reads the Windows file without capturing the desktop, caches and handles solid backgrounds',async()=>{
 let reads=0,options,bitmap;
 const image={isEmpty:()=>false,resize:o=>{assert.deepEqual(o,{width:320,height:180,quality:'good'});return image;},toJPEG:q=>{assert.equal(q,65);return Buffer.from('jpeg');}};
 const nativeImage={createFromPath:file=>{assert.equal(file,__filename);return image;},createFromBitmap:(bytes,size)=>{bitmap=bytes;assert.deepEqual(size,{width:320,height:180});return image;}};
 const reader=wallpaperReader({nativeImage,executable:()=> 'helper.exe',run:(exe,args,opt,done)=>{reads++;assert.equal(exe,'helper.exe');assert.deepEqual(args,['--wallpaper']);options=opt;done(null,JSON.stringify({path:__filename}));}});
 assert.equal(await reader(),'data:image/jpeg;base64,anBlZw==');await reader();assert.equal(reads,1);assert.equal(options.windowsHide,true);
 await wallpaperReader({nativeImage,executable:()=>'',run:(_e,_a,_o,done)=>done(null,JSON.stringify({path:'',color:0x123456}))})();assert.deepEqual([...bitmap.subarray(0,4)],[0x12,0x34,0x56,255]);
 await assert.rejects(wallpaperReader({nativeImage,executable:()=>'',run:(_e,_a,_o,done)=>done(Error('failed'))})(),/wallpaper/);
 await assert.rejects(wallpaperReader({nativeImage,executable:()=>'',run:(_e,_a,_o,done)=>done(null,'invalid')})(),/wallpaper/);
});
