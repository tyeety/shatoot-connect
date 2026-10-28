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
      if (!bytes) return this.data = { version: 1, contacts: {}, groups: {}, messages: [], attachments: {},readAt:{},pins:{} };
    }
    try {
      if (bytes.length > LIMIT + 65536) throw new Error();
      const data = JSON.parse(this.decrypt(bytes));
      if (data.version !== 1 || !data.contacts || !data.groups || !data.attachments || !Array.isArray(data.messages)) throw new Error();
      if(!data.readAt){data.readAt={};for(const message of data.messages)data.readAt[message.conversation]=Math.max(data.readAt[message.conversation]||0,message.receivedAt||0);}
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
    return this.change(data => { const old=data.groups[value.id];if(old&&old.owner!==value.owner)throw new Error('The group owner cannot change.');if(old&&(old.revision||0)>(value.revision||0))return old;return data.groups[value.id] = { id: value.id, name: value.name.trim(), owner: value.owner, members,description:value.description||'',avatar:require('../shared/profile.cjs').profile(value).avatar,background:typeof value.background==='string'&&value.background.length<=300000&&/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(value.background)?value.background:'',revision:Number.isSafeInteger(value.revision)&&value.revision>=0?value.revision:0 }; });
  }
  append(value, outgoing = false) {
    const data = this.load();
    if(!outgoing&&this.isBlocked(value?.sender))throw new Error('Contact is blocked.');
    if (!value || !UUID.test(value.id) || !UUID.test(value.sender) || !/^[pg]:[a-f0-9-]{36}$/i.test(value.conversation) || typeof value.name !== 'string' || value.name.length > 60 || !['text', 'file'].includes(value.kind) || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 8000 || (outgoing && value.sender !== this.self)) throw new Error('Invalid chat message.');
    const key = value.conversation.slice(2);
    if ((value.conversation.startsWith('p:') && !data.contacts[key]) || (value.conversation.startsWith('g:') && !data.groups[key])) throw new Error('Unknown conversation.');
    const existing = data.messages.find(m => m.id === value.id && m.conversation === value.conversation); if (existing) return { message: existing, duplicate: true };
    const relay = value.conversation.startsWith('g:') && data.groups[key]?.owner === this.self;
    const pending = outgoing || relay ? [...new Set((value.pending || []).filter(id => UUID.test(id) && id !== this.self && (!relay || data.groups[key].members.some(m => m.deviceId === id))))] : [];
    const now=Date.now(),age=!outgoing&&Number.isSafeInteger(value.ageMs)&&value.ageMs>=0?Math.min(value.ageMs,366*86400000):null;
    const message = { id: value.id, conversation: value.conversation, sender: value.sender, name: value.name, kind: value.kind, text: value.text, at: age!==null?now-age:Number.isSafeInteger(value.at)&&Math.abs(now-value.at)<365*86400000?value.at:now, receivedAt: Math.max(now, (data.messages.at(-1)?.receivedAt || 0) + 1), status: outgoing ? (pending.length ? 'queued' : 'sent') : 'received', pending };
    if(age!==null){message.originAgeMs=age;message.ageReceivedAt=now;}
        for(const key of ['replyTo','forwardedFrom']){const ref=require('../shared/chat-reference.cjs').reference(value[key]);if(ref)message[key]=ref;}
    message.recipients=outgoing?(value.conversation.startsWith('g:')?data.groups[key].members.map(m=>m.deviceId).filter(id=>id!==this.self):[key]):[];
    return this.change(d => { const change=(d.mutations||[]).find(c=>c.message===message.id&&c.conversation===message.conversation&&c.sender===message.sender);if(change&&(change.removed||message.kind==='text'))this.applyMutation(message,change);if(!message.deleted){for(const reaction of d.reactionChanges||[])if(reaction.message===message.id&&reaction.conversation===message.conversation){message.reactions||={};message.reactions[reaction.sender]={emoji:reaction.emoji,revision:reaction.revision};}d.messages.push(message);if(!outgoing)this.queueReceipt(d,message,'delivered');} return { message, duplicate: false }; });
  }
  eraseMessage(data,conversation,id){if(data.messagePins?.[conversation]===id)delete data.messagePins[conversation];for(const [key,value]of Object.entries(data.unseenReactions||{}))if(value.message===id&&value.conversation===conversation)delete data.unseenReactions[key];data.messages=data.messages.filter(m=>m.conversation!==conversation||m.id!==id);for(const [token,attachment]of Object.entries(data.attachments))if(attachment.conversation===conversation&&attachment.message===id)delete data.attachments[token];for(const [key,receipt]of Object.entries(data.receipts||{}))if(receipt.conversation===conversation&&receipt.message===id)delete data.receipts[key];}
  applyMutation(message,change){message.revision=change.revision;message.editedAt=change.at;message.deleted=change.removed;message.text=change.removed?'':change.text;}
  mutate(value,outgoing=false){
    if(!outgoing&&this.isBlocked(value?.sender))throw new Error('Contact is blocked.');
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
    return this.change(data => { const message = data.messages.find(m => m.id === id && (m.sender === this.self || (m.conversation.startsWith('g:') && data.groups[m.conversation.slice(2)]?.owner === this.self))); if (message&&message.pending.includes(peer)) { message.pending = message.pending.filter(value => value !== peer);delete message.failure;const group=message.conversation.startsWith('g:')&&data.groups[message.conversation.slice(2)];if(!group||group.owner===this.self){this.applyReceipt(message,peer,'delivered');if(message.sender!==this.self)this.queueReceipt(data,message,'delivered',peer);}else if(!['seen','delivered'].includes(message.status))message.status='sent'; } return message; });
  }
  queueReceipt(data,message,stage,reader=this.self){
    if(message.sender===this.self)return;
    const group=message.conversation.startsWith('g:')&&data.groups[message.conversation.slice(2)],peer=group&&group.owner!==this.self?group.owner:message.sender;
    const id=`${message.id}:${reader}:${stage}`;data.receipts||={};data.receipts[id]={id,message:message.id,conversation:message.conversation,reader,stage,peer};
  }
  applyReceipt(message,reader,stage){
    message.deliveredTo=[...new Set([...(message.deliveredTo||[]),reader])];
    if(stage==='seen')message.seenBy=[...new Set([...(message.seenBy||[]),reader])];
    const recipients=message.recipients||(message.conversation.startsWith('g:')?this.load().groups[message.conversation.slice(2)]?.members.map(m=>m.deviceId).filter(id=>id!==message.sender)||[]:[message.conversation.slice(2)]);
    if(recipients.length&&recipients.every(id=>message.seenBy?.includes(id)))message.status='seen';
    else if(recipients.length&&recipients.every(id=>message.deliveredTo.includes(id)))message.status='delivered';
    delete message.failure;
  }
  receipt(value,peer){
    if(!value||!UUID.test(value.message)||!UUID.test(value.reader)||!['delivered','seen'].includes(value.stage))throw new Error('Invalid receipt.');
    const data=this.load(),message=data.messages.find(m=>m.id===value.message&&m.conversation===value.conversation);if(!message)return false;
    const group=message.conversation.startsWith('g:')&&data.groups[message.conversation.slice(2)];
    if(group?(!group.members.some(m=>m.deviceId===value.reader)||value.reader===message.sender||(peer!==group.owner&&(peer!==value.reader||group.owner!==this.self))):(peer!==value.reader||peer!==message.conversation.slice(2)||message.sender!==this.self))throw new Error('Invalid receipt author.');
    return this.change(d=>{this.applyReceipt(message,value.reader,value.stage);if(message.sender!==this.self)this.queueReceipt(d,message,value.stage,value.reader);return true;});
  }
  pendingReceipts(peer){return Object.values(this.load().receipts||{}).filter(r=>r.peer===peer).slice(0,100);}
  seenMessages(conversation,ids){
    if(!Array.isArray(ids)||ids.length>100||ids.some(id=>!UUID.test(id)))throw new Error('Invalid visible messages.');
    const messages=this.load().messages.filter(m=>m.conversation===conversation&&m.sender!==this.self&&!m.seenReported&&ids.includes(m.id));
    const reactions=Object.entries(this.load().unseenReactions||{}).filter(([,r])=>r.conversation===conversation&&ids.includes(r.message));
    if(messages.length||reactions.length)return this.change(d=>{for(const message of messages){message.seenReported=true;this.queueReceipt(d,message,'seen');}for(const [key]of reactions)delete d.unseenReactions[key];});
  }
  ackReceipt(id,peer){if(this.load().receipts?.[id]?.peer===peer)return this.change(d=>{delete d.receipts[id];});}
  failed(id,peer){return this.change(d=>{const m=d.messages.find(m=>m.id===id&&m.sender===this.self&&m.pending.includes(peer));if(m&&m.status!=='seen'&&m.status!=='delivered'){m.status='failed';m.failure=true;}});}
  attachment(conversation, message, files) {
    if (!Array.isArray(files) || !files.length || files.some(file => typeof file !== 'string') || !this.load().messages.some(m => m.id === message && m.conversation === conversation && m.kind === 'file')) throw new Error('Invalid received attachment.');
    return this.change(data => { const token = crypto.randomUUID(); data.attachments[token] = { conversation, message, files }; return token; });
  }
  pinMessage(conversation,id){const d=this.load();if(id&&!d.messages.some(m=>m.id===id&&m.conversation===conversation))throw new Error('This message is unavailable.');if(!/^[pg]:[a-f0-9-]{36}$/i.test(conversation))throw new Error('Invalid conversation.');return this.change(d=>{d.messagePins||={};if(id)d.messagePins[conversation]=id;else delete d.messagePins[conversation];});}
  story(value,outgoing=false,peer){
    const d=this.load(),now=Date.now();if(!outgoing&&this.isBlocked(value?.sender))throw new Error('Contact is blocked.');if(!value||!UUID.test(value.id)||!UUID.test(value.sender)||(outgoing?value.sender!==this.self:value.sender!==peer)||typeof value.text!=='string'||value.text.length>1000||typeof value.image!=='string'||value.image.length>300000||(value.image&&!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value.image))||(!value.image&&!value.text.trim()))throw new Error('Invalid story.');
    if(!outgoing&&!d.contacts[value.sender])throw new Error('Unknown story author.');
    if(d.storyDeletes?.some(s=>s.id===value.id&&s.sender===value.sender)||d.stories?.some(s=>s.id===value.id))return false;
    const age=outgoing?0:Number.isSafeInteger(value.ageMs)&&value.ageMs>=0?value.ageMs:86400000;if(age>=86400000)return false;
    return this.change(d=>{d.stories=(d.stories||[]).filter(s=>s.expiresAt>now);if(d.stories.length>=200)throw new Error('Story limit reached.');d.stories.push({id:value.id,sender:value.sender,text:value.text.trim(),image:value.image,at:now-age,expiresAt:now-age+86400000});});
  }
  deleteStory(id,sender=this.self){if(!UUID.test(id)||!UUID.test(sender)||this.load().stories?.some(s=>s.id===id&&s.sender!==sender))throw new Error('Only the author can delete this story.');return this.change(d=>{d.stories=(d.stories||[]).filter(s=>s.id!==id);d.storyDeletes=(d.storyDeletes||[]).filter(s=>s.at>Date.now()-86400000&&s.id!==id);d.storyDeletes.push({id,sender,at:Date.now()});});}
  list() {
    const data = this.load(); return {blocked:{...data.blocked},emojiUsage:{...data.emojiUsage},storyDeletes:(data.storyDeletes||[]).filter(s=>s.at>Date.now()-86400000),stories:(data.stories||[]).filter(s=>s.expiresAt>Date.now()&&!this.isBlocked(s.sender)),messagePins:{...data.messagePins},unseenReactions:{...data.unseenReactions},scheduled:[...(data.scheduled||[])],filePolicies: {...data.filePolicies}, muted:{...data.muted}, pins:{...data.pins},pinOrder:[...(data.pinOrder||[])],lastSelected:data.lastSelected||'', unread:this.unread(), contacts: Object.values(data.contacts), groups: Object.values(data.groups), conversations: [...new Set(data.messages.map(m => m.conversation))].map(id => ({ id, last: data.messages.filter(m => !m.deleted && m.conversation === id).at(-1) })) };
  }
  reorderPins(order) {
    const pins=Object.keys(this.load().pins||{});
    if(!Array.isArray(order)||order.length!==pins.length||new Set(order).size!==order.length||order.some(id=>!pins.includes(id)))throw new Error('Pinned list changed. Try again.');
    return this.change(next=>{next.pinOrder=[...order];});
  }
  conversationState(conversation, {pinned,muted,selected,read,readThrough}={}) {
    const data=this.load();
    if(typeof conversation!=='string'||!/^([pg]):[a-f0-9-]{36}$/i.test(conversation)||!(conversation.startsWith('p:')?data.contacts[conversation.slice(2)]:data.groups[conversation.slice(2)]))throw new Error('Unknown conversation.');
    if(pinned!==undefined&&typeof pinned!=='boolean')throw new Error('Invalid pin setting.');
    if(muted!==undefined&&typeof muted!=='boolean')throw new Error('Invalid mute setting.');
    const latest=Math.max(0,...data.messages.filter(m=>m.conversation===conversation).map(m=>m.receivedAt)),readAt=Number.isSafeInteger(readThrough)&&readThrough>=0?Math.min(latest,readThrough):latest;if(pinned===undefined&&(muted===undefined||!!data.muted?.[conversation]===muted)&&(!selected||data.lastSelected===conversation)&&(!read||(data.readAt?.[conversation]||0)>=readAt))return;
    return this.change(next=>{if(muted!==undefined){next.muted||={};if(muted)next.muted[conversation]=true;else delete next.muted[conversation];}if(pinned!==undefined){next.pins||={};next.pinOrder||=Object.keys(next.pins);if(pinned){next.pins[conversation]=true;if(!next.pinOrder.includes(conversation))next.pinOrder.push(conversation);}else{delete next.pins[conversation];next.pinOrder=next.pinOrder.filter(id=>id!==conversation);}}if(selected)next.lastSelected=conversation;if(read){next.readAt||={};next.readAt[conversation]=Math.max(next.readAt[conversation]||0,readAt);}});
  }
  isMuted(conversation){return this.load().muted?.[conversation]===true;}
  isBlocked(peer){return this.load().blocked?.[peer]===true;}
  block(peer,blocked){if(!UUID.test(peer)||peer===this.self||!this.load().contacts[peer]||typeof blocked!=='boolean')throw new Error('Invalid block setting.');return this.change(d=>{d.blocked||={};if(blocked)d.blocked[peer]=true;else delete d.blocked[peer];});}
  notificationUnread(){return Object.fromEntries(Object.entries(this.unread()).filter(([id])=>!this.isMuted(id)&&!this.isBlocked(id.slice(2))));}
  emojiUsage(emoji){if(emoji===undefined)return {...this.load().emojiUsage};const data=require('./ui/assets/emoji-data.js');if(typeof emoji!=='string'||emoji.length>64||!data.groups.some(g=>g.items.some(e=>e[0]===emoji)))throw new Error('Invalid emoji.');return this.change(d=>{d.emojiUsage||={};d.emojiUsage[emoji]=Math.min(1000000,(d.emojiUsage[emoji]||0)+1);d.emojiUsage=Object.fromEntries(Object.entries(d.emojiUsage).sort((a,b)=>b[1]-a[1]).slice(0,256));return {...d.emojiUsage};});}
  unread(){const data=this.load(),counts={};for(const m of data.messages)if(m.sender!==this.self&&!m.deleted&&m.receivedAt>(data.readAt?.[m.conversation]||0))counts[m.conversation]=(counts[m.conversation]||0)+1;return counts;}
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
  schedule(value){
    const data=this.load(),conversation=value?.conversation,key=conversation?.slice(2);
    if(!/^[pg]:[a-f0-9-]{36}$/i.test(conversation||'')||!(conversation.startsWith('p:')?data.contacts[key]:data.groups[key])||typeof value.text!=='string'||!value.text.trim()||value.text.length>8000||!Number.isSafeInteger(value.sendAt)||value.sendAt<=Date.now()||value.sendAt>Date.now()+366*86400000)throw new Error('Choose a future time and enter a message.');
    if(value.id&&!data.scheduled?.some(m=>m.id===value.id&&m.conversation===conversation))throw new Error('Scheduled message was already sent or removed.');
    if(!value.id&&(data.scheduled||[]).length>=500)throw new Error('Scheduled message limit reached.');
    const item={id:value.id||crypto.randomUUID(),conversation,text:value.text.trim(),sendAt:value.sendAt};
    return this.change(d=>{d.scheduled=(d.scheduled||[]).filter(m=>m.id!==item.id);d.scheduled.push(item);return item;});
  }
  scheduled(conversation){return (this.load().scheduled||[]).filter(m=>m.conversation===conversation).sort((a,b)=>a.sendAt-b.sendAt);}
  cancelScheduled(id){return this.change(d=>{d.scheduled=(d.scheduled||[]).filter(m=>m.id!==id);});}
  dispatchDue(name,now=Date.now()){
    const due=(this.load().scheduled||[]).filter(m=>m.sendAt<=now);if(!due.length)return [];
    return this.change(d=>{const messages=[];for(const item of due){const group=item.conversation.startsWith('g:')&&d.groups[item.conversation.slice(2)],recipients=group?group.members.map(m=>m.deviceId).filter(id=>id!==this.self):[item.conversation.slice(2)],pending=group&&group.owner!==this.self?[group.owner]:recipients;
      if(!d.messages.some(m=>m.id===item.id&&m.conversation===item.conversation)){const message={id:item.id,conversation:item.conversation,sender:this.self,name:String(name||'').slice(0,60),kind:'text',text:item.text,at:now,scheduledAt:item.sendAt,receivedAt:Math.max(now,(d.messages.at(-1)?.receivedAt||0)+1),status:pending.length?'queued':'sent',pending,recipients};d.messages.push(message);messages.push(message);}
    }d.scheduled=(d.scheduled||[]).filter(m=>m.sendAt>now);return messages;});
  }
  react(value,outgoing=false){
    if(!outgoing&&this.isBlocked(value?.sender))throw new Error('Contact is blocked.');
    const data=this.load();if(!value||!UUID.test(value.id)||!UUID.test(value.message)||!UUID.test(value.sender)||!/^([pg]):[a-f0-9-]{36}$/i.test(value.conversation)||typeof value.emoji!=='string'||value.emoji.length>64||value.emoji&&(!/\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u.test(value.emoji)||[...new Intl.Segmenter('en',{granularity:'grapheme'}).segment(value.emoji)].length!==1)||!Number.isSafeInteger(value.revision)||value.revision<1||value.revision>1000000000||outgoing&&value.sender!==this.self)throw new Error('Invalid reaction.');
    const group=value.conversation.startsWith('g:')&&data.groups[value.conversation.slice(2)],message=data.messages.find(m=>m.id===value.message&&m.conversation===value.conversation);
    if(group?!group.members.some(m=>m.deviceId===value.sender):!data.contacts[value.conversation.slice(2)]||!outgoing&&value.sender!==value.conversation.slice(2))throw new Error('Invalid reaction author.');
    if(outgoing&&!message)throw new Error('This message is unavailable.');
    if((data.mutations||[]).some(m=>m.message===value.message&&m.conversation===value.conversation&&m.removed))return {duplicate:true};
    const previous=(data.reactionChanges||[]).find(r=>r.message===value.message&&r.conversation===value.conversation&&r.sender===value.sender);if(previous&&previous.revision>=value.revision)return {duplicate:true};
    const pending=outgoing||group?.owner===this.self?[...new Set((value.pending||[]).filter(id=>UUID.test(id)&&id!==this.self&&(!group||group.members.some(m=>m.deviceId===id))))]:[];
    const reaction={id:value.id,message:value.message,conversation:value.conversation,sender:value.sender,emoji:value.emoji,revision:value.revision,pending};
    return this.change(d=>{d.reactionChanges=(d.reactionChanges||[]).filter(r=>!(r.message===reaction.message&&r.conversation===reaction.conversation&&r.sender===reaction.sender));d.reactionChanges.push(reaction);if(!outgoing&&message?.sender===this.self){d.unseenReactions||={};const key=reaction.message+':'+reaction.sender;if(reaction.emoji)d.unseenReactions[key]={message:reaction.message,conversation:reaction.conversation,emoji:reaction.emoji};else delete d.unseenReactions[key];}if(message){message.reactions||={};message.reactions[reaction.sender]={emoji:reaction.emoji,revision:reaction.revision};}return {duplicate:false,reaction};});
  }
  pendingReactions(peer){return (this.load().reactionChanges||[]).filter(r=>r.pending.includes(peer));}
  deliveredReaction(id,peer){if(this.load().reactionChanges?.some(r=>r.id===id&&r.pending.includes(peer)))return this.change(d=>{const reaction=d.reactionChanges.find(r=>r.id===id);reaction.pending=reaction.pending.filter(p=>p!==peer);});}
  files(token) { const attachment = this.load().attachments[token]; if (!attachment || !this.load().messages.some(m=>m.id===attachment.message&&m.conversation===attachment.conversation&&!m.deleted)) throw new Error('This attachment is unavailable.'); return attachment.files; }
}
module.exports = { ChatStore };
