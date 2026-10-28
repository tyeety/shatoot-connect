'use strict';
window.installWorkspace=()=>{
 const api=window.shatootconnect,nav=document.createElement('nav');nav.id='app-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Shatoot Connect');document.body.prepend(nav);document.body.classList.add('workspace');
 let section='home',remotes=[],selectionRevision=0,pending=0;
 const titles={home:'Home',chat:'Messages',settings:'Settings'},nodes=new Map();
 const failure=e=>window.actionNotice?.(e.message||String(e));
 function render(){
  const ids=['home','chat','settings',...remotes.map(t=>t.id)];
  for(const [id,node]of nodes)if(!ids.includes(id)){node.remove();nodes.delete(id);}
  for(const [index,id]of ids.entries()){
   let tab=nodes.get(id);
   if(!tab){tab=document.createElement('div');tab.className='workspace-tab';const b=document.createElement('button');b.type='button';b.setAttribute('role','tab');const label=document.createElement('span');label.className='workspace-tab-label';b.append(label);b.onclick=()=>show(id).catch(failure);tab.append(b);
    if(!titles[id]){const close=document.createElement('button');close.type='button';close.className='workspace-tab-close';close.innerHTML='<span class="mi close"></span>';close.onclick=()=>api.workspace('close',{id}).catch(failure);tab.append(close);}nodes.set(id,tab);
   }
   const b=tab.firstElementChild,label=b.firstElementChild,text=window.i18n.translate(titles[id]||remotes.find(t=>t.id===id)?.title||'Connection');if(label.textContent!==text)label.textContent=text;
   b.setAttribute('aria-selected',String(section===id));
   if(id==='chat'){const catalog=window.collaboration?.catalog,total=Object.entries(catalog?.unread||{}).filter(([key])=>!catalog.muted?.[key]&&!catalog.blocked?.[key.slice(2)]).reduce((n,[,v])=>n+v,0);let badge=b.querySelector('.unread-badge');if(total){if(!badge){badge=document.createElement('span');badge.className='unread-badge';b.append(badge);}badge.textContent=total>99?'99+':String(total);}else badge?.remove();}
   const close=tab.querySelector('.workspace-tab-close');if(close)close.setAttribute('aria-label',window.i18n.translate('Disconnect'));
   if(nav.children[index]!==tab)nav.insertBefore(tab,nav.children[index]||null);
  }
 }
 function panels(id){for(const [key,dialog]of [['chat',document.getElementById('messenger-dialog')],['settings',document.getElementById('settings-dialog')]]){if(key===id){if(!dialog.open)HTMLDialogElement.prototype.show.call(dialog);}else if(dialog.open)dialog.close();}}
 function paint(id){section=id;document.body.dataset.workspace=id;panels(id);render();}
 async function show(id,target){const revision=++selectionRevision;pending=revision;paint(id);try{await api.workspace('select',{id});if(revision!==selectionRevision)return;if(id==='chat'&&target)await window.messenger?.navigate(target);}finally{if(pending===revision)pending=0;}}
 const settings=document.getElementById('settings-dialog');settings.showModal=()=>show('settings');
 api.onWorkspace(value=>{if(value.tabs){remotes=value.tabs;if(!pending)paint(value.active);else render();}if(value.section)show(value.section,value.target).catch(failure);});
 window.addEventListener('shatoot-language-change',render);nav.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const tabs=[...nav.querySelectorAll('[role=tab]')],at=tabs.indexOf(e.target.closest('[role=tab]'));if(at<0)return;e.preventDefault();const next=tabs[e.key==='Home'?0:e.key==='End'?tabs.length-1:(at+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];next.focus();next.click();});
 window.workspace={show,render};render();show('home').catch(failure);return window.workspace;
};
