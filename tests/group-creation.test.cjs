const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const vm=require('node:vm');
const {ChatStore}=require('../desktop/chat-store.cjs');
test('groups can start empty, add offline contacts beyond the old 16-member cap and persist every pending recipient',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'shatoot-group-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const self={deviceId:crypto.randomUUID(),name:'Owner'},store=new ChatStore({self:self.deviceId,file:path.join(directory,'history'),encrypt:text=>Buffer.from(text),decrypt:bytes=>bytes.toString()});
  const contacts=Array.from({length:32},(_,i)=>({deviceId:crypto.randomUUID(),name:`Offline ${i}`}));for(const peer of contacts)store.contact(peer);
  const context={window:{},AbortController,DOMException,crypto,console,setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../desktop/ui/connection-attempt.js'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../desktop/ui/collaboration.js'),'utf8'),context);
  const api={collaboration:async(op,value)=>op==='list'?store.list():op==='group'?store.group(value):null};
  const engine=new context.window.CollaborationClient({api,self,internet:()=>({}),ensureInternet:async()=>{throw new Error('Group creation must not require a server.');}});await engine.ready;
  const empty=await engine.createGroup('My group',[]);assert.equal(empty.members.length,1);
  const expanded=await engine.createGroup('My group',contacts.map(c=>c.deviceId),empty.id);assert.equal(expanded.id,empty.id);assert.equal(expanded.members.length,33);
  store.append({id:crypto.randomUUID(),conversation:`g:${empty.id}`,sender:self.deviceId,name:self.name,kind:'text',text:'Queued for everyone',pending:contacts.map(c=>c.deviceId)},true);
  assert.equal(store.load().messages[0].pending.length,32);
});


test('reactions persist and reach an online peer without waiting for full refresh or the normal flush queue',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'shatoot-reaction-fast-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const self={deviceId:crypto.randomUUID(),name:'Self'},peer=crypto.randomUUID(),conversation='p:'+peer,message=crypto.randomUUID();
 const store=new ChatStore({self:self.deviceId,file:path.join(directory,'history'),encrypt:text=>Buffer.from(text),decrypt:bytes=>bytes.toString()});store.contact({deviceId:peer,name:'Peer'});store.append({id:message,conversation,sender:peer,name:'Peer',kind:'text',text:'Reaction fixture'});
 const context={window:{},crypto,setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../desktop/ui/collaboration.js'),'utf8'),context);
 const changes=[],sent=[],ops=[];let release,started;const rpcStarted=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 const api={collaboration:async(op,value)=>{ops.push(op);if(op==='list')return store.list();if(op==='react')return store.react(value.reaction,true);if(op==='pending-reactions')return store.pendingReactions(value.peer);if(op==='delivered-reaction')return store.deliveredReaction(value.id,value.peer);throw Error('Unexpected expensive operation: '+op);}};
 const engine=new context.window.CollaborationClient({api,self,changed:change=>changes.push(change)});await engine.ready;ops.length=0;
 const session={id:crypto.randomUUID(),peer:{deviceId:peer},features:['message-reactions-v1'],channel:{readyState:'open'},flushing:true};engine.sessions.set(session.id,session);
 engine.flush=()=>{throw Error('Reaction waited for the normal queue');};engine.refresh=()=>{throw Error('Reaction triggered a full refresh');};
 engine.rpc=async(s,op,r)=>{sent.push(r);started();if(sent.length===1)await gate;return true;};
 const first=await engine.react(conversation,message,'👍');await rpcStarted;
 assert.equal(first.revision,1);assert.equal(changes.at(-1).reaction.emoji,'👍');assert.equal(sent.length,1);
 const second=await engine.react(conversation,message,'❤️');assert.equal(second.revision,2);assert.equal(changes.at(-1).reaction.emoji,'❤️');release();
 for(let n=0;n<50&&session.reactionsBusy;n++)await new Promise(r=>setTimeout(r,1));
 assert.equal(sent.length,2);assert.equal(sent[1].revision,2);assert.equal(store.pendingReactions(peer).length,0);assert.ok(!ops.includes('list')&&!ops.includes('message'));
});


test('text delivery bypasses background flush and retries a lost ACK using the original message ID',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'shatoot-text-fast-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const self={deviceId:crypto.randomUUID(),name:'Self'},peer=crypto.randomUUID(),conversation='p:'+peer;
 const make=id=>new ChatStore({self:id,file:path.join(directory,id),encrypt:text=>Buffer.from(text),decrypt:bytes=>bytes.toString()});const local=make(self.deviceId),remote=make(peer);local.contact({deviceId:peer,name:'Peer'});remote.contact(self);
 const timers=[];const context={window:{},crypto,setTimeout:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.cancelled=true;}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../desktop/ui/collaboration.js'),'utf8'),context);
 const api={collaboration:async(op,v)=>{if(op==='list')return local.list();if(op==='append')return local.append(v.message,true);if(op==='pending')return local.pending(v.peer);if(op==='delivered')return local.delivered(v.id,v.peer);if(op==='failed')return local.failed(v.id,v.peer);throw Error(op);}};
 const client=new context.window.CollaborationClient({api,self});await client.ready;client.refreshSoon=()=>{};client.refresh=()=>{throw Error('Refresh blocked send');};client.flush=()=>{throw Error('Background queue blocked text');};
 const session={peer:{deviceId:peer},channel:{readyState:'open'},flushing:true};client.sessions.set(peer,session);const ids=[];let lost=true;
 client.rpc=async(s,op,m)=>{assert.equal(op,'message');ids.push(m.id);remote.append({...m,conversation:'p:'+self.deviceId});if(lost){lost=false;throw Error('ACK lost');}return true;};
 const message=await client.send(conversation,'Reliable text fixture');for(let n=0;n<30&&!session.textRetry;n++)await new Promise(r=>setImmediate(r));
 assert.equal(session.textRetry.ms,1000);session.textRetry.fn();for(let n=0;n<30&&session.textBusy;n++)await new Promise(r=>setImmediate(r));
 assert.deepEqual(ids,[message.id,message.id]);assert.equal(remote.history({conversation:'p:'+self.deviceId}).length,1);assert.equal(local.pending(peer).length,0);
});

test('incoming text is not blocked by a pending file approval',async()=>{
 const context={window:{},crypto,setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../desktop/ui/collaboration.js'),'utf8'),context);
 const client=new context.window.CollaborationClient({api:{collaboration:async()=>({contacts:[],groups:[]})},self:{deviceId:crypto.randomUUID()}});await client.ready;
 let release;const approval=new Promise(r=>release=r),seen=[];client.request=async(s,op)=>{if(op==='begin')await approval;seen.push(op);return true;};
 const channel={readyState:'open',send:()=>{}},session={frames:new Map(),pending:new Map(),queue:Promise.resolve()};client.bind(session,channel);
 for(const [id,op] of [[1,'begin'],[2,'message']])channel.onmessage({data:JSON.stringify({id,op,value:{}})});
 await session.interactiveQueue;assert.deepEqual(seen,['message']);release();await session.queue;assert.deepEqual(seen,['message','begin']);
});


test('relayed text wakes delivery even while the background flush is occupied',async()=>{
 const context={window:{},crypto,setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../desktop/ui/collaboration.js'),'utf8'),context);
 const client=new context.window.CollaborationClient({api:{collaboration:async()=>({contacts:[],groups:[]})},self:{deviceId:crypto.randomUUID()}});await client.ready;
 let text=0;client.flushMessages=async()=>{text++;};const session={flushing:true};await client.flush(session);assert.equal(text,1);assert.equal(session.flushAgain,true);
});
