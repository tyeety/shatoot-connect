'use strict';
async function clipboardImage(clipboard){
  for(const item of await clipboard.read()){
    if(!item.types.includes('image/png'))continue;
    const blob=await item.getType('image/png');
    if(blob.size>10*1024**2)throw new Error('Clipboard image is too large.');
    const bytes=Buffer.from(await blob.arrayBuffer());
    if(bytes.length>10*1024**2)throw new Error('Clipboard image is too large.');
    return 'data:image/png;base64,'+bytes.toString('base64');
  }
  return '';
}
module.exports={clipboardImage};
