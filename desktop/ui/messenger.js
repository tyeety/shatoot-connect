'use strict';
window.installMessenger = ({ api, self, internet, ensureInternet, remote, detached = false }) => {
  const $ = id => document.getElementById(id), tr = text => window.i18n.translate(text);
  let engine, selected = '', selectionVersion = 0, rows = [], searchTimer, busy = false, discovery = { peers: [], interfaces: [], errors: [] }, historyTimer;
  let voice;
  let editingGroup,groupAvatar='',connecting=false,connectSequence=0;
  const progress = new Map();
  const displayName=peer=>peer?.displayName||peer?.name||'';
  const previewCard=(element,peer)=>{element.classList.add('computer-preview');if(peer.preview){const image=document.createElement('img');image.className='desktop-preview';image.alt='';image.src=peer.preview;image.draggable=false;element.prepend(image);}};
  const own=document.createElement('button');own.id='chat-own-profile';own.type='button';own.className='small-button';own.onclick=()=>api.editProfile();document.querySelector('.chat-sidebar').prepend(own);

  const fileSetting=document.createElement('label');fileSetting.className='chat-file-setting';fileSetting.hidden=true;
  const fileCaption=document.createElement('span');fileCaption.textContent=tr('Incoming files');const filePolicy=document.createElement('select');filePolicy.id='chat-file-policy';filePolicy.setAttribute('aria-label',tr('Incoming files'));
  for(const[value,text]of [['inherit','Use global setting'],['accept','Receive automatically'],['ask','Ask before receiving files']]){const option=document.createElement('option');option.value=value;option.textContent=tr(text);filePolicy.append(option);}fileSetting.append(fileCaption,filePolicy);document.querySelector('.chat-thread-heading').after(fileSetting);
  function reportView(){return api.chatView({conversation:selected,active:!!selected&&$('messenger-dialog').open&&document.hasFocus()&&$('messenger-dialog').contains(document.activeElement)});}
  for(const event of ['focusin','focusout','visibilitychange'])document.addEventListener(event,()=>queueMicrotask(()=>reportView().catch(()=>{})));
  for(const event of ['focus','blur'])window.addEventListener(event,()=>reportView().catch(()=>{}));
  $('messenger-dialog').addEventListener('close',()=>reportView().catch(()=>{}));
  api.onChatFilesReceived(value=>{if(value.conversation!==selected||!$('messenger-dialog').open)return;const reading=document.hasFocus()&&$('messenger-dialog').contains(document.activeElement);if(reading&&$('chat-search').value){$('chat-search').value='';rows=[];selectionVersion++;}load(false).then(()=>{if(reading)$('chat-messages').scrollTop=$('chat-messages').scrollHeight;}).catch(error);});
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
  async function select(id) { if(id!==selected)voice?.reset();if(id.startsWith('p:')){const route=routeFor(id.slice(2));if(route&&!online(id.slice(2)))engine.connect(route).catch(()=>{});} selected = id; window.chatSelected = id; rows = []; selectionVersion++; $('chat-search').value = ''; render(); await reportView(); await load(false); publish(); }
  async function load(older = false) {
    if (!selected) return;
    const version = selectionVersion, id = selected, search = $('chat-search').value.trim();
    const result = await api.collaboration('history', { conversation: id, search, before: older && rows.length ? rows[0].receivedAt : Number.MAX_SAFE_INTEGER });
    if (version !== selectionVersion || selected !== id || search !== $('chat-search').value.trim()) return;
    rows = older ? [...result, ...rows] : result; $('chat-older').hidden = result.length < 100; renderMessages(!older);
  }
  function renderMessages(scroll) {
    const log = $('chat-messages'), nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.replaceChildren();
    for (const row of rows) {
      const item = document.createElement('article'); item.className = 'chat-message'; const own = row.sender === self.deviceId;
      if (own) item.classList.add('own'); if (own && row.pending.length) item.classList.add('pending');
      const name = document.createElement('header'); name.textContent=row.sender===self.deviceId?self.name:row.displayName||displayName(contact(row.sender))||row.name;
      const text = document.createElement('p'); text.dir = 'auto'; text.textContent = row.deleted?tr('Message deleted'):row.text;
      const meta = document.createElement('small'); const date = new Date(row.at); meta.textContent = new Intl.DateTimeFormat(window.i18n.language === 'fa' ? 'fa-IR' : 'en', { dateStyle: 'short', timeStyle: 'short' }).format(date);
      if (own) meta.textContent += ' · ' + tr(row.pending.length ? (row.kind === 'file' ? 'Not delivered to all recipients' : 'Queued') : row.status === 'delivered' ? 'Delivered' : 'Sent');
      if(row.editedAt&&!row.deleted)meta.textContent+=' · '+tr('Edited');
      item.append(name, text, meta);
      if(row.deleted)item.classList.add('deleted');
      else {
        if (row.attachment) item.append(button(own?'Open sent files':'Open received files', () => api.collaboration('open-attachment', { token: row.attachment }), 'folder'));
        voice?.attachment(item,row);
        const actions=document.createElement('div');actions.className='chat-message-actions';
        actions.append(button('Copy',()=>api.copyText(row.text),'content_copy'));
        if(own){if(row.kind==='text')actions.append(button('Edit message',()=>editMessage(row),'edit'));actions.append(button('Delete message',async()=>{await engine.changeMessage(row.conversation,row.id,'',true);await load(false);},'delete'));}
        item.append(actions);
      }
      log.append(item);
    }
    if (scroll && nearBottom) log.scrollTop = log.scrollHeight;
  }
  function render(refreshHistory = false) {
    if (!engine) return;
    const pending=connecting||(engine.connectAttempts?[...engine.connectAttempts].filter(a=>!a.background).length:engine.pendingConnections||0)>0;cancelConnect.hidden=!pending;$('chat-connect').disabled=pending;$('chat-address').disabled=pending;
    own.replaceChildren();const ownImage=document.createElement('img');ownImage.src=self.avatar||'assets/app-icon.png';ownImage.className='profile-avatar';ownImage.alt='';const ownName=document.createElement('span');ownName.textContent=self.name;own.append(ownImage,ownName);
    const list = $('chat-conversations'); list.replaceChildren();
    const items = [...engine.catalog.contacts.map(c => ({ id: `p:${c.deviceId}`, avatar:c.avatar,preview:c.preview,name:displayName(c),detail: c.route?.address || c.deviceId.slice(0, 8), status: online(c.deviceId) ? c.status || 'available' : discovery.peers.some(p => p.deviceId === c.deviceId) ? 'On LAN' : 'Offline' })), ...engine.catalog.groups.map(g => ({ id: `g:${g.id}`, avatar:g.avatar,name: g.name,detail:g.description, status: 'Group' }))];
    for (const item of items) { const b = document.createElement('button'); b.className = 'chat-conversation'; b.type = 'button'; b.setAttribute('aria-pressed', String(item.id === selected)); const name = document.createElement('b'), status = document.createElement('small'); name.textContent = item.name; status.textContent = tr(item.status) + (item.detail ? ' · ' + item.detail : ''); { const image = document.createElement('img'); image.src=item.avatar||'assets/app-icon.png'; image.className = 'profile-avatar'; image.alt = ''; b.append(image); } b.append(name,status);previewCard(b,item); b.onclick = run(() => select(item.id)); list.append(b); }
    const group = selected.startsWith('g:') && engine.group(selected.slice(2)), peer = selected.startsWith('p:') && contact(selected.slice(2));
    if($('chat-rename'))$('chat-rename').hidden=!selected.startsWith('p:');
    $('chat-edit-group').hidden=!group||group.owner!==self.deviceId;
    $('chat-title').textContent = group?.name || displayName(peer) || tr('Select a conversation');
    $('chat-peer-status').textContent = group ? `${tr(group.owner === self.deviceId || online(group.owner) ? 'Group owner online' : 'Group owner offline')} · ${group.members.map(m => displayName(contact(m.deviceId))||displayName(m)).join(', ')}` : peer ? tr(online(peer.deviceId) ? 'Connected' : 'Offline') : '';
    $('chat-text').disabled = !selected; $('chat-send').disabled = !selected || busy; $('chat-send-files').disabled = !selected || busy;
    voice?.sync();$('chat-reconnect').hidden = true; $('chat-disconnect').hidden = !peer || !online(peer.deviceId);
    $('chat-progress').textContent = selected && progress.get(selected) || '';
    fileSetting.hidden=!selected;filePolicy.value=engine.catalog.filePolicies?.[selected]||'inherit';
    if (refreshHistory && $('messenger-dialog').open && selected && rows.length <= 100) { clearTimeout(historyTimer); historyTimer = setTimeout(() => load(false).catch(error), 80); }
  }
  function renderDiscovery(value) {
    discovery = value;if(!detached){engine.nearby=value.peers;engine.reconnectKnown().catch(()=>{});}
    const list = $('network-list'); list.replaceChildren(); $('network-empty').hidden = value.peers.length > 0;
    $('discovery-status').textContent = `${value.peers.length} · ${tr('Nearby computers')} · ${value.interfaces.length} ${tr('network interfaces')}`;
    if (value.errors.length) { $('discovery-status').textContent += ' · ' + tr('Discovery is limited; check firewall or VPN LAN access.'); $('discovery-status').title = value.errors.join('\n'); }
    for (const peer of value.peers) {
      const card = document.createElement('div'); card.className = 'network-peer';
      if (peer.avatar) { const avatar = document.createElement('img'); avatar.className = 'profile-avatar'; avatar.src = peer.avatar; avatar.alt = ''; card.append(avatar); }
      const info = document.createElement('div'); info.className = 'network-peer-info'; const name = document.createElement('b'), address = document.createElement('small'); name.textContent=displayName(peer); address.textContent = tr(peer.status || 'available') + ' · ' + peer.endpoints.join(' / '); info.append(name, address);
      previewCard(card,peer);card.append(info, button('Start chat', () => start({ type: 'lan', address: peer.endpoints[0], deviceId: peer.deviceId, name: peer.name }), 'chat'), button('Connect to a computer', () => remote(peer.endpoints[0]), 'desktop_windows')); list.append(card);
    }
    render();publish();
  }
  function publish() { if (!detached && engine) api.chatPublish(snapshot()); }
  function snapshot() { return { self, pendingConnections:engine.connectAttempts?[...engine.connectAttempts].filter(a=>!a.background).length:0,catalog: engine.catalog, connected: engine.connected(), language: window.i18n.language, discovery, selected, progress: [...progress] }; }
  engine = new window.CollaborationClient({ api, self, internet, ensureInternet, changed: () => { render(true); publish(); }, error, progress: value => { const text = tr(value.text) + (Number.isInteger(value.percent) ? ` ${value.percent}%` : ''); progress.set(value.conversation, text); if (selected === value.conversation) $('chat-progress').textContent = text; publish(); } });
  if (!detached) api.onChatCommand(async (operation, args) => { if (operation === 'snapshot') return snapshot(); if (operation === 'close') { engine.close(engine.peer(args[0])); return; } const result = await engine[operation](...args); return operation === 'connect' ? { peer: result.peer } : result; });
  window.collaboration = engine;
  $('open-messenger').onclick = open;
  $('refresh-discovery').onclick = run(async () => {renderDiscovery(await api.discovery());window.refreshFeedback($('network-list'));});
  api.onDiscovery(renderDiscovery);
  $('chat-connect-form').onsubmit = run(async () => { const address = $('chat-address').value.trim(); await start({ type: address.includes('.') || address.includes(':') ? 'lan' : 'id', address }); });
  $('chat-reconnect').onclick = run(async () => { const route = routeFor(selected.slice(2)); if (!route) throw new Error('Enter the contact ID or LAN IP to reconnect.'); await start(route); });
  $('chat-disconnect').onclick = run(() => engine.close(engine.peer(selected.slice(2))));
  $('chat-search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { rows = []; selectionVersion++; load(false).catch(error); }, 200); };
  $('chat-older').onclick = run(() => load(true));
  $('chat-compose').onsubmit = run(async () => { const text = $('chat-text').value; await engine.send(selected, text); $('chat-text').value = ''; await load(false); $('chat-messages').scrollTop = $('chat-messages').scrollHeight; });
  $('chat-text').addEventListener('paste',async event=>{try{
    const image=[...(event.clipboardData?.items||[])].find(item=>item.kind==='file'&&item.type.startsWith('image/'));
    if(!image||!selected)return;event.preventDefault();const file=image.getAsFile();if(!file)return;
    if(file.size>10*1024**2)throw new Error('Clipboard image is too large.');
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Invalid clipboard image.'));reader.readAsDataURL(file);});
    await files('clipboard-image',data);
  }catch(e){error(e);}});
  $('chat-text').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('chat-compose').requestSubmit(); } };
  async function files(operation = 'pick', value) { if (busy) throw new Error('A file transfer is already in progress.'); busy = true; render(); try { await engine.sendFiles(selected, operation, value); } finally { busy = false; render(); } }
  voice=window.installVoiceMessages({api,conversation:()=>selected,available:()=>!!selected&&!busy,send:(conversation,data)=>engine.sendFiles(conversation,'voice',data),error});
  $('chat-send-files').onclick = run(() => files());
  $('messenger-dialog').ondragover = event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = selected ? 'copy' : 'none'; } };
  $('messenger-dialog').ondrop = run(async event => { if (!selected || !event.dataTransfer.files.length) return; await files('drop', [...event.dataTransfer.files]); });
  const rename=button('Rename saved computer',async()=>{
    const peer=contact(selected.slice(2));if(!peer)return;
    let dialog=$('chat-name-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='chat-name-dialog';dialog.innerHTML='<form id="chat-name-form"><h2>Rename saved computer</h2><label for="chat-local-name">Computer nickname</label><input id="chat-local-name" maxlength="60"><div class="inline-setting"><button type="submit" class="small-button">Save</button><button type="button" id="chat-name-cancel" class="small-button">Cancel</button></div><p id="chat-name-error" class="error"></p></form>';document.body.append(dialog);}
    $('chat-local-name').value=peer.displayName||peer.name;dialog.showModal();$('chat-local-name').focus();$('chat-local-name').select();$('chat-name-cancel').onclick=()=>dialog.close();
    $('chat-name-form').onsubmit=async event=>{event.preventDefault();try{await api.computerCard('rename',{peer:{...peer,...peer.route},name:$('chat-local-name').value});await engine.refresh();dialog.close();render(true);}catch(e){$('chat-name-error').textContent=e.message;}};
  },'person');rename.id='chat-rename';document.querySelector('.chat-thread-heading').append(rename);
  const groupEditor=async existing=>{
    editingGroup=existing;const list = $('chat-group-members'); list.replaceChildren(); $('chat-group-error').textContent = ''; $('chat-group-name').value = existing?.name||'';
    groupAvatar=existing?.avatar||'';$('chat-group-avatar').src=groupAvatar||'assets/app-icon.png';$('chat-group-description').value=existing?.description||'';
    document.querySelector('#chat-group-dialog h2').textContent=tr(existing?'Edit group':'New group');$('chat-create-group').textContent=tr(existing?'Save changes':'Create group');
    for(const peer of discovery.peers)if(!engine.catalog.contacts.some(c=>c.deviceId===peer.deviceId))await api.collaboration('contact',{peer:{deviceId:peer.deviceId,name:peer.name},route:{type:'lan',address:peer.endpoints[0]}});
    await engine.refresh();
    const candidates=new Map([...engine.catalog.contacts,...engine.connected(),...(existing?.members||[])].filter(p=>p.deviceId!==self.deviceId).map(p=>[p.deviceId,p]));
    for (const peer of candidates.values()) { const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span'); input.type = 'checkbox'; input.value = peer.deviceId;input.checked=!!existing?.members.some(m=>m.deviceId===peer.deviceId);text.textContent=displayName(peer); label.append(input, text); list.append(label); }
    $('chat-group-dialog').showModal();
  };
  const photo=document.createElement('div');photo.className='chat-group-photo';photo.innerHTML='<img id="chat-group-avatar" class="profile-avatar" alt="">';photo.append(button('Choose photo',async()=>{const avatar=await api.groupPhoto(editingGroup?.id);if(avatar!==undefined){groupAvatar=avatar;$('chat-group-avatar').src=avatar||'assets/app-icon.png';}},'person'),button('Remove photo',()=>{groupAvatar='';$('chat-group-avatar').src='assets/app-icon.png';},'delete'));$('chat-group-form').prepend(photo);
  const description=document.createElement('label');description.textContent=tr('Group description');const descriptionInput=document.createElement('textarea');descriptionInput.id='chat-group-description';descriptionInput.maxLength=500;description.append(descriptionInput);$('chat-group-name').after(description);
  $('chat-new-group').onclick=run(()=>groupEditor());$('chat-edit-group').onclick=run(()=>groupEditor(engine.group(selected.slice(2))));
  $('chat-group-form').onsubmit = async event => { event.preventDefault(); $('chat-create-group').disabled = true; try { const group = await engine.createGroup($('chat-group-name').value.trim(), [...document.querySelectorAll('#chat-group-members input:checked')].map(i => i.value),editingGroup?.id,{avatar:groupAvatar,description:$('chat-group-description').value.trim()}); $('chat-group-dialog').close(); await select(`g:${group.id}`); } catch (e) { $('chat-group-error').textContent = tr(e.message); } finally { $('chat-create-group').disabled = false; } };
  function editMessage(row){
    let dialog=$('message-edit-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='message-edit-dialog';dialog.innerHTML='<form id="message-edit-form"><h2></h2><textarea id="message-edit-text" maxlength="8000" required></textarea><div class="inline-setting"><button type="submit" class="small-button"></button><button type="button" class="small-button"></button></div><p class="error" role="alert"></p></form>';document.body.append(dialog);}
    dialog.querySelector('h2').textContent=tr('Edit message');dialog.querySelector('[type=submit]').textContent=tr('Save changes');const cancel=dialog.querySelector('[type=button]');cancel.textContent=tr('Cancel');cancel.onclick=()=>dialog.close();dialog.querySelector('.error').textContent='';$('message-edit-text').value=row.text;
    $('message-edit-form').onsubmit=async event=>{event.preventDefault();const save=dialog.querySelector('[type=submit]');save.disabled=true;try{await engine.changeMessage(row.conversation,row.id,$('message-edit-text').value);dialog.close();await load(false);}catch(e){dialog.querySelector('.error').textContent=tr(e.message);}finally{save.disabled=false;}};dialog.showModal();$('message-edit-text').focus();
  }
  if(!detached)setInterval(()=>engine.reconnectKnown().catch(()=>{}),15000);
  engine.ready.then(()=>{render();if(!detached)engine.reconnectKnown().catch(()=>{});}).catch(error); api.discovery().then(renderDiscovery).catch(error);
  window.addEventListener('shatoot-language-change', () => { renderDiscovery(discovery); renderMessages(false);publish(); });
  return { engine, open, select, start, renderDiscovery, snapshot };
};
