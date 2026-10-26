'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ChatStore } = require('../desktop/chat-store.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shatoot-history-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const key = crypto.randomBytes(32), self = crypto.randomUUID(), peer = crypto.randomUUID(), other = crypto.randomUUID();
  const options = { file: path.join(root, 'history.dat'), self,
    encrypt: text => { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([cipher.update(text), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
    decrypt: bytes => { if (bytes.length < 28) throw new Error('Invalid envelope'); const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12), { authTagLength: 16 }); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(); } };
  const store = new ChatStore(options); store.contact({ deviceId: peer, name: 'همکار' }, { type: 'lan', address: '192.168.1.10:8788' }); return { store, options, self, peer, other };
}

test('delivery and seen receipts are authenticated, monotonic and survive offline/restart',t=>{
  const {store,options,self,peer,other}=fixture(t),conversation=`p:${peer}`,id=crypto.randomUUID();
  store.append({id,conversation,sender:self,name:'Me',kind:'text',text:'Hello',pending:[peer]},true);
  assert.equal(store.history({conversation})[0].status,'queued');store.failed(id,peer);assert.equal(store.history({conversation})[0].status,'failed');
  assert.throws(()=>store.receipt({message:id,conversation,reader:other,stage:'seen'},other),/author/);
  store.receipt({message:id,conversation,reader:peer,stage:'seen'},peer);store.delivered(id,peer);
  assert.equal(new ChatStore(options).history({conversation})[0].status,'seen','A late delivery ACK must not regress seen');
  const incoming=crypto.randomUUID();store.append({id:incoming,conversation,sender:peer,name:'Peer',kind:'text',text:'Reply'});
  assert.equal(store.pendingReceipts(peer).filter(r=>r.stage==='seen').length,0);
  store.conversationState(conversation,{read:true});assert.equal(store.pendingReceipts(peer).filter(r=>r.stage==='seen').length,0,'Unread watermark alone does not prove a displayed message');store.seenMessages(conversation,[incoming]);const reopened=new ChatStore(options),receipts=reopened.pendingReceipts(peer);
  assert.deepEqual(receipts.filter(r=>r.message===incoming).map(r=>r.stage),['delivered','seen']);
  reopened.ackReceipt(receipts[0].id,other);assert.equal(reopened.pendingReceipts(peer).length,2);
  for(const receipt of receipts)reopened.ackReceipt(receipt.id,peer);assert.equal(reopened.pendingReceipts(peer).length,0);
});

