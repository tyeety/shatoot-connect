'use strict';
window.installMessenger = ({ api, self, internet, ensureInternet, remote, detached = false }) => {
  const $ = id => document.getElementById(id), tr = text => window.i18n.translate(text);
  let engine, selected = '', selectionVersion = 0, rows = [], searchTimer, busy = false, discovery = { peers: [], interfaces: [], errors: [] }, historyTimer;
  let editingGroup;
  const progress = new Map();
  const error = value => { $('chat-error').textContent = tr(value?.message || String(value)); };
  const run = fn => async event => { event?.preventDefault(); try { $('chat-error').textContent = ''; await fn(event); } catch (e) { error(e); } };
  function button(text, action, icon) { const b = document.createElement('button'); b.type = 'button'; b.className = icon ? 'icon-button' : 'small-button'; b.title = tr(text); b.setAttribute('aria-label', tr(text)); if (icon) { const i = document.createElement('span'); i.className = `mi ${icon}`; i.setAttribute('aria-hidden', 'true'); b.append(i); } else b.textContent = tr(text); b.onclick = run(action); return b; }
  function open() { if (!detached && !window.shatootconnectSmoke) { api.openChat(); return; } if (!$('messenger-dialog').open) $('messenger-dialog').showModal(); render(); }
  function contact(id) { return engine.catalog.contacts.find(c => c.deviceId === id); }
  function online(id) { return !!engine.peer(id); }
  function routeFor(id) { const nearby = discovery.peers.find(p => p.deviceId === id); if (nearby?.endpoints.length) return { type: 'lan', address: nearby.endpoints[0], deviceId: id, name: nearby.name }; const saved = contact(id); return saved?.route ? { ...saved.route, deviceId: id, name: saved.name } : null; }
  async function start(destination) {
    open(); $('chat-error').textContent = tr('Waiting for chat approval…');
    const s = await engine.connect(destination); $('chat-error').textContent = ''; await select(`p:${s.peer.deviceId}`); return s;
  }
  async function select(id) { selected = id; window.chatSelected = id; rows = []; selectionVersion++; $('chat-search').value = ''; render(); await load(false); publish(); }
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
      const name = document.createElement('header'); name.textContent = row.name;
      const text = document.createElement('p'); text.dir = 'auto'; text.textContent = row.text;
      const meta = document.createElement('small'); const date = new Date(row.at); meta.textContent = new Intl.DateTimeFormat(window.i18n.language === 'fa' ? 'fa-IR' : 'en', { dateStyle: 'short', timeStyle: 'short' }).format(date);
      if (own) meta.textContent += ' · ' + tr(row.pending.length ? (row.kind === 'file' ? 'Not delivered to all recipients' : 'Queued') : row.status === 'delivered' ? 'Delivered' : 'Sent');
      item.append(name, text, meta);
      if (row.attachment) item.append(button('Open received files', () => api.collaboration('open-attachment', { token: row.attachment }), 'folder'));
      log.append(item);
    }
    if (scroll && nearBottom) log.scrollTop = log.scrollHeight;
  }
  function render(refreshHistory = false) {
    if (!engine) return;
    const list = $('chat-conversations'); list.replaceChildren();
    const items = [...engine.catalog.contacts.map(c => ({ id: `p:${c.deviceId}`, avatar: c.avatar, name: c.name, detail: c.route?.address || c.deviceId.slice(0, 8), status: online(c.deviceId) ? c.status || 'available' : discovery.peers.some(p => p.deviceId === c.deviceId) ? 'On LAN' : 'Offline' })), ...engine.catalog.groups.map(g => ({ id: `g:${g.id}`, name: g.name, status: 'Group' }))];
    for (const item of items) { const b = document.createElement('button'); b.className = 'chat-conversation'; b.type = 'button'; b.setAttribute('aria-pressed', String(item.id === selected)); const name = document.createElement('b'), status = document.createElement('small'); name.textContent = item.name; status.textContent = tr(item.status) + (item.detail ? ' · ' + item.detail : ''); if (item.avatar) { const image = document.createElement('img'); image.src = item.avatar; image.className = 'profile-avatar'; image.alt = ''; b.append(image); } b.append(name, status); b.onclick = run(() => select(item.id)); list.append(b); }
    const group = selected.startsWith('g:') && engine.group(selected.slice(2)), peer = selected.startsWith('p:') && contact(selected.slice(2));
    $('chat-edit-group').hidden=!group||group.owner!==self.deviceId;
    $('chat-title').textContent = group?.name || peer?.name || tr('Select a conversation');
    $('chat-peer-status').textContent = group ? `${tr(group.owner === self.deviceId || online(group.owner) ? 'Group owner online' : 'Group owner offline')} · ${group.members.map(m => m.name).join(', ')}` : peer ? tr(online(peer.deviceId) ? 'Connected' : 'Offline') : '';
    $('chat-text').disabled = !selected; $('chat-send').disabled = !selected || busy; $('chat-send-files').disabled = !selected || busy;
    $('chat-reconnect').hidden = !peer || online(peer.deviceId); $('chat-disconnect').hidden = !peer || !online(peer.deviceId);
    $('chat-progress').textContent = selected && progress.get(selected) || '';
    if (refreshHistory && $('messenger-dialog').open && selected && rows.length <= 100) { clearTimeout(historyTimer); historyTimer = setTimeout(() => load(false).catch(error), 80); }
  }
  function renderDiscovery(value) {
    discovery = value;
    const list = $('network-list'); list.replaceChildren(); $('network-empty').hidden = value.peers.length > 0;
    $('discovery-status').textContent = `${value.peers.length} · ${tr('Nearby computers')} · ${value.interfaces.length} ${tr('network interfaces')}`;
    if (value.errors.length) { $('discovery-status').textContent += ' · ' + tr('Discovery is limited; check firewall or VPN LAN access.'); $('discovery-status').title = value.errors.join('\n'); }
    for (const peer of value.peers) {
      const card = document.createElement('div'); card.className = 'network-peer';
      if (peer.avatar) { const avatar = document.createElement('img'); avatar.className = 'profile-avatar'; avatar.src = peer.avatar; avatar.alt = ''; card.append(avatar); }
      const info = document.createElement('div'); info.className = 'network-peer-info'; const name = document.createElement('b'), address = document.createElement('small'); name.textContent = peer.name; address.textContent = tr(peer.status || 'available') + ' · ' + peer.endpoints.join(' / '); info.append(name, address);
      card.append(info, button('Start chat', () => start({ type: 'lan', address: peer.endpoints[0], deviceId: peer.deviceId, name: peer.name }), 'chat'), button('Connect to a computer', () => remote(peer.endpoints[0]), 'desktop_windows')); list.append(card);
    }
    render();publish();
  }
  function publish() { if (!detached && engine) api.chatPublish(snapshot()); }
  function snapshot() { return { self, catalog: engine.catalog, connected: engine.connected(), language: window.i18n.language, discovery, selected, progress: [...progress] }; }
  engine = new window.CollaborationClient({ api, self, internet, ensureInternet, changed: () => { render(true); publish(); }, error, progress: value => { const text = tr(value.text) + (Number.isInteger(value.percent) ? ` ${value.percent}%` : ''); progress.set(value.conversation, text); if (selected === value.conversation) $('chat-progress').textContent = text; publish(); } });
  if (!detached) api.onChatCommand(async (operation, args) => { if (operation === 'snapshot') return snapshot(); if (operation === 'close') { engine.close(engine.peer(args[0])); return; } const result = await engine[operation](...args); return operation === 'connect' ? { peer: result.peer } : result; });
  window.collaboration = engine;
  $('open-messenger').onclick = open;
  $('refresh-discovery').onclick = run(async () => renderDiscovery(await api.discovery()));
  api.onDiscovery(renderDiscovery);
  $('chat-connect-form').onsubmit = run(async () => { const address = $('chat-address').value.trim(); await start({ type: address.includes('.') || address.includes(':') ? 'lan' : 'id', address }); });
  $('chat-reconnect').onclick = run(async () => { const route = routeFor(selected.slice(2)); if (!route) throw new Error('Enter the contact ID or LAN IP to reconnect.'); await start(route); });
  $('chat-disconnect').onclick = run(() => engine.close(engine.peer(selected.slice(2))));
  $('chat-search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { rows = []; selectionVersion++; load(false).catch(error); }, 200); };
  $('chat-older').onclick = run(() => load(true));
  $('chat-compose').onsubmit = run(async () => { const text = $('chat-text').value; await engine.send(selected, text); $('chat-text').value = ''; await load(false); $('chat-messages').scrollTop = $('chat-messages').scrollHeight; });
  $('chat-text').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('chat-compose').requestSubmit(); } };
  async function files(operation = 'pick', value) { if (busy) throw new Error('A file transfer is already in progress.'); busy = true; render(); try { await engine.sendFiles(selected, operation, value); } finally { busy = false; render(); } }
  $('chat-send-files').onclick = run(() => files());
  $('messenger-dialog').ondragover = event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = selected ? 'copy' : 'none'; } };
  $('messenger-dialog').ondrop = run(async event => { if (!selected || !event.dataTransfer.files.length) return; await files('drop', [...event.dataTransfer.files]); });
  const groupEditor=async existing=>{
    editingGroup=existing;const list = $('chat-group-members'); list.replaceChildren(); $('chat-group-error').textContent = ''; $('chat-group-name').value = existing?.name||'';
    for(const peer of discovery.peers)if(!engine.catalog.contacts.some(c=>c.deviceId===peer.deviceId))await api.collaboration('contact',{peer:{deviceId:peer.deviceId,name:peer.name},route:{type:'lan',address:peer.endpoints[0]}});
    await engine.refresh();
    const candidates=new Map([...engine.catalog.contacts,...engine.connected(),...(existing?.members||[])].filter(p=>p.deviceId!==self.deviceId).map(p=>[p.deviceId,p]));
    for (const peer of candidates.values()) { const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span'); input.type = 'checkbox'; input.value = peer.deviceId;input.checked=!!existing?.members.some(m=>m.deviceId===peer.deviceId);text.textContent = peer.name; label.append(input, text); list.append(label); }
    $('chat-group-dialog').showModal();
  };
  $('chat-new-group').onclick=run(()=>groupEditor());$('chat-edit-group').onclick=run(()=>groupEditor(engine.group(selected.slice(2))));
  $('chat-group-form').onsubmit = async event => { event.preventDefault(); $('chat-create-group').disabled = true; try { const group = await engine.createGroup($('chat-group-name').value.trim(), [...document.querySelectorAll('#chat-group-members input:checked')].map(i => i.value),editingGroup?.id); $('chat-group-dialog').close(); await select(`g:${group.id}`); } catch (e) { $('chat-group-error').textContent = tr(e.message); } finally { $('chat-create-group').disabled = false; } };
  engine.ready.then(render).catch(error); api.discovery().then(renderDiscovery).catch(error);
  window.addEventListener('shatoot-language-change', () => { renderDiscovery(discovery); renderMessages(false);publish(); });
  return { engine, open, select, start, renderDiscovery, snapshot };
};
