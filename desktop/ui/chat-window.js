'use strict';
(async () => {
  document.body.classList.add('chat-window');
  const api = window.shatootconnect, initial = await api.chatCall('snapshot');
  let changed;
  class ChatWindowClient {
    constructor(options) { this.options = options; this.catalog = initial.catalog; this.online = initial.connected; this.ready = Promise.resolve(); changed = snapshot => { this.catalog = snapshot.catalog; this.online = snapshot.connected; Object.assign(initial.self, snapshot.self); if (window.i18n.language !== snapshot.language) window.i18n.setLanguage(snapshot.language); for (const [conversation, text] of snapshot.progress) { if (conversation === window.chatSelected) document.getElementById('chat-progress').textContent = text; } options.changed(); }; }
    peer(id) { const peer = this.online.find(p => p.deviceId === id); return peer && { peer }; }
    connected() { return this.online; }
    group(id) { return this.catalog.groups.find(g => g.id === id); }
    connect(destination) { return api.chatCall('connect', [destination]); }
    send(conversation, text) { return api.chatCall('send', [conversation, text]); }
    sendFiles(conversation, operation, value) { return operation === 'drop' ? api.chatDrop(conversation, value) : api.chatCall('sendFiles', [conversation, operation, value]); }
    close(session) { return api.chatCall('close', [session?.peer.deviceId]); }
    createGroup(name, members) { return api.chatCall('createGroup', [name, members]); }
  }
  window.CollaborationClient = ChatWindowClient;
  window.i18n.setLanguage(initial.language);
  const messenger = window.messenger = window.installMessenger({ api, self: initial.self, detached: true, remote: () => api.showMain() });
  api.onChatSnapshot(snapshot => { changed?.(snapshot); messenger.renderDiscovery(snapshot.discovery); if (snapshot.selected && snapshot.selected !== initial.selected) { initial.selected = snapshot.selected; messenger.select(snapshot.selected); } });
  messenger.renderDiscovery(initial.discovery); messenger.open();
  if (initial.selected) await messenger.select(initial.selected);
  const heading = document.querySelector('#messenger-dialog .settings-heading');
  const show = document.createElement('button'); show.type = 'button'; show.className = 'small-button'; show.textContent = window.i18n.translate('Show main window'); show.onclick = () => api.showMain(); heading.prepend(show);
  document.getElementById('messenger-dialog').addEventListener('close', () => api.closeChat());
  window.shatootconnectChatReady = true;
})().catch(error => { document.body.textContent = error.message; });