test('group receipts require every recipient, authenticate relays and forward back to the original sender',t=>{
  const {store,self,peer,other}=fixture(t),group={id:crypto.randomUUID(),owner:peer,name:'Team',members:[{deviceId:self,name:'Me'},{deviceId:peer,name:'Owner'},{deviceId:other,name:'Other'}]};
  store.group(group);const conversation=`g:${group.id}`,id=crypto.randomUUID();store.append({id,conversation,sender:self,name:'Me',kind:'text',text:'All members',pending:[peer]},true);
  store.delivered(id,peer);assert.equal(store.history({conversation})[0].status,'sent');
  store.receipt({message:id,conversation,reader:peer,stage:'seen'},peer);assert.notEqual(store.history({conversation})[0].status,'seen');
  assert.throws(()=>store.receipt({message:id,conversation,reader:other,stage:'seen'},other),/author/);
  store.receipt({message:id,conversation,reader:other,stage:'delivered'},peer);assert.equal(store.history({conversation})[0].status,'delivered');
  store.receipt({message:id,conversation,reader:other,stage:'seen'},peer);assert.equal(store.history({conversation})[0].status,'seen');
  const relay={...group,id:crypto.randomUUID(),owner:self};store.group(relay);const relayId=crypto.randomUUID(),relayConversation=`g:${relay.id}`;
  store.append({id:relayId,conversation:relayConversation,sender:peer,name:'Peer',kind:'text',text:'Relayed',pending:[other]});
  store.receipt({message:relayId,conversation:relayConversation,reader:other,stage:'seen'},other);
  assert.ok(store.pendingReceipts(peer).some(r=>r.message===relayId&&r.reader===other&&r.stage==='seen'));
});
test('sender edits/deletes persist, queue offline, reject forged authors and preserve tombstones on replay',t=>{
  const {store,options,self,peer,other}=fixture(t),conversation=`p:${peer}`,id=crypto.randomUUID();store.append({id,conversation,sender:self,name:'Me',kind:'text',text:'original',pending:[peer]},true);
  const edit={id:crypto.randomUUID(),message:id,conversation,sender:self,removed:false,text:'updated',revision:1,pending:[peer]};store.mutate(edit,true);
  assert.equal(new ChatStore(options).history({conversation})[0].text,'updated');assert.equal(store.pendingChanges(peer).length,1);
  assert.throws(()=>store.mutate({...edit,sender:other,revision:2},true),/Invalid/);
  const deleted={...edit,id:crypto.randomUUID(),revision:2,removed:true};store.mutate(deleted,true);assert.equal(store.history({conversation}).length,0);assert.equal(store.load().messages.length,0);assert.equal(store.list().conversations.length,0);
  assert.throws(()=>store.mutate({...edit,revision:3},true),/cannot be changed/);store.deliveredChange(deleted.id,peer);assert.equal(store.pendingChanges(peer).length,0);
  const late=crypto.randomUUID();store.mutate({...deleted,id:crypto.randomUUID(),message:late,sender:peer,revision:1});store.append({id:late,conversation,sender:peer,name:'Peer',kind:'text',text:'late original'});assert.equal(store.history({conversation}).find(m=>m.id===late),undefined);assert.equal(new ChatStore(options).history({conversation}).length,0);
});
test('encrypted history survives restart, deduplicates delivery, paginates without timestamp gaps and persists the outbox', t => {
  const { store, options, self, peer } = fixture(t);
  for (let index = 0; index < 125; index++) store.append({ id: crypto.randomUUID(), conversation: `p:${peer}`, sender: self, name: 'Me', kind: 'text', text: `پیام ${index}`, pending: [peer] }, true);
  assert.equal(store.pending(peer).length, 125); const last = store.history({ conversation: `p:${peer}` }); assert.equal(last.length, 100);
  assert.equal(store.history({ conversation: `p:${peer}`, before: last[0].receivedAt }).length, 25);
  const message = last.at(-1); assert.equal(store.append(message, true).duplicate, true);
  store.delivered(message.id, peer); assert.equal(store.pending(peer).length, 124);
  assert.equal(fs.readFileSync(options.file).includes(Buffer.from('پیام')), false);
  const reopened = new ChatStore(options); assert.equal(reopened.pending(peer).length, 124); assert.equal(reopened.history({ conversation: `p:${peer}`, search: '124' })[0].status, 'delivered');
});

test('deletion erases file-message references without deleting the file and hides legacy deletion placeholders',t=>{
 const{store,options,self,peer}=fixture(t),conversation=`p:${peer}`,id=crypto.randomUUID(),file=path.join(path.dirname(options.file),'received.txt');fs.writeFileSync(file,'retain download');
 store.append({id,conversation,sender:self,name:'Me',kind:'file',text:'received.txt'},true);const attachment=store.attachment(conversation,id,[file]);
 store.mutate({id:crypto.randomUUID(),message:id,conversation,sender:self,removed:true,revision:1,pending:[peer]},true);
 assert.equal(store.load().messages.length,0);assert.equal(Object.keys(store.load().attachments).length,0);assert.throws(()=>store.files(attachment),/unavailable/);assert.equal(fs.readFileSync(file,'utf8'),'retain download');
 store.change(data=>data.messages.push({id:crypto.randomUUID(),conversation,sender:peer,name:'Peer',kind:'text',text:'',deleted:true,receivedAt:Date.now(),pending:[]}));
 const reopened=new ChatStore(options);assert.equal(reopened.history({conversation}).length,0);assert.equal(reopened.load().messages.length,0);
});
test('group owner keeps an offline relay queue and corrupt history is retained instead of overwritten', t => {
  const { store, options, self, peer, other } = fixture(t);
  const group = { id: crypto.randomUUID(), owner: self, name: 'Team', members: [{ deviceId: self, name: 'Owner' }, { deviceId: peer, name: 'A' }, { deviceId: other, name: 'B' }] }; store.group(group);
  const m = { id: crypto.randomUUID(), conversation: `g:${group.id}`, sender: peer, name: 'A', kind: 'text', text: 'For offline B', pending: [other] }; store.append(m);
  assert.equal(new ChatStore(options).pending(other).length, 1); store.delivered(m.id, other); assert.equal(store.pending(other).length, 0); assert.equal(store.history({ conversation: m.conversation })[0].status, 'received');
  assert.throws(() => store.group({ ...group, owner: peer }), /cannot change/);
  const damaged = Buffer.from('corrupt encrypted history'); fs.writeFileSync(options.file, damaged);
  assert.throws(() => new ChatStore(options).list(), /has been kept/); assert.deepEqual(fs.readFileSync(options.file), damaged);
});

