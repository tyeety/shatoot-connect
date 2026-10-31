'use strict';
(async()=>{
 const query=new URLSearchParams(location.search),viewer=query.has('viewer');
 if(viewer)document.body.classList.add('remote-window','remote-connecting');
 const load=source=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=source;script.onload=resolve;script.onerror=()=>reject(Error('Application module could not load: '+source));document.body.append(script);});
 // Remote tabs only need RTC/input/video. Chat data and editors belong to the main renderer.
 if(!viewer)for(const source of ["collaboration.js","voice-messages.js","assets/emoji-data.js","assets/emoji-keywords.js","chat-extras.js","computer-details.js","story-playlist.js","story-design.js","story-editor.js","social.js","app-tabs.js","assets/markdown-it.min.js","rich-message.js","assets/message-editor.min.js","message-composer.js","collections.js","messenger.js","client-settings.js"])await load(source);
 await load(query.has('chat')?'chat-window.js':'renderer.js');
})().catch(error=>{const output=document.querySelector('#status')||document.querySelector('#toast');if(output){output.hidden=false;output.textContent=error.message;}});
