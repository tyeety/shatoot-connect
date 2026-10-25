'use strict';
const{test}=require('node:test');const assert=require('node:assert/strict');
const{clipboardImage}=require('../desktop/clipboard-image.cjs');
test('clipboard image uses the asynchronous ClipboardItem API and preserves exact PNG bytes',async()=>{
 const bytes=Buffer.from([137,80,78,71,0,1,255]);let requested;
 const clipboard={read:async()=>[{types:['text/plain'],getType:()=>{throw Error('Not an image');}},{types:['image/png'],getType:async type=>{requested=type;return new Blob([bytes],{type});}}]};
 assert.equal(await clipboardImage(clipboard),'data:image/png;base64,'+bytes.toString('base64'));assert.equal(requested,'image/png');
 assert.equal(await clipboardImage({read:async()=>[]}), '');
 await assert.rejects(clipboardImage({read:async()=>[{types:['image/png'],getType:async()=>({size:10*1024**2+1})}]}),/too large/);
});
