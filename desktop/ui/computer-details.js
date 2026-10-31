'use strict';
window.installComputerDetails=({engine})=>{
 const tr=text=>window.i18n.translate(text),version=peer=>peer?.appVersion?'v'+peer.appVersion:tr('Version unknown');
 async function show(peer){
  document.querySelector('#computer-info-dialog')?.close();
  const dialog=document.createElement('dialog');dialog.id='computer-info-dialog';dialog.className='chat-extra-dialog system-details-dialog';
  const heading=document.createElement('div');heading.className='settings-heading';const title=document.createElement('h2');title.textContent=tr('System details');const close=document.createElement('button');close.type='button';close.className='icon-button';close.id='computer-info-close';close.title=tr('Close');close.setAttribute('aria-label',close.title);close.innerHTML='<span class="mi close" aria-hidden="true"></span>';close.onclick=()=>dialog.close();heading.append(title,close);
  const person=document.createElement('div');window.renderChatPerson(person,peer);const reported=document.createElement('p');reported.className='system-details-version';reported.hidden=true;reported.textContent=tr('App version')+': '+version(peer);
  const state=document.createElement('p');state.className='system-details-status';state.setAttribute('role','status');const details=document.createElement('dl');details.className='system-info-list';
  const refresh=document.createElement('button');refresh.type='button';refresh.className='small-button';refresh.textContent=tr('Refresh');refresh.id='computer-info-refresh';dialog.append(heading,person,reported,state,details,refresh);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
  const number=value=>new Intl.NumberFormat(window.i18n.language==='fa'?'fa-IR':'en',{maximumFractionDigits:1}).format(value),size=value=>number(value/1073741824)+' GB';
  function add(label,text,key){const term=document.createElement('dt'),value=document.createElement('dd');term.textContent=tr(label);value.textContent=text||tr('Not reported');value.setAttribute('translate','no');value.dir='auto';value.dataset.info=key;details.append(term,value);}
  let loading=false;
  let latest,lastError='';
  function renderInfo(info){details.replaceChildren();reported.textContent=tr('App version')+': v'+info.appVersion;
   add('Computer name',info.hostName,'hostName');add('Operating system',info.osName+' · '+info.osRelease,'os');add('Architecture',info.architecture,'architecture');add('Processor',info.cpuModel,'cpu');add('Logical processors',number(info.logicalCores),'cores');add('Memory',size(info.totalMemory)+' · '+tr('Free')+': '+size(info.freeMemory),'memory');
   add('Graphics',info.gpus.map(g=>g.name+(g.driver?' · '+tr('Driver')+': '+g.driver:'')).join('\n'),'gpus');add('Displays',info.displays.map(d=>d.width+' × '+d.height+' · '+number(d.scale*100)+'%'+(d.refreshRate?' · '+number(d.refreshRate)+' Hz':'')).join('\n'),'displays');add('Disks',info.drives.map(d=>d.name+' · '+size(d.total)+' · '+tr('Free')+': '+size(d.free)).join('\n'),'drives');add('Uptime',number(info.uptimeSeconds/3600)+' '+tr('hours'),'uptime');state.textContent=tr('Updated')+' · '+new Intl.DateTimeFormat(window.i18n.language==='fa'?'fa-IR':'en',{dateStyle:'medium',timeStyle:'medium'}).format(new Date(info.capturedAt));}
  const errorText=message=>{let text=message,previous;do{previous=text;text=text.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,'');}while(text!==previous);return tr(text.replace(/^Error:\s*/,''));};
  function languageChanged(){title.textContent=tr('System details');refresh.textContent=tr('Refresh');close.title=tr('Close');close.setAttribute('aria-label',close.title);if(latest)renderInfo(latest);else{reported.textContent=tr('App version')+': '+version(peer);state.textContent=lastError?errorText(lastError):tr('Requesting system details…');}}
  window.addEventListener('shatoot-language-change',languageChanged);dialog.addEventListener('close',()=>window.removeEventListener('shatoot-language-change',languageChanged),{once:true});
  async function load(){if(loading)return;loading=true;refresh.disabled=true;lastError='';state.classList.remove('error');state.textContent=tr('Requesting system details…');try{const info=await engine().computerInfo(peer);if(!dialog.isConnected)return;latest=info;renderInfo(info);}catch(error){if(dialog.isConnected){lastError=error.message;state.textContent=errorText(lastError);state.classList.add('error');}}finally{loading=false;if(dialog.isConnected)refresh.disabled=false;}}
  refresh.onclick=load;load();return dialog;
 }
 return {show,version};
};