test('pins, last selection and unread watermarks persist independently of remote metadata',t=>{
  const {store,options,self,peer}=fixture(t),conversation=`p:${peer}`,incoming=()=>({id:crypto.randomUUID(),conversation,sender:peer,name:'Peer',kind:'text',text:'Hi'});
  const first=store.append(incoming()).message;store.append(first);assert.equal(store.unread()[conversation],1);store.append({...incoming(),sender:self},true);assert.equal(store.unread()[conversation],1);
  store.conversationState(conversation,{pinned:true,selected:true,read:true});let reopened=new ChatStore(options);assert.equal(reopened.list().pins[conversation],true);assert.equal(reopened.list().lastSelected,conversation);assert.equal(reopened.unread()[conversation],undefined);
  const second=store.append(incoming()).message;assert.equal(store.unread()[conversation],1);store.mutate({id:crypto.randomUUID(),message:second.id,conversation,sender:peer,removed:true,revision:1});assert.equal(store.unread()[conversation],undefined);store.conversationState(conversation,{pinned:false});assert.equal(store.list().pins[conversation],undefined);assert.throws(()=>store.conversationState('p:'+crypto.randomUUID(),{read:true}),/Unknown/);
});

test('partial read watermark marks only seen arrivals and cannot move backwards or beyond history',t=>{
  const {store,peer}=fixture(t),conversation=`p:${peer}`,messages=[];
  for(let i=0;i<3;i++)messages.push(store.append({id:crypto.randomUUID(),conversation,sender:peer,name:'Peer',kind:'text',text:'Unread '+i}).message);
  store.conversationState(conversation,{read:true,readThrough:messages[0].receivedAt});assert.equal(store.unread()[conversation],2);
  store.conversationState(conversation,{read:true,readThrough:0});assert.equal(store.unread()[conversation],2);
  store.conversationState(conversation,{read:true,readThrough:Number.MAX_SAFE_INTEGER});assert.equal(store.unread()[conversation],undefined);assert.equal(store.load().readAt[conversation],messages[2].receivedAt);
});

test('manual pinned chat order survives reload, new messages and repinning; malformed reorders preserve state',t=>{
  const{store,options,peer,other}=fixture(t),first='p:'+peer,second='p:'+other;
  store.contact({deviceId:other,name:'Other'},{type:'lan',address:'192.168.1.11:8788'});
  store.conversationState(first,{pinned:true});store.conversationState(second,{pinned:true});store.reorderPins([second,first]);
  store.append({id:crypto.randomUUID(),conversation:first,sender:peer,name:'Peer',kind:'text',text:'New arrival'});
  const reopened=new ChatStore(options);assert.deepEqual(reopened.list().pinOrder,[second,first]);
  for(const order of [[first],[first,first],[first,'p:'+crypto.randomUUID()],null])assert.throws(()=>reopened.reorderPins(order),/Pinned list changed/);
  assert.deepEqual(reopened.list().pinOrder,[second,first]);reopened.conversationState(second,{pinned:false});reopened.conversationState(second,{pinned:true});assert.deepEqual(reopened.list().pinOrder,[first,second]);
});

test('mute persists independently per conversation without reading messages or changing file policy and pins',t=>{
  const{store,options,self,peer,other}=fixture(t),conversation='p:'+peer;
  store.contact({deviceId:other,name:'Other'},{type:'lan',address:'192.168.1.11:8788'});
  store.conversationState(conversation,{pinned:true});store.filePolicy(conversation,'ask');
  store.conversationState(conversation,{muted:true});store.append({id:crypto.randomUUID(),conversation,sender:peer,name:'Peer',kind:'text',text:'Still received'});
  const reopened=new ChatStore(options);assert.equal(reopened.isMuted(conversation),true);assert.equal(reopened.isMuted('p:'+other),false);assert.equal(reopened.unread()[conversation],1);assert.equal(reopened.filePolicy(conversation),'ask');assert.equal(reopened.list().pins[conversation],true);assert.equal(reopened.list().muted[conversation],true);
  assert.throws(()=>reopened.conversationState(conversation,{muted:'yes'}),/Invalid mute/);assert.equal(reopened.isMuted(conversation),true);
  reopened.conversationState(conversation,{muted:false});assert.equal(new ChatStore(options).isMuted(conversation),false);assert.equal(reopened.unread()[conversation],1);assert.deepEqual(reopened.list().pinOrder,[conversation]);
});
