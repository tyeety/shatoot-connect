'use strict';
window.installMessenger = ({ api, self, internet, ensureInternet, remote, detached = false }) => {
  const $ = id => document.getElementById(id), tr = text => window.i18n.translate(text);
  let engine, targetMessage='',selected = '', selectionVersion = 0, rows = [], searchTimer, busy = false, discovery = { peers: [], interfaces: [], errors: [] }, historyTimer;
  let voice,extras,autoSelecting=false,renderedConversation='',historyRequest=0,dayFadeTimer,resizeFrame;
  const pendingNew=new Set();let readThrough=0;
  const logElement=$('chat-messages');
  const atBottom=()=>logElement.scrollHeight-logElement.scrollTop-logElement.clientHeight<45;
  let following=true;
  let editingGroup,groupAvatar='',groupBackground='',connecting=false,connectSequence=0;
  const progress = new Map();
  const displayName=peer=>peer?.displayName||peer?.name||'';
  const previewCard=(element,peer)=>{element.classList.add('computer-preview');if(peer.preview){const image=document.createElement('img');image.className='desktop-preview';image.alt='';image.src=peer.preview;image.draggable=false;element.prepend(image);}};
  const own=document.createElement('button');own.id='chat-own-profile';own.type='button';own.className='small-button';own.onclick=()=>api.editProfile();document.querySelector('.chat-sidebar').prepend(own);
  const contacts=document.createElement('div');contacts.className='chat-contact-list';$('chat-conversations').before(contacts);contacts.append($('chat-conversations'),$('chat-new-group'));
  window.overlayScroll($('chat-conversations'));window.overlayScroll($('chat-messages'));
  window.installPinnedReorder($('chat-conversations'),async order=>{await api.collaboration('reorder-pins',{order});await engine.refresh();});
  const jump=document.createElement('button');jump.id='chat-jump';jump.type='button';jump.className='icon-button';jump.innerHTML='<span class="mi arrow_forward" aria-hidden="true"></span><span class="unread-badge"></span>';jump.hidden=true;logElement.parentElement.append(jump);
  function updateJump(){jump.hidden=!selected||atBottom();jump.title=tr(pendingNew.size?'First unread message':'Scroll to latest');jump.setAttribute('aria-label',jump.title);const badge=jump.querySelector('.unread-badge');badge.hidden=!pendingNew.size;badge.textContent=String(pendingNew.size);}
  function updateDays(){const top=logElement.getBoundingClientRect().top;for(const group of logElement.children){const label=group.querySelector('.chat-day-label');label?.classList.toggle('is-stuck',group.getBoundingClientRect().top<top-1);}}
  function visibleNew(){if(!document.hasFocus()||!pendingNew.size)return;const viewport=logElement.getBoundingClientRect();for(const item of logElement.querySelectorAll('.chat-message'))if(pendingNew.has(item.dataset.messageId)){const r=item.getBoundingClientRect();if(r.top>=viewport.top-1&&r.bottom<=viewport.bottom+1){const row=rows.find(m=>m.id===item.dataset.messageId);readThrough=Math.max(readThrough,row?.receivedAt||0);pendingNew.delete(item.dataset.messageId);}}}
  function timelineScroll(){following=atBottom();if(following){pendingNew.clear();readThrough=Math.max(readThrough,...rows.map(m=>m.receivedAt));}else visibleNew();updateJump();updateDays();logElement.classList.add('timeline-scrolling');clearTimeout(dayFadeTimer);dayFadeTimer=setTimeout(()=>logElement.classList.remove('timeline-scrolling'),1200);reportView().catch(()=>{});}
  logElement.addEventListener('scroll',timelineScroll,{passive:true});
  jump.onclick=async()=>{try{if(pendingNew.size){if(!rows.some(row=>pendingNew.has(row.id)))await load(false);const first=[...logElement.querySelectorAll('.chat-message')].find(item=>pendingNew.has(item.dataset.messageId));if(first){first.scrollIntoView({block:'start',behavior:'smooth'});return;}}logElement.scrollTo({top:logElement.scrollHeight,behavior:'smooth'});}catch(e){error(e);}};
  new ResizeObserver(()=>{if(resizeFrame)return;resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;if(following)logElement.scrollTop=logElement.scrollHeight;updateJump();updateDays();});}).observe(logElement);
  $('chat-new-group').title=tr('New group');$('chat-new-group').setAttribute('aria-label',tr('New group'));$('chat-new-group').querySelector('span:not(.mi)').className='sr-only';
  $('chat-connect').hidden=true;

  const fileSetting=document.createElement('label');fileSetting.className='chat-file-setting';fileSetting.hidden=true;
  const fileCaption=document.createElement('span');fileCaption.textContent=tr('Incoming files');const filePolicy=document.createElement('select');filePolicy.id='chat-file-policy';filePolicy.setAttribute('aria-label',tr('Incoming files'));
  for(const[value,text]of [['inherit','Use global setting'],['accept','Receive automatically'],['ask','Ask before receiving files']]){const option=document.createElement('option');option.value=value;option.textContent=tr(text);filePolicy.append(option);}fileSetting.append(fileCaption,filePolicy);
  function reportView(){const viewport=logElement.getBoundingClientRect(),seen=[...logElement.querySelectorAll('.chat-message')].filter(item=>{const r=item.getBoundingClientRect();return r.bottom>viewport.top&&r.top<viewport.bottom;}).map(item=>item.dataset.messageId).slice(0,100);return api.chatView({conversation:selected,seen,atBottom:atBottom(),readThrough,active:!!selected&&$('messenger-dialog').open&&document.hasFocus()&&$('messenger-dialog').contains(document.activeElement)});}
  for(const event of ['focusin','focusout','visibilitychange'])document.addEventListener(event,()=>queueMicrotask(()=>reportView().catch(()=>{})));
  for(const event of ['focus','blur'])window.addEventListener(event,()=>reportView().catch(()=>{}));
  $('messenger-dialog').addEventListener('close',()=>reportView().catch(()=>{}));
  api.onChatFilesReceived(value=>{if(value.conversation!==selected||!$('messenger-dialog').open)return;if($('chat-search').value){$('chat-search').value='';rows=[];selectionVersion++;}if(!atBottom())pendingNew.add(value.id);load(false).catch(error);});
  const error = value => { $('chat-error').textContent = tr(value?.message || String(value));window.actionNotice?.(value?.message||String(value)); };
  const run = fn => async event => { const control=event?.currentTarget;event?.preventDefault(); try { $('chat-error').textContent = ''; await window.withActionFeedback(control,()=>fn(event)); } catch (e) { error(e); } };
  filePolicy.onchange=run(async()=>{const conversation=selected;await api.collaboration('file-policy',{conversation,mode:filePolicy.value});await engine.refresh();render();});
  function button(text, action, icon) { const b = document.createElement('button'); b.type = 'button'; b.className = icon ? 'icon-button' : 'small-button'; b.title = tr(text); b.setAttribute('aria-label', tr(text)); if (icon) { const i = document.createElement('span'); i.className = `mi ${icon}`; i.setAttribute('aria-hidden', 'true'); b.append(i); } else b.textContent = tr(text); b.onclick = run(action); return b; }
  const cancelConnect=document.createElement('button');cancelConnect.id='chat-cancel-connect';cancelConnect.type='button';cancelConnect.className='small-button stop';cancelConnect.textContent=tr('Cancel connection');cancelConnect.hidden=true;$('chat-connect-form').append(cancelConnect);
  cancelConnect.onclick=run(async()=>{connectSequence++;connecting=false;cancelConnect.hidden=true;$('chat-connect').disabled=false;$('chat-address').disabled=false;$('chat-error').textContent=tr('Connection cancelled.');await engine.cancelPending();});
  function open() { if (!detached && !window.shatootconnectSmoke) { api.openChat(); return; } if (!$('messenger-dialog').open) $('messenger-dialog').showModal(); render(); }
  function contact(id) { return engine.catalog.contacts.find(c => c.deviceId === id); }
  function online(id) { return !!engine.peer(id); }
  function routeFor(id) { const nearby = discovery.peers.find(p => p.deviceId === id); if (nearby?.endpoints.length) return { type: 'lan', address: nearby.endpoints[0], deviceId: id, name: nearby.name }; const saved = contact(id); return saved?.route ? { ...saved.route, deviceId: id, name: saved.name } : null; }
  async function start(destination) {
    if(connecting)return;const sequence=++connectSequence;connecting=true;cancelConnect.hidden=false;$('chat-connect').disabled=true;$('chat-address').disabled=true;
    open();$('chat-error').textContent=tr('Waiting for chat approval…');
    try{const s=await engine.connect(destination);if(sequence!==connectSequence)return;$('chat-error').textContent='';await select('p:'+s.peer.deviceId);return s;}
    catch(error){if(sequence===connectSequence)throw error;}
    finally{if(sequence===connectSequence){connecting=false;cancelConnect.hidden=true;$('chat-connect').disabled=false;$('chat-address').disabled=false;}}
  }
  async function select(id) { if(id!==selected)voice?.reset();if(id.startsWith('p:')){const route=routeFor(id.slice(2));if(route&&!online(id.slice(2)))engine.connect(route).catch(()=>{});} selected = id; window.chatSelected = id; rows = [];pendingNew.clear();readThrough=0;following=true; selectionVersion++; $('chat-search').value = ''; render(); await api.collaboration('conversation-state',{conversation:id,selected:true});engine.catalog.lastSelected=id;await reportView(); await load(false); publish(); }
  async function navigate(target){await select(target.conversation);targetMessage=target.message||'';if(target.message){if(!rows.some(m=>m.id===target.message)){const message=await api.collaboration('message',{conversation:target.conversation,id:target.message});if(message&&!message.deleted){rows=await api.collaboration('history',{conversation:target.conversation,before:message.receivedAt+1});renderMessages(false);}}const item=[...$('chat-messages').querySelectorAll('.chat-message')].find(e=>e.dataset.messageId===target.message);item?.scrollIntoView({block:'center'});item?.classList.add('message-target');setTimeout(()=>{if(targetMessage!==target.message)return;targetMessage='';for(const row of document.querySelectorAll('.message-target'))row.classList.remove('message-target');},3000);}$('chat-text').focus();}
  async function load(older = false) {
    if(!selected)return;const request=++historyRequest,version=selectionVersion,id=selected,search=$('chat-search').value.trim(),earliest=rows.length?Math.min(...rows.map(m=>m.receivedAt)):Number.MAX_SAFE_INTEGER;let before=older?earliest:Number.MAX_SAFE_INTEGER,result=[],page;
    do{page=await api.collaboration('history',{conversation:id,search,before});if(request!==historyRequest||version!==selectionVersion||id!==selected)return;result.unshift(...page);if(!page.length)break;before=page[0].receivedAt;}while(!older&&rows.length>100&&page.length===100&&before>earliest);
    if(search!==$('chat-search').value.trim())return;
    rows=older?[...new Map([...result,...rows].map(row=>[row.id,row])).values()]:result;$('chat-older').hidden=page.length<100;renderMessages(!older);
  }
  function createMessage(row){

      const item = document.createElement('article'); item.className = 'chat-message';item.dataset.messageId=row.id;if(row.id===targetMessage)item.classList.add('message-target'); const own = row.sender === self.deviceId;
      if (own) item.classList.add('own'); if (own && row.pending.length) item.classList.add('pending');
      const name = document.createElement('header'); name.textContent=row.sender===self.deviceId?self.name:row.displayName||displayName(contact(row.sender))||row.name;
      const text = document.createElement('p'); text.dir = 'auto'; text.textContent = row.deleted?tr('Message deleted'):row.text;
      const meta = document.createElement('small');meta.className='message-time';
      item.append(name, text);
      const footer=document.createElement('footer');footer.className='chat-message-footer';const timeGroup=document.createElement('span');timeGroup.className='message-meta';timeGroup.append(meta);footer.append(timeGroup);
      if(own){const receipt=document.createElement('span');receipt.className='message-receipt';receipt.setAttribute('role','img');meta.after(receipt);}
      if(row.deleted)item.classList.add('deleted');
      else {
        voice?.attachment(item,row);
        if(row.kind==='file'&&row.attachment&&!/^Voice-[a-f0-9-]{36}\.webm$/i.test(row.text)){
          const preview=document.createElement('div');preview.className='attachment-previews';item.append(preview);
          api.collaboration('attachment-preview',{token:row.attachment}).then(files=>{if(!preview.isConnected)return;if(files.length)text.hidden=true;const keepBottom=following,top=logElement.getBoundingClientRect().top,anchor=[...logElement.querySelectorAll('.chat-message')].find(e=>e.getBoundingClientRect().bottom>=top),anchorTop=anchor?.getBoundingClientRect().top;for(const file of files){const card=document.createElement('button');card.type='button';card.className='attachment-preview';card.title=tr(own?'Open sent files':'Open received files');card.onclick=run(()=>api.collaboration('open-attachment',{token:row.attachment,index:file.index}));if(file.image){const img=document.createElement('img');img.src=file.image;img.alt=file.name;img.loading='lazy';card.append(img);}else{const icon=document.createElement('span');icon.className='attachment-extension';icon.textContent=file.directory?tr('Folder'):file.extension||'FILE';card.append(icon);}const label=document.createElement('span');label.textContent=file.name;const size=document.createElement('small');size.dir='ltr';size.textContent=file.directory?tr('Folder'):file.size<1024?file.size+' B':file.size<1048576?Math.ceil(file.size/1024)+' KB':(file.size/1048576).toFixed(1)+' MB';card.append(label,size);preview.append(card);}if(keepBottom&&following)logElement.scrollTop=logElement.scrollHeight;else if(!following&&anchor?.isConnected){const delta=anchor.getBoundingClientRect().top-anchorTop;if(Math.abs(delta)>.5)logElement.scrollTop+=delta;}updateJump();}).catch(()=>{});
        }
        const actions=document.createElement('div');actions.className='chat-message-actions';
        if(row.attachment){actions.append(button(own?'Open sent files':'Open received files',()=>api.collaboration('open-attachment',{token:row.attachment}),'play_arrow'));actions.append(button('Open containing folder',()=>api.collaboration('reveal-attachment',{token:row.attachment}),'folder'));}
        const copy=button('Copy',()=>row.kind==='file'?api.chatClipboard('copy',row.attachment):api.copyText(rows.find(m=>m.id===row.id)?.text||row.text),'content_copy');copy.disabled=row.kind==='file'&&!row.attachment;actions.append(copy);
        actions.append(button('React to message',()=>extras.openReaction(rows.find(m=>m.id===row.id)||row),'sentiment_satisfied'));
        if(own){if(row.kind==='text')actions.append(button('Edit message',()=>editMessage(rows.find(m=>m.id===row.id)||row),'edit'));actions.append(button('Delete message',async()=>{await engine.changeMessage(row.conversation,row.id,'',true);await load(false);},'delete'));}
        footer.append(actions);
      }
      item.append(footer);
      return item;
  }
  function renderMessages(scroll){
    const log=logElement,initial=renderedConversation!==selected,stick=initial||following&&scroll,viewTop=log.getBoundingClientRect().top;
    const anchor=initial?null:[...log.querySelectorAll('.chat-message')].find(item=>item.getBoundingClientRect().bottom>=viewTop),anchorTop=anchor?.getBoundingClientRect().top;
    if(initial){log.replaceChildren();renderedConversation=selected;}
    const groups=new Map([...log.children].map(group=>[group.dataset.day,group])),nodes=new Map([...log.querySelectorAll('.chat-message')].map(item=>[item.dataset.messageId,item])),ordered=[...rows].filter(row=>!row.deleted).sort((a,b)=>a.at-b.at||a.receivedAt-b.receivedAt),usedGroups=new Set(),positions=new Map();let groupIndex=0;
    for(const row of ordered){const date=new Date(row.at),day=`${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`;let group=groups.get(day);
      if(!group){group=document.createElement('section');group.className='chat-day-group';group.dataset.day=day;const label=document.createElement('div');label.className='chat-day-label';group.append(label);groups.set(day,group);}
      group.querySelector('.chat-day-label').textContent=new Intl.DateTimeFormat(window.i18n.language==='fa'?'fa-IR':'en',{dateStyle:'full'}).format(date);
      if(!usedGroups.has(day)){if(log.children[groupIndex]!==group)log.insertBefore(group,log.children[groupIndex]||null);groupIndex++;usedGroups.add(day);}
      let item=nodes.get(row.id);nodes.delete(row.id);
      if(!item||item.dataset.attachment!==(row.attachment||'')){const fresh=createMessage(row);fresh.dataset.attachment=row.attachment||'';if(item)item.replaceWith(fresh);item=fresh;}
      item.classList.toggle('pending',row.sender===self.deviceId&&row.pending.length>0);item.classList.toggle('message-target',row.id===targetMessage);item.querySelector('header').textContent=row.sender===self.deviceId?self.name:row.displayName||displayName(contact(row.sender))||row.name;
      if(row.kind==='text')item.querySelector('p').textContent=row.text;
      extras?.renderReactions(item,row);
      const status=row.status==='seen'?'seen':row.status==='delivered'?'delivered':row.status==='failed'?'failed':'queued',statusText=tr(({seen:'Seen',delivered:'Delivered',failed:'Send failed',queued:'Waiting for delivery'})[status]);
      const meta=item.querySelector('.message-time');meta.textContent=new Intl.DateTimeFormat(window.i18n.language==='fa'?'fa-IR':'en',{hour:'2-digit',minute:'2-digit'}).format(date);meta.title=new Intl.DateTimeFormat(window.i18n.language==='fa'?'fa-IR':'en',{dateStyle:'full',timeStyle:'short'}).format(date)+(row.sender===self.deviceId?' · '+statusText:'')+(row.editedAt?' · '+tr('Edited'):'');
      const receipt=item.querySelector('.message-receipt');if(receipt){receipt.dataset.status=status;receipt.title=statusText;receipt.setAttribute('aria-label',statusText);receipt.className='message-receipt mi '+({seen:'done_all',delivered:'done',failed:'error_outline',queued:'schedule'})[status];}
      const index=(positions.get(day)||0)+1;positions.set(day,index);if(group.children[index]!==item)group.insertBefore(item,group.children[index]||null);
    }
    for(const item of nodes.values())item.remove();for(const [day,group]of groups)if(!usedGroups.has(day))group.remove();
    for(const id of pendingNew)if(!rows.some(row=>row.id===id))pendingNew.delete(id);
    if(stick){log.scrollTop=log.scrollHeight;following=true;}else if(anchor?.isConnected){const delta=anchor.getBoundingClientRect().top-anchorTop;if(Math.abs(delta)>.5)log.scrollTop+=delta;}
    if(atBottom())readThrough=Math.max(readThrough,...rows.map(m=>m.receivedAt));else{const viewport=log.getBoundingClientRect();for(const item of log.querySelectorAll('.chat-message')){const r=item.getBoundingClientRect();if(r.top>=viewport.top-1&&r.bottom<=viewport.bottom+1)readThrough=Math.max(readThrough,rows.find(m=>m.id===item.dataset.messageId)?.receivedAt||0);}}
    queueMicrotask(()=>reportView().catch(()=>{}));
    updateDays();updateJump();
  }
  function render(refreshHistory = false) {
    if (!engine) return;
    const pending=connecting||(engine.connectAttempts?[...engine.connectAttempts].filter(a=>!a.background).length:engine.pendingConnections||0)>0;cancelConnect.hidden=!pending;$('chat-connect').disabled=pending;$('chat-address').disabled=pending;
    const total=Object.values(engine.catalog.unread||{}).reduce((a,b)=>a+b,0);$('chat-total-unread').textContent=total>99?'99+':String(total);$('chat-total-unread').hidden=!total;
    own.replaceChildren();const ownImage=document.createElement('img');ownImage.src=self.avatar||'assets/app-icon.png';ownImage.className='profile-avatar';ownImage.alt='';const ownName=document.createElement('span');ownName.textContent=self.name;own.append(ownImage,ownName);
    const list = $('chat-conversations');
    const items = [...engine.catalog.contacts.map(c => ({ id: `p:${c.deviceId}`, avatar:c.avatar,preview:c.preview,name:displayName(c),detail: c.route?.address || c.deviceId.slice(0, 8), status: online(c.deviceId) ? c.status || 'available' : discovery.peers.some(p => p.deviceId === c.deviceId) ? 'On LAN' : 'Offline' })), ...engine.catalog.groups.map(g => ({ id: `g:${g.id}`, avatar:g.avatar,preview:g.background,name: g.name,detail:g.description, status: 'Group' }))];
    const last=new Map((engine.catalog.conversations||[]).map(c=>[c.id,c.last?.receivedAt||0]));
    const pinRank=new Map((engine.catalog.pinOrder||[]).map((id,index)=>[id,index]));
    items.sort((a,b)=>Number(!!engine.catalog.pins?.[b.id])-Number(!!engine.catalog.pins?.[a.id])||(engine.catalog.pins?.[a.id]&&engine.catalog.pins?.[b.id]?(pinRank.get(a.id)??Number.MAX_SAFE_INTEGER)-(pinRank.get(b.id)??Number.MAX_SAFE_INTEGER):0)||(last.get(b.id)||0)-(last.get(a.id)||0));
    const existing=new Map([...list.children].map(row=>[row.dataset.conversation,row]));
    for (let index=0;index<items.length;index++) {
      const item=items[index];let row=existing.get(item.id);existing.delete(item.id);
      if(!row){row=document.createElement('div');row.className='chat-contact-row';row.dataset.conversation=item.id;const b=document.createElement('button');b.className='chat-conversation';b.type='button';const image=document.createElement('img');image.className='profile-avatar';image.alt='';b.append(image,document.createElement('b'),document.createElement('small'));b.onclick=run(()=>selected===item.id?undefined:select(item.id));const pin=button('Pin chat',async()=>{await api.collaboration('conversation-state',{conversation:item.id,pinned:!engine.catalog.pins?.[item.id]});await engine.refresh();},'pin');pin.classList.add('chat-pin');row.append(b,pin);}
      const b=row.querySelector('.chat-conversation'),name=b.querySelector('b'),detail=b.querySelector('small'),image=b.querySelector('.profile-avatar'),pin=row.querySelector('.chat-pin');
      b.setAttribute('aria-pressed',String(item.id===selected));name.textContent=item.name;if(engine.catalog.muted?.[item.id]){const muted=document.createElement('span');muted.className='mi notifications_off conversation-muted';muted.title=tr('Notifications muted');muted.setAttribute('aria-label',muted.title);name.append(muted);}const count=engine.catalog.unread?.[item.id]||0;if(count){const badge=document.createElement('span');badge.className='unread-badge';badge.textContent=count>99?'99+':String(count);name.append(badge);}detail.textContent=item.detail||'';const src=item.avatar||'assets/app-icon.png';if(image.getAttribute('src')!==src)image.src=src;
      if(!item.id.startsWith('g:')){let dot=b.querySelector('.presence-dot');if(!dot){dot=document.createElement('span');b.append(dot);}dot.className='presence-dot presence-'+(online(item.id.slice(2))?(contact(item.id.slice(2))?.status||'available'):discovery.peers.some(p=>p.deviceId===item.id.slice(2))?'available':'offline');}
      let preview=b.querySelector('.desktop-preview');b.classList.add('computer-preview');if(item.preview){if(!preview){preview=document.createElement('img');preview.className='desktop-preview';preview.alt='';preview.draggable=false;b.prepend(preview);}if(preview.getAttribute('src')!==item.preview)preview.src=item.preview;}else preview?.remove();
      const pinned=!!engine.catalog.pins?.[item.id];row.draggable=pinned;row.classList.toggle('pinned-draggable',pinned);row.dataset.pinKey=item.id;pin.title=tr(pinned?'Unpin chat':'Pin chat');pin.setAttribute('aria-label',pin.title);pin.setAttribute('aria-pressed',String(pinned));if(list.children[index]!==row)list.insertBefore(row,list.children[index]||null);
    }
    for(const row of existing.values())row.remove();
    const group = selected.startsWith('g:') && engine.group(selected.slice(2)), peer = selected.startsWith('p:') && contact(selected.slice(2));
    if($('chat-mute')){const muted=!!engine.catalog.muted?.[selected],control=$('chat-mute');control.hidden=!selected;control.title=tr(muted?'Unmute notifications':'Mute notifications');control.setAttribute('aria-label',control.title);control.setAttribute('aria-pressed',String(muted));control.querySelector('.mi').className='mi '+(muted?'notifications_off':'notifications');}
    if($('chat-rename')){$('chat-rename').hidden=!selected;$('chat-rename').title=tr(selected.startsWith('g:')?'Conversation settings':'Rename saved computer');}
    $('chat-edit-group').hidden=!group||group.owner!==self.deviceId;
    $('chat-title').textContent = group?.name || displayName(peer) || tr('Select a conversation');
    const peerStatus=$('chat-peer-status');peerStatus.textContent=group?group.members.map(m=>displayName(contact(m.deviceId))||displayName(m)).join(', '):'';peerStatus.className=peer?'presence-dot presence-'+(online(peer.deviceId)?peer.status||'available':'offline'):'';
    $('chat-text').disabled = !selected; $('chat-send').disabled = !selected || busy; $('chat-send-files').disabled = !selected || busy;
    voice?.sync();
    extras?.sync();
    $('chat-progress').textContent = selected && progress.get(selected) || '';
    filePolicy.value=engine.catalog.filePolicies?.[selected]||'inherit';
    if(detached&&!selected&&items.length&&!autoSelecting){autoSelecting=true;queueMicrotask(()=>select(engine.catalog.lastSelected||items[0].id).catch(error).finally(()=>autoSelecting=false));}
    if (refreshHistory && $('messenger-dialog').open && selected) { clearTimeout(historyTimer); historyTimer = setTimeout(() => load(false).catch(error), 80); }
  }
  function renderDiscovery(value) {
    discovery = value;if(!detached){engine.nearby=value.peers;engine.reconnectKnown().catch(()=>{});}
    const list = $('network-list'); list.replaceChildren(); $('network-empty').hidden = value.peers.length > 0;
    $('discovery-status').textContent = `${value.peers.length} · ${tr('Nearby computers')} · ${value.interfaces.length} ${tr('network interfaces')}`;
    if (value.errors.length) { $('discovery-status').textContent += ' · ' + tr('Discovery is limited; check firewall or VPN LAN access.'); $('discovery-status').title = value.errors.join('\n'); }
    for (const peer of value.peers) {
      const card = document.createElement('div'); card.className = 'network-peer';
      if (peer.avatar) { const avatar = document.createElement('img'); avatar.className = 'profile-avatar'; avatar.src = peer.avatar; avatar.alt = ''; card.append(avatar); }
      const info = document.createElement('div'); info.className = 'network-peer-info'; const name = document.createElement('b'), address = document.createElement('small'); name.textContent=displayName(peer); address.textContent = peer.endpoints.join(' / ');const dot=document.createElement('span');dot.className='presence-dot presence-'+(peer.status||'available');name.append(dot); info.append(name, address);
      previewCard(card,peer);card.append(info, button('Start chat', () => start({ type: 'lan', address: peer.endpoints[0], deviceId: peer.deviceId, name: peer.name }), 'chat'), button('Connect to a computer', () => remote(peer.endpoints[0]), 'desktop_windows')); list.append(card);
    }
    render();publish();
  }
  function publish() { if (!detached && engine) api.chatPublish(snapshot()); }
  function snapshot() { return { self, pendingConnections:engine.connectAttempts?[...engine.connectAttempts].filter(a=>!a.background).length:0,catalog: engine.catalog, connected: engine.connected(), language: window.i18n.language, discovery, selected, progress: [...progress] }; }
  api.onChatUnread?.(value=>{if(engine){engine.catalog.unread=value.unread;const badge=$('chat-total-unread');badge.textContent=value.total>99?'99+':String(value.total);badge.hidden=!value.total;render();}});
  const totalBadge=document.createElement('span');totalBadge.id='chat-total-unread';totalBadge.className='unread-badge';totalBadge.hidden=true;$('open-messenger').append(totalBadge);
  engine = new window.CollaborationClient({ api, self, internet, ensureInternet, changed: () => { render(true); publish(); }, error, progress: value => { const text = tr(value.text) + (Number.isInteger(value.percent) ? ` ${value.percent}%` : ''); progress.set(value.conversation, text); if (selected === value.conversation) $('chat-progress').textContent = text; publish(); } });
  if(!detached)api.onChatTarget(target=>navigate(target).catch(error));
  if (!detached) api.onChatCommand(async (operation, args) => { if (operation === 'snapshot') return snapshot(); if (operation === 'close') { engine.close(engine.peer(args[0])); return; } const result = await engine[operation](...args); return operation === 'connect' ? { peer: result.peer } : result; });
  window.collaboration = engine;
  $('open-messenger').onclick = open;
  $('refresh-discovery').onclick = run(async () => {renderDiscovery(await api.discovery());window.refreshFeedback($('network-list'));});
  api.onDiscovery(renderDiscovery);
  $('chat-connect-form').onsubmit = run(async () => { const address = $('chat-address').value.trim(); await start({ type: address.includes('.') || address.includes(':') ? 'lan' : 'id', address }); });
  $('chat-search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { rows = []; selectionVersion++; load(false).catch(error); }, 200); };
  $('chat-older').onclick = run(() => load(true));
  $('chat-compose').onsubmit = run(async () => { const text = $('chat-text').value;if(voice?.active()||!text.trim()){voice?.activate();return;} await engine.send(selected, text); $('chat-text').value = '';voice?.sync(); following=true;await load(false); $('chat-messages').scrollTop = $('chat-messages').scrollHeight; });
  function insertPaste(text){const field=$('chat-text');field.setRangeText(text,field.selectionStart,field.selectionEnd,'end');field.dispatchEvent(new Event('input',{bubbles:true}));}
  async function pasteClipboard(event){const target=selected;if(!target)return;event.preventDefault();try{
    const items=[...(event.clipboardData?.items||[])],image=items.find(item=>item.kind==='file'&&item.type.startsWith('image/')),text=event.clipboardData?.getData('text/plain')||'';
    if(!image&&text){insertPaste(text);return;}
    if(image){const file=image.getAsFile();if(!file)return;if(file.size>10*1024**2)throw new Error('Clipboard image is too large.');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Invalid clipboard image.'));reader.readAsDataURL(file);});if(target===selected)await files('clipboard-image',data);return;}
    const localFiles=[...(event.clipboardData?.files||[])];if(localFiles.length){await files('drop',localFiles);return;}
    const data=await api.chatClipboard('read');if(target!==selected)return;if(data.files)await files('clipboard-sources');else if(data.text)insertPaste(data.text);else if(data.image)await files('clipboard-image',data.image);
  }catch(e){error(e);}}
  $('chat-text').addEventListener('paste',pasteClipboard);
  $('chat-text').onkeydown = event => {if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('chat-compose').requestSubmit(); } };
  async function files(operation = 'pick', value) { if (busy) throw new Error('A file transfer is already in progress.'); busy = true; render(); try { await engine.sendFiles(selected, operation, value); } finally { busy = false; render(); } }
  voice=window.installVoiceMessages({api,conversation:()=>selected,available:()=>!!selected&&!busy,send:(conversation,data)=>engine.sendFiles(conversation,'voice',data),error});
  extras=window.installChatExtras({api,engine,self,field:$('chat-text'),selected:()=>selected,button,run,tr,error,reload:()=>load(false)});
  $('chat-send-files').onclick = run(() => files());
  $('messenger-dialog').ondragover = event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = selected ? 'copy' : 'none'; } };
  $('messenger-dialog').ondrop = run(async event => { if (!selected || !event.dataTransfer.files.length) return; await files('drop', [...event.dataTransfer.files]); });
  const rename=button('Rename saved computer',async()=>{
    const peer=contact(selected.slice(2)),group=engine.group(selected.slice(2));if(!peer&&!group)return;
    let dialog=$('chat-name-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='chat-name-dialog';dialog.innerHTML='<form id="chat-name-form"><h2>Rename saved computer</h2><label for="chat-local-name">Computer nickname</label><input id="chat-local-name" maxlength="60"><div class="inline-setting"><button type="submit" class="small-button">Save</button><button type="button" id="chat-name-cancel" class="small-button">Cancel</button></div><p id="chat-name-error" class="error"></p></form>';document.body.append(dialog);}
    $('chat-local-name').after(fileSetting);fileSetting.hidden=false;filePolicy.value=engine.catalog.filePolicies?.[selected]||'inherit';
    dialog.querySelector('h2').textContent=tr(peer?'Rename saved computer':'Conversation settings');$('chat-local-name').readOnly=!peer;
    $('chat-local-name').value=peer?peer.displayName||peer.name:group.name;dialog.showModal();$('chat-local-name').focus();$('chat-local-name').select();$('chat-name-cancel').onclick=()=>dialog.close();
    $('chat-name-form').onsubmit=async event=>{event.preventDefault();try{if(peer)await api.computerCard('rename',{peer:{...peer,...peer.route},name:$('chat-local-name').value});await engine.refresh();dialog.close();render(true);}catch(e){$('chat-name-error').textContent=e.message;}};
  },'edit');rename.id='chat-rename';document.querySelector('.chat-thread-heading').append(rename);
  const mute=button('Mute notifications',async()=>{const conversation=selected;if(!conversation)return;const muted=!engine.catalog.muted?.[conversation];await api.collaboration('conversation-state',{conversation,muted});await engine.refresh();window.actionNotice(tr(muted?'Notifications muted':'Notifications unmuted'));},'notifications');mute.id='chat-mute';mute.hidden=!selected;document.querySelector('.chat-thread-heading').append(mute);
  const groupEditor=async existing=>{
    editingGroup=existing;const list = $('chat-group-members'); list.replaceChildren(); $('chat-group-error').textContent = ''; $('chat-group-name').value = existing?.name||'';
    groupBackground=existing?.background||'';groupAvatar=existing?.avatar||'';$('chat-group-avatar').src=groupAvatar||'assets/app-icon.png';$('chat-group-description').value=existing?.description||'';
    document.querySelector('#chat-group-dialog h2').textContent=tr(existing?'Edit group':'New group');$('chat-create-group').textContent=tr(existing?'Save changes':'Create group');
    for(const peer of discovery.peers)if(!engine.catalog.contacts.some(c=>c.deviceId===peer.deviceId))await api.collaboration('contact',{peer:{deviceId:peer.deviceId,name:peer.name},route:{type:'lan',address:peer.endpoints[0]}});
    await engine.refresh();
    const candidates=new Map([...engine.catalog.contacts,...engine.connected(),...(existing?.members||[])].filter(p=>p.deviceId!==self.deviceId).map(p=>[p.deviceId,p]));
    for (const peer of candidates.values()) { const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span'); input.type = 'checkbox'; input.value = peer.deviceId;input.checked=!!existing?.members.some(m=>m.deviceId===peer.deviceId);text.textContent=displayName(peer); label.append(input, text); list.append(label); }
    $('chat-group-dialog').showModal();
  };
  const photo=document.createElement('div');photo.className='chat-group-photo';photo.innerHTML='<img id="chat-group-avatar" class="profile-avatar" alt="">';photo.append(button('Choose photo',async()=>{const avatar=await api.groupPhoto(editingGroup?.id);if(avatar!==undefined){groupAvatar=avatar;$('chat-group-avatar').src=avatar||'assets/app-icon.png';}},'person'),button('Remove photo',()=>{groupAvatar='';$('chat-group-avatar').src='assets/app-icon.png';},'delete'));photo.append(button('Choose card background',async()=>{const image=await api.groupPhoto(editingGroup?.id,true);if(image!==undefined){groupBackground=image;window.actionNotice(tr('Card background selected'));}},'wallpaper'),button('Remove card background',()=>{groupBackground='';window.actionNotice(tr('Card background removed'));},'delete'));$('chat-group-form').prepend(photo);
  const description=document.createElement('label');description.textContent=tr('Group description');const descriptionInput=document.createElement('textarea');descriptionInput.id='chat-group-description';descriptionInput.maxLength=500;description.append(descriptionInput);$('chat-group-name').after(description);
  $('chat-new-group').onclick=run(()=>groupEditor());$('chat-edit-group').onclick=run(()=>groupEditor(engine.group(selected.slice(2))));
  $('chat-group-form').onsubmit = async event => { event.preventDefault(); $('chat-create-group').disabled = true; try { const group = await engine.createGroup($('chat-group-name').value.trim(), [...document.querySelectorAll('#chat-group-members input:checked')].map(i => i.value),editingGroup?.id,{avatar:groupAvatar,background:groupBackground,description:$('chat-group-description').value.trim()}); $('chat-group-dialog').close(); await select(`g:${group.id}`); } catch (e) { $('chat-group-error').textContent = tr(e.message); } finally { $('chat-create-group').disabled = false; } };
  function editMessage(row){
    let dialog=$('message-edit-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='message-edit-dialog';dialog.innerHTML='<form id="message-edit-form"><h2></h2><textarea id="message-edit-text" maxlength="8000" required></textarea><div class="inline-setting"><button type="submit" class="small-button"></button><button type="button" class="small-button"></button></div><p class="error" role="alert"></p></form>';document.body.append(dialog);}
    dialog.querySelector('h2').textContent=tr('Edit message');dialog.querySelector('[type=submit]').textContent=tr('Save changes');const cancel=dialog.querySelector('[type=button]');cancel.textContent=tr('Cancel');cancel.onclick=()=>dialog.close();dialog.querySelector('.error').textContent='';$('message-edit-text').value=row.text;
    $('message-edit-form').onsubmit=async event=>{event.preventDefault();const save=dialog.querySelector('[type=submit]');save.disabled=true;try{await engine.changeMessage(row.conversation,row.id,$('message-edit-text').value);dialog.close();await load(false);}catch(e){dialog.querySelector('.error').textContent=tr(e.message);}finally{save.disabled=false;}};dialog.showModal();$('message-edit-text').focus();
  }
  if(!detached)setInterval(()=>engine.reconnectKnown().catch(()=>{}),5000);
  if(!detached){setInterval(()=>engine.dispatchDue().catch(error),1000);engine.ready.then(()=>engine.dispatchDue()).catch(error);}
  engine.ready.then(async()=>{render();await reportView();if(!detached)engine.reconnectKnown().catch(()=>{});}).catch(error); api.discovery().then(renderDiscovery).catch(error);
  window.addEventListener('shatoot-language-change', () => { renderDiscovery(discovery); renderMessages(false);publish(); });
  return { engine, open, select, navigate, start, renderDiscovery, snapshot };
};
