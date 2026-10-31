const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
function client(){const sockets=[],sent=[];let endpoint=async()=> 'ws://127.0.0.1:8788',internet=async()=>{};const context={window:{LANSocket:class{constructor(){sockets.push(this)}send(data){sent.push(data)}close(){this.closed=true;this.onclose?.()}}},AbortController,DOMException,crypto,setTimeout,clearTimeout,clearInterval,setInterval,console};vm.createContext(context);for(const file of ['connection-attempt.js','collaboration.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../desktop/ui',file),'utf8'),context);const engine=new context.window.CollaborationClient({api:{collaboration:async op=>op==='list'?{contacts:[],groups:[],conversations:[]}:true,directEndpoint:(...a)=>endpoint(...a)},self:{deviceId:crypto.randomUUID(),name:'Me'},internet:()=>({registered:true,supported:true,endpoint:'wss://example.test',send:m=>sent.push(m)}),ensureInternet:()=>internet()});return{engine,sockets,sent,endpoint:fn=>endpoint=fn,internet:fn=>internet=fn};}
test('cancel stops LAN validation and pending sockets; a late result cannot create a new connection',async()=>{
 const f=client();await f.engine.ready;let resolve;f.endpoint(()=>new Promise(r=>resolve=r));const pending=f.engine.connect({type:'lan',address:'127.0.0.1'});await new Promise(r=>setImmediate(r));f.engine.cancelPending();await assert.rejects(pending,/cancelled/);resolve('ws://127.0.0.1:8788');await new Promise(r=>setImmediate(r));assert.equal(f.sockets.length,0);assert.equal(f.engine.sessions.size,0);
 f.endpoint(async()=> 'ws://127.0.0.1:8788');const retry=f.engine.connect({type:'lan',address:'127.0.0.1'});await new Promise(r=>setImmediate(r));assert.equal(f.sockets.length,1);f.engine.cancelPending();await assert.rejects(retry,/cancelled/);assert.equal(f.sockets[0].closed,true);assert.equal(f.engine.sessions.size,0);
});
test('cancel settles an Internet wait immediately and leaves an established chat alone',async()=>{
 const f=client();await f.engine.ready;let resolve;f.internet(()=>new Promise(r=>resolve=r));const pending=f.engine.connect({type:'id',address:'123456789'});await new Promise(r=>setImmediate(r));const active={id:'active',outgoingAttempt:{},channel:{readyState:'open'}};f.engine.sessions.set('active',active);f.engine.cancelPending();await assert.rejects(pending,/cancelled/);resolve();await new Promise(r=>setImmediate(r));assert.equal(f.sent.length,0);assert.equal(f.engine.sessions.get('active'),active);f.engine.sessions.delete('active');
});

test('saved ID cards obtain metadata over background chat without a prior chat; other servers stay untouched',async()=>{
 const f=client();await f.engine.ready;const attempts=[];f.engine.api.connections=async()=>[{address:'123456789',endpoint:'wss://example.test',name:'Saved computer'},{address:'987654321',endpoint:'wss://other.test'},{address:'192.168.1.10'}];
 f.engine.connect=async route=>{attempts.push(route);};await f.engine.reconnectKnown();assert.equal(attempts.length,1);assert.equal(attempts[0].address,'123456789');assert.equal(attempts[0].type,'id');assert.equal(attempts[0].background,true);
 await f.engine.reconnectKnown();assert.equal(attempts.length,1,'Retry throttle prevents repeated invitations');
});

test('known ID addresses reuse an incoming or pending chat instead of a duplicate invitation',async()=>{
 const f=client();await f.engine.ready;const peer=crypto.randomUUID(),active={id:'incoming',peer:{deviceId:peer,id:'123456789'},route:{type:'id',endpoint:'wss://example.test'},channel:{readyState:'open'}};active.promise=Promise.resolve(active);f.engine.sessions.set(active.id,active);assert.equal(await f.engine.connect({type:'id',address:'123 456 789'}),active);assert.equal(f.sent.length,0);
 f.engine.sessions.clear();f.engine.catalog.contacts=[{deviceId:peer,name:'Peer',route:{type:'id',address:'123456789',endpoint:'wss://example.test'}}];const pending={...active,id:'pending',peer:{deviceId:peer},route:{type:'incoming-lan'},channel:{readyState:'connecting'}};pending.promise=Promise.resolve(pending);f.engine.sessions.set(pending.id,pending);assert.equal(await f.engine.connect({type:'id',address:'123456789'}),pending);assert.equal(f.sent.length,0);
});
test('new story layouts and audio containers have a valid legacy fallback without blocking ordinary chat',async()=>{
 const {engine}=client();await engine.ready;const story={id:crypto.randomUUID(),sender:crypto.randomUUID(),text:'',image:'',at:Date.now(),design:{layers:[{text:'Overlay text'}]},media:{mime:'audio/webm'}};
 const old=engine.storyWire({features:['stories-v1','story-media-v1']},story);assert.equal(old.text,'Overlay text');assert.equal(old.media,undefined);assert.equal(old.design,undefined);
 const modern=engine.storyWire({features:['story-design-v1']},story);assert.equal(modern.media.mime,'audio/webm');assert.equal(modern.design.layers[0].text,'Overlay text');
 assert.ok(engine.storyWire({features:[]},{...story,design:undefined}).text.trim());
});


test('overlapping catalogue refreshes serialize reads and retain changes arriving during the first read',async()=>{
 const {engine}=client();await engine.ready;let reads=0,active=0,maxActive=0;const pending=[];
 engine.api.collaboration=async op=>{assert.equal(op,'list');reads++;active++;maxActive=Math.max(maxActive,active);const value=await new Promise(resolve=>pending.push(resolve));active--;return value;};
 const first=engine.refresh(),second=engine.refresh(),third=engine.refresh();assert.equal(reads,1);
 pending.shift()({contacts:[],groups:[],conversations:[],generation:1});await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,2);
 pending.shift()({contacts:[],groups:[],conversations:[],generation:2});await Promise.all([first,second,third]);assert.equal(maxActive,1);assert.equal(engine.catalog.generation,2);
 engine.api.collaboration=async()=>{throw Error('temporary failure');};await assert.rejects(engine.refresh(),/temporary failure/);
 engine.api.collaboration=async()=>({contacts:[],groups:[],conversations:[],generation:3});await engine.refresh();assert.equal(engine.catalog.generation,3);
});
