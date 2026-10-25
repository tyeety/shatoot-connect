'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { UUID } = require('./discovery.cjs');
const LIMIT = 32 * 1024 * 1024;
class ChatStore {
  constructor({ file, encrypt, decrypt, self }) { Object.assign(this, { file, encrypt, decrypt, self }); this.data = null; }
  load() {
    if (this.data) return this.data;
    let bytes;
    try { bytes = fs.readFileSync(this.file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // An interrupted first save can leave a complete encrypted temporary file.
      try { bytes = fs.readFileSync(this.file + '.tmp'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (!bytes) return this.data = { version: 1, contacts: {}, groups: {}, messages: [], attachments: {} };
    }
    try {
      if (bytes.length > LIMIT + 65536) throw new Error();
      const data = JSON.parse(this.decrypt(bytes));
      if (data.version !== 1 || !data.contacts || !data.groups || !data.attachments || !Array.isArray(data.messages)) throw new Error();
      for(const message of [...data.messages])if(message.deleted)this.eraseMessage(data,message.conversation,message.id);
      return this.data = data;
    } catch { throw new Error('Chat history cannot be read. The existing history file has been kept.'); }
  }
  save() {
    const text = JSON.stringify(this.data);
    if (Buffer.byteLength(text) > LIMIT || this.data.messages.length > 50000) throw new Error('Chat history storage is full. Existing history has been kept.');
    const bytes = this.encrypt(text); fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.tmp'; let fd;
    try { fd = fs.openSync(temp, 'w', 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; fs.renameSync(temp, this.file); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  change(fn) {
    const previous = structuredClone(this.load());
    try { const result = fn(this.data); this.save(); return result; } catch (error) { this.data = previous; throw error; }
  }
  contact(peer, route) {
    if (!peer || !UUID.test(peer.deviceId) || typeof peer.name !== 'string' || peer.name.length > 60 || peer.deviceId === this.self) throw new Error('Invalid chat contact.');
    return this.change(data => data.contacts[peer.deviceId] = { ...data.contacts[peer.deviceId], ...require('../shared/profile.cjs').profile(peer), deviceId: peer.deviceId, name: peer.name, route: route || data.contacts[peer.deviceId]?.route || null });
  }
  group(value) {
    if (!value || !UUID.test(value.id) || !UUID.test(value.owner) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 60 || !Array.isArray(value.members) || value.members.length < 1) throw new Error('Invalid chat group.');
    const members = value.members.map(m => { if (!UUID.test(m.deviceId) || typeof m.name !== 'string' || m.name.length > 60) throw new Error('Invalid group member.'); return { deviceId: m.deviceId, name: m.name }; });
    if (new Set(members.map(m => m.deviceId)).size !== members.length || !members.some(m => m.deviceId === this.self) || !members.some(m => m.deviceId === value.owner)) throw new Error('Invalid group membership.');
    if(value.description!==undefined&&(typeof value.description!=='string'||value.description.length>500))throw new Error('Group description is too long.');
    return this.change(data => { const old=data.groups[value.id];if(old&&old.owner!==value.owner)throw new Error('The group owner cannot change.');if(old&&(old.revision||0)>(value.revision||0))return old;return data.groups[value.id] = { id: value.id, name: value.name.trim(), owner: value.owner, members,description:value.description||'',avatar:require('../shared/profile.cjs').profile(value).avatar,revision:Number.isSafeInteger(value.revision)&&value.revision>=0?value.revision:0 }; });
  }
  append(value, outgoing = false) {
    const data = this.load();
    if (!value || !UUID.test(value.id) || !UUID.test(value.sender) || !/^[pg]:[a-f0-9-]{36}$/i.test(value.conversation) || typeof value.name !== 'string' || value.name.length > 60 || !['text', 'file'].includes(value.kind) || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 8000 || (outgoing && value.sender !== this.self)) throw new Error('Invalid chat message.');
    const key = value.conversation.slice(2);
    if ((value.conversation.startsWith('p:') && !data.contacts[key]) || (value.conversation.startsWith('g:') && !data.groups[key])) throw new Error('Unknown conversation.');
    const existing = data.messages.find(m => m.id === value.id && m.conversation === value.conversation); if (existing) return { message: existing, duplicate: true };
    const relay = value.conversation.startsWith('g:') && data.groups[key]?.owner === this.self;
    const pending = outgoing || relay ? [...new Set((value.pending || []).filter(id => UUID.test(id) && id !== this.self && (!relay || data.groups[key].members.some(m => m.deviceId === id))))] : [];
    const message = { id: value.id, conversation: value.conversation, sender: value.sender, name: value.name, kind: value.kind, text: value.text, at: Number.isSafeInteger(value.at) && Math.abs(Date.now() - value.at) < 365 * 86400000 ? value.at : Date.now(), receivedAt: Math.max(Date.now(), (data.messages.at(-1)?.receivedAt || 0) + 1), status: outgoing ? (pending.length ? 'queued' : 'sent') : 'received', pending };
    return this.change(d => { const change=(d.mutations||[]).find(c=>c.message===message.id&&c.conversation===message.conversation&&c.sender===message.sender);if(change&&(change.removed||message.kind==='text'))this.applyMutation(message,change);if(!message.deleted)d.messages.push(message); return { message, duplicate: false }; });
  }
  eraseMessage(data,conversation,id){data.messages=data.messages.filter(m=>m.conversation!==conversation||m.id!==id);for(const [token,attachment]of Object.entries(data.attachments))if(attachment.conversation===conversation&&attachment.message===id)delete data.attachments[token];}
  applyMutation(message,change){message.revision=change.revision;message.editedAt=change.at;message.deleted=change.removed;message.text=change.removed?'':change.text;}
  mutate(value,outgoing=false){
    const data=this.load();if(!value||!UUID.test(value.id)||!UUID.test(value.message)||!UUID.test(value.sender)||!/^([pg]):[a-f0-9-]{36}$/i.test(value.conversation)||typeof value.removed!=='boolean'||!Number.isSafeInteger(value.revision)||value.revision<1||value.revision>1000000000||(!value.removed&&(typeof value.text!=='string'||!value.text.trim()||value.text.length>8000))||(outgoing&&value.sender!==this.self))throw new Error('Invalid message change.');
    const key=value.conversation.slice(2),group=value.conversation.startsWith('g:')&&data.groups[key];
    if(group?!group.members.some(m=>m.deviceId===value.sender):!data.contacts[key]||(!outgoing&&key!==value.sender))throw new Error('Invalid message author.');
    const message=data.messages.find(m=>m.id===value.message&&m.conversation===value.conversation),previous=(data.mutations||[]).find(c=>c.message===value.message&&c.conversation===value.conversation);
    if((previous&&previous.sender!==value.sender)||((message?.deleted||previous?.removed)&&!value.removed))throw new Error('This message cannot be changed.');
    if((outgoing&&!message)||(message&&(message.sender!==value.sender||(!value.removed&&message.kind!=='text'))))throw new Error('Only the sender can change this message.');
    if((message?.revision||previous?.revision||0)>=value.revision)return {duplicate:true,mutation:previous};
    const pending=outgoing||group?.owner===this.self?[...new Set((value.pending||[]).filter(id=>UUID.test(id)&&id!==this.self&&(!group||group.members.some(m=>m.deviceId===id))))]:[];
    const mutation={id:value.id,message:value.message,conversation:value.conversation,sender:value.sender,removed:value.removed,text:value.removed?'':value.text.trim(),revision:value.revision,at:Number.isSafeInteger(value.at)?value.at:Date.now(),pending};
    return this.change(d=>{d.mutations=(d.mutations||[]).filter(c=>c.message!==value.message||c.conversation!==value.conversation);d.mutations.push(mutation);if(mutation.removed)this.eraseMessage(d,mutation.conversation,mutation.message);else if(message)this.applyMutation(message,mutation);return {duplicate:false,mutation};});
  }
  pendingChanges(peer){return (this.load().mutations||[]).filter(m=>m.pending.includes(peer));}
  deliveredChange(id,peer){return this.change(d=>{const change=(d.mutations||[]).find(c=>c.id===id);if(change)change.pending=change.pending.filter(p=>p!==peer);});}
  delivered(id, peer) {
    return this.change(data => { const message = data.messages.find(m => m.id === id && (m.sender === this.self || (m.conversation.startsWith('g:') && data.groups[m.conversation.slice(2)]?.owner === this.self))); if (message) { message.pending = message.pending.filter(value => value !== peer); if (message.sender === this.self) message.status = message.pending.length ? 'queued' : 'delivered'; } return message; });
  }
  attachment(conversation, message, files) {
    if (!Array.isArray(files) || !files.length || files.some(file => typeof file !== 'string') || !this.load().messages.some(m => m.id === message && m.conversation === conversation && m.kind === 'file')) throw new Error('Invalid received attachment.');
    return this.change(data => { const token = crypto.randomUUID(); data.attachments[token] = { conversation, message, files }; return token; });
  }
  list() {
    const data = this.load(); return { filePolicies: {...data.filePolicies}, contacts: Object.values(data.contacts), groups: Object.values(data.groups), conversations: [...new Set(data.messages.map(m => m.conversation))].map(id => ({ id, last: data.messages.filter(m => !m.deleted && m.conversation === id).at(-1) })) };
  }
  filePolicy(conversation, mode) {
    const data=this.load();
    if(typeof conversation!=='string'||!/^([pg]):[a-f0-9-]{36}$/i.test(conversation)||!(conversation.startsWith('p:')?data.contacts[conversation.slice(2)]:data.groups[conversation.slice(2)]))throw new Error('Unknown conversation.');
    if(mode===undefined)return data.filePolicies?.[conversation]||'inherit';
    if(!['inherit','ask','accept'].includes(mode))throw new Error('Invalid file reception setting.');
    return this.change(next=>{next.filePolicies||={};if(mode==='inherit')delete next.filePolicies[conversation];else next.filePolicies[conversation]=mode;return mode;});
  }
  history({ conversation, before = Number.MAX_SAFE_INTEGER, search = '', limit = 100 } = {}) {
    if (typeof conversation !== 'string' || typeof search !== 'string' || search.length > 200 || !Number.isSafeInteger(before)) throw new Error('Invalid history query.');
    return this.load().messages.filter(m => !m.deleted && m.conversation === conversation && m.receivedAt < before && (!search || m.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()))).slice(-Math.max(1, Math.min(100, Number(limit) || 100))).map(m => ({ ...m,pending:[...new Set([...m.pending,...(this.data.mutations||[]).filter(c=>c.message===m.id&&c.conversation===conversation).flatMap(c=>c.pending)])],attachment:m.deleted?undefined:Object.entries(this.data.attachments).find(([, a]) => a.message === m.id && a.conversation === conversation)?.[0] }));
  }
  pending(peer) { return this.load().messages.filter(m => !m.deleted && m.pending.includes(peer)); }
  files(token) { const attachment = this.load().attachments[token]; if (!attachment || !this.load().messages.some(m=>m.id===attachment.message&&m.conversation===attachment.conversation&&!m.deleted)) throw new Error('This attachment is unavailable.'); return attachment.files; }
}
module.exports = { ChatStore };
