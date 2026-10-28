'use strict';
function reference(value){
 if(value==null)return undefined;
 const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
 if(!value||typeof value!=='object'||!uuid.test(value.id)||!uuid.test(value.sender)||typeof value.name!=='string'||value.name.length>60||typeof value.text!=='string'||value.text.length>600||!['text','file'].includes(value.kind))throw Error('Invalid message reference.');
 const result={id:value.id,sender:value.sender,name:value.name,text:value.text,kind:value.kind};const avatar=require('./profile.cjs').profile(value).avatar;if(avatar)result.avatar=avatar;return result;
}
module.exports={reference};
