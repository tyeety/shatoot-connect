'use strict';
(async () => {
  document.body.classList.add('chat-window');
  const updateTitle=()=>{document.title=window.i18n.language==='fa'?'گفتگوها · Shatoot Connect':'Chats · Shatoot Connect';};
  window.addEventListener('shatoot-language-change',updateTitle);updateTitle();
  const icon=document.createElement('link');icon.rel='icon';icon.href='assets/chat-icon.png';document.head.append(icon);
  const api = window.shatootconnect, initial = await api.chatCall('snapshot');
  let changed;
  class ChatWindowClient {
    constructor(options) { this.options = options; this.catalog = initial.catalog;this.pendingConnections=initial.pendingConnections||0; this.online = initial.connected; this.ready = Promise.resolve(); changed = snapshot => { this.catalog = snapshot.catalog;this.pendingConnections=snapshot.pendingConnections||0; this.online = snapshot.connected; Object.assign(initial.self, snapshot.self); if (window.i18n.language !== snapshot.language) window.i18n.setLanguage(snapshot.language); for (const [conversation, text] of snapshot.progress) { if (conversation === window.chatSelected) document.getElementById('chat-progress').textContent = text; } options.changed(); }; }
    peer(id) { const peer = this.online.find(p => p.deviceId === id); return peer && { peer }; }
    connected() { return this.online; }
    group(id) { return this.catalog.groups.find(g => g.id === id); }
    async refresh(){await api.chatCall('refresh');const snapshot=await api.chatCall('snapshot');changed(snapshot);}
    connect(destination) { return api.chatCall('connect', [destination]); }
    cancelPending(){return api.chatCall('cancelPending');}
    send(conversation, text) { return api.chatCall('send', [conversation, text]); }
    sendFiles(conversation, operation, value) { return operation === 'drop' ? api.chatDrop(conversation, value) : api.chatCall('sendFiles', [conversation, operation, value]); }
    close(session) { return api.chatCall('close', [session?.peer.deviceId]); }
    createGroup(name,members,id,details){return api.chatCall('createGroup',[name,members,id,details]);}
    changeMessage(conversation,id,text,removed){return api.chatCall('changeMessage',[conversation,id,text,removed]);}
  }
  window.CollaborationClient = ChatWindowClient;
  window.i18n.setLanguage(initial.language);
  const messenger = window.messenger = window.installMessenger({ api, self: initial.self, detached: true, remote: () => api.showMain() });
  api.onChatSnapshot(snapshot => { changed?.(snapshot); messenger.renderDiscovery(snapshot.discovery); if (snapshot.selected && snapshot.selected !== initial.selected) { initial.selected = snapshot.selected; messenger.select(snapshot.selected); } });
  messenger.renderDiscovery(initial.discovery); messenger.open();
  if (initial.selected) await messenger.select(initial.selected);
  document.getElementById('messenger-dialog').addEventListener('close', () => api.closeChat());
  const navigate=async()=>{const target=await api.pendingChatTarget();if(target)await messenger.navigate(target);};api.onChatTarget(()=>navigate().catch(error=>window.actionNotice(error.message)));await navigate();
  window.shatootconnectChatReady = true;
})().catch(error => { document.body.textContent = error.message; });
