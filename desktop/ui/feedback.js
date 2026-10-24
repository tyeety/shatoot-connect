'use strict';
(()=>{
 let timer;
 window.actionNotice=text=>{let box=document.getElementById('action-snackbar');if(!box){box=document.createElement('output');box.id='action-snackbar';box.setAttribute('role','status');document.body.append(box);}const owner=[...document.querySelectorAll('dialog[open]')].at(-1)||document.body;if(box.parentElement!==owner)owner.append(box);box.textContent=window.i18n?.translate(text)||text;box.hidden=false;clearTimeout(timer);timer=setTimeout(()=>box.hidden=true,3500);};
 document.addEventListener('selectstart',event=>{if(!(event.target.nodeType===1?event.target:event.target.parentElement)?.closest('input,textarea,[contenteditable=true]'))event.preventDefault();});
 document.addEventListener('dragstart',event=>{if(!(event.target.nodeType===1?event.target:event.target.parentElement)?.closest('input,textarea,[contenteditable=true]'))event.preventDefault();});
 document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button||button.disabled)return;button.classList.remove('action-feedback');void button.offsetWidth;button.classList.add('action-feedback');setTimeout(()=>button.classList.remove('action-feedback'),400);},true);
 window.addEventListener('DOMContentLoaded',()=>{const observer=new MutationObserver(records=>{const targets=new Set();for(const record of records){const target=record.target.closest?.('#favorites-list,#connection-history,#network-list,#chat-conversations,#chat-messages');if(target)targets.add(target);}for(const target of targets){target.classList.remove('data-feedback');void target.offsetWidth;target.classList.add('data-feedback');}});observer.observe(document.body,{childList:true,subtree:true});});
})();
