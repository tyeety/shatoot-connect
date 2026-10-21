'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { ChatStore } = require('./chat-store.cjs');
const { Transfers } = require('./transfers.cjs');
const { UUID } = require('./discovery.cjs');
function installCollaboration({ ipcMain, state, app, safeStorage, dialog, shell, smoke, settings }) {
  function store(s) {
    if (!s.identity) throw new Error('The device is not initialized.');
    return s.chatStore ||= new ChatStore({ file: path.join(app.getPath('userData'), `chat-${s.identity.deviceId}.dat`), self: s.identity.deviceId,
      encrypt: text => { if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable.'); return safeStorage.encryptString(text); },
      decrypt: bytes => safeStorage.decryptString(bytes) });
  }
  function grant(s, id) { const value = s.chatGrants?.get(id); if (!value) throw new Error('Chat permission is required.'); return value; }
  ipcMain.handle('collaboration', async (event, op, value = {}) => {
    const s = state(event), history = store(s);
    if (op === 'list') return history.list();
    if (op === 'history') return history.history(value);
    if (op === 'pending') return history.pending(value.peer);
    if (op === 'contact') {
      const route = value.route;
      if (route && (typeof route !== 'object' || !['lan', 'id'].includes(route.type) || typeof route.address !== 'string' || route.address.length > 300 || (route.endpoint && (typeof route.endpoint !== 'string' || route.endpoint.length > 500)))) throw new Error('Invalid contact address.');
      return history.contact(value.peer, route);
    }
    if (op === 'group') return history.group(value);
    if (op === 'approve-group') {
      const g = grant(s, value.session), group = value.group;
      if (!UUID.test(group?.id) || group.owner !== g.peer.deviceId || typeof group.name !== 'string' || group.name.length > 60 || !Array.isArray(group.members) || group.members.length > 16 || group.members.some(m => !UUID.test(m.deviceId) || typeof m.name !== 'string' || m.name.length > 60)) throw new Error('Invalid group invitation.');
      if (s.chatPrompt) return false; s.chatPrompt = true;
      try { const fa = s.language === 'fa'; const result = smoke ? { response: 1 } : await dialog.showMessageBox(s.win, { type: 'question', title: 'Shatoot Connect', buttons: fa ? ['رد', 'پیوستن به گروه'] : ['Decline', 'Join group'], defaultId: 0, cancelId: 0,
        message: fa ? `پیوستن به گروه ${group.name}؟` : `Join ${group.name}?`, detail: `${g.peer.name}\n${group.members.map(m => m.name).join(', ')}` }); return result.response === 1; }
      finally { s.chatPrompt = false; }
    }
    if (op === 'append') return history.append(value.message, value.outgoing === true);
    if (op === 'delivered') { if (!UUID.test(value.id) || !UUID.test(value.peer)) throw new Error('Invalid receipt.'); return history.delivered(value.id, value.peer); }
    if (op === 'open-attachment') { const files = history.files(value.token); if (!fs.existsSync(files[0])) throw new Error('The received file was moved or deleted.'); shell.showItemInFolder(files[0]); return; }
    if (op === 'approve' || op === 'grant') {
      if (!UUID.test(value.session) || !UUID.test(value.peer?.deviceId) || typeof value.peer.name !== 'string' || value.peer.name.length > 60) throw new Error('Invalid chat request.');
      if (op === 'approve' && settings().requireChatApproval === true) {
        if (s.chatPrompt) return false;
        s.chatPrompt = true;
        try {
          const fa = s.language === 'fa';
          const result = smoke ? { response: 1 } : await dialog.showMessageBox(s.win, { type: 'question', title: 'Shatoot Connect', buttons: fa ? ['رد', 'پذیرش چت'] : ['Decline', 'Accept chat'], defaultId: 0, cancelId: 0,
            message: fa ? `${value.peer.name} درخواست گفت‌وگو دارد.` : `${value.peer.name} wants to chat.`,
            detail: fa ? 'این اجازه فقط برای چت است. هر دریافت فایل جداگانه تأیید می‌شود؛ دسترسی به صفحه، موس یا کیبورد داده نمی‌شود.' : 'Chat permission only. Each incoming file batch needs separate approval. This does not share your screen, mouse or keyboard.' });
          if (result.response !== 1) return false;
        } finally { s.chatPrompt = false; }
      }
      s.chatGrants ||= new Map();
      if (s.chatGrants.size >= 16 && !s.chatGrants.has(value.session)) throw new Error('Chat connection limit reached.');
      if (!s.chatGrants.has(value.session)) s.chatGrants.set(value.session, { peer: value.peer, send: new Transfers(path.join(app.getPath('downloads'), 'Shatoot Connect', 'Chat')), receive: new Transfers(path.join(app.getPath('downloads'), 'Shatoot Connect', 'Chat')) });
      return true;
    }
    if (op === 'end') {
      const g = s.chatGrants?.get(value.session); s.chatGrants?.delete(value.session);
      if (g) await Promise.allSettled([g.send.reset(), g.receive.reset()]); return;
    }
    throw new Error('Invalid chat operation.');
  });
  ipcMain.handle('collaboration-files', async (event, session, op, value) => {
    const s = state(event), g = grant(s, session), history = store(s);
    if (op === 'pick') { const picked = await dialog.showOpenDialog(s.win, { properties: ['openFile', 'multiSelections'] }); return picked.canceled ? [] : g.send.offer(picked.filePaths); }
    if (op === 'sources') return g.send.offer(value);
    if (op === 'received-sources') return g.send.offer(history.files(value));
    if (op === 'read') return g.send.read(value);
    if (op === 'begin') {
      if (!Array.isArray(value?.entries) || value.entries.length > 1000 || !value.message || value.message.kind !== 'file' || !UUID.test(value.message.id)) throw new Error('Invalid file offer.');
      if (g.receive.incoming || s.chatFilePrompt) throw new Error('Another incoming file offer is awaiting approval.');
      const conversation = value.message.conversation;
      if (conversation === `p:${g.peer.deviceId}`) { if (value.message.sender !== g.peer.deviceId) throw new Error('Invalid file sender.'); }
      else {
        const group = history.load().groups[String(conversation).slice(2)];
        if (!conversation?.startsWith('g:') || !group || !group.members.some(m => m.deviceId === value.message.sender) || (group.owner !== g.peer.deviceId && (group.owner !== s.identity.deviceId || value.message.sender !== g.peer.deviceId))) throw new Error('Invalid group file offer.');
      }
      s.chatFilePrompt = true;
      try {
        const count = value.entries.length, bytes = value.entries.reduce((total, file) => total + (Number.isSafeInteger(file.size) && file.size >= 0 ? file.size : 0), 0);
        if (bytes > 10 * 1024 ** 3) throw new Error('Transfer limit: 10 GB.');
        const fa = s.language === 'fa';
        const result = smoke || settings().autoAcceptFiles === true ? { response: 1 } : await dialog.showMessageBox(s.chatWindow || s.win, { type: 'question', title: 'Shatoot Connect', buttons: fa ? ['رد', 'دریافت فایل‌ها'] : ['Decline', 'Receive files'], defaultId: 0, cancelId: 0,
          message: fa ? `دریافت ${count} فایل از ${g.peer.name}؟` : `Receive ${count} files from ${g.peer.name}?`,
          detail: `${Math.ceil(bytes / 1024)} KB\n${value.entries.slice(0, 6).map(e => typeof e.name === 'string' ? e.name.slice(0, 150) : '').join('\n')}\nDownloads / Shatoot Connect / Chat` });
        if (result.response !== 1) throw new Error('File offer declined.');
        await g.receive.begin(value.entries); g.message = value.message; return true;
      } finally { s.chatFilePrompt = false; }
    }
    if (op === 'write') return g.receive.write(value);
    if (op === 'end-file') return g.receive.endFile(value);
    if (op === 'finish') {
      const files = await g.receive.finish(), message = g.message; g.message = null;
      const record = history.append(message).message;
      const attachment = history.attachment(record.conversation, record.id, files);
      return { count: files.length, attachment };
    }
    if (op === 'cancel') { g.message = null; await g.receive.abort(); return; }
    throw new Error('Invalid chat file operation.');
  });
  return { close: s => { for (const g of s.chatGrants?.values() || []) { g.send.reset().catch(() => {}); g.receive.reset().catch(() => {}); } s.chatGrants?.clear(); } };
}
module.exports = { installCollaboration };
