const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { createSignalingServer } = require('../server/index.cjs');

async function fixture(t, options = {}) {
  const service = createSignalingServer({ port: 0, host: '127.0.0.1', iceServers: [{ urls: 'stun:example.invalid:3478' }], ...options });
  const address = await service.listen();
  t.after(() => service.close());
  async function client() {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}`), queue = [], waiters = [];
    ws.on('message', raw => {
      const m = JSON.parse(raw), index = waiters.findIndex(w => w.type === m.type);
      if (m.type === 'hello') ws.send(JSON.stringify({ type: 'authenticate', serverKey: options.enrollmentKey }));
      if (index >= 0) { const [w] = waiters.splice(index, 1); clearTimeout(w.timer); w.resolve(m); } else queue.push(m);
    });
    const next = (type, timeout = 2000) => {
      const index = queue.findIndex(m => m.type === type);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { type, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`Timed out: ${type}`)); }, timeout) };
        waiters.push(w);
      });
    };
    await next('ready');
    return { ws, next, queue, send: m => ws.send(JSON.stringify(m)) };
  }
  return { service, client };
}
async function hosted(client) {
  const host = await client(); host.send({ type: 'host' });
  return { host, credentials: await host.next('hosted') };
}

test('chat signaling requires independent consent, rejects forged relays, and leaves a concurrent desktop session intact', async t => {
  const crypto = require('node:crypto'), { client, service } = await fixture(t, { iceServers: [] });
  async function registered(name) { const c = await client(); c.deviceId = crypto.randomUUID(); c.send({ type: 'register', deviceId: c.deviceId, deviceSecret: crypto.randomBytes(32).toString('base64url'), name }); c.identity = await c.next('registered'); return c; }
  const a = await registered('A'), b = await registered('B'), stranger = await registered('C');
  a.send({ type: 'join', id: b.identity.id, password: b.identity.password }); await b.next('join-request'); b.send({ type: 'accept', control: true }); const accepted=await a.next('accepted');assert.equal(accepted.peer.deviceId,b.deviceId);assert.equal(accepted.peer.name,'B');await b.next('peer-ready');
  const session = crypto.randomUUID(), data = { description: { type: 'offer', sdp: 'chat-sdp' } };
  a.send({ type: 'collab-request', session, target: b.identity.id }); const invite = await b.next('collab-invite'); assert.equal(invite.peer.deviceId, a.deviceId);
  a.send({ type: 'collab-signal', session, data }); stranger.send({ type: 'collab-accept', session });
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(b.queue.some(m => m.type === 'collab-signal'), false); assert.equal(a.queue.some(m => m.type === 'collab-accepted'), false);
  b.send({ type: 'collab-accept', session }); assert.equal((await a.next('collab-accepted')).peer.deviceId, b.deviceId); assert.equal((await b.next('collab-accepted')).offerer, false);
  stranger.send({ type: 'collab-signal', session, data }); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(b.queue.some(m => m.type === 'collab-signal'), false);
  a.send({ type: 'collab-signal', session, data }); assert.deepEqual((await b.next('collab-signal')).data, data);
  a.send({ type: 'collab-leave', session }); await b.next('collab-ended'); assert.equal(service.rooms.get(b.identity.id).approved, true);
});
test('a host fixed password survives re-registration while consent remains required', async t => {
  const { client } = await fixture(t);
  const host = await client(), guest = await client();
  const identity = { type: 'register', deviceId: require('node:crypto').randomUUID(), deviceSecret: 'f'.repeat(43), password: 'Fixed password 123' };
  host.send(identity); const first = await host.next('registered');
  assert.equal(first.password, identity.password); assert.equal(first.fixedPassword, true);
  host.send(identity); const second = await host.next('registered'); assert.equal(second.id, first.id); assert.equal(second.password, first.password);
  guest.send({ type: 'join', id: first.id, password: identity.password }); await guest.next('waiting'); assert.equal((await host.next('join-request')).fixedPassword, true);
  assert.equal(guest.queue.some(m => m.type === 'accepted'), false);
  host.send({ type: 'reject' }); await guest.next('ended');
  host.send({ ...identity, password: '' }); const random = await host.next('registered'); assert.notEqual(random.password, identity.password); assert.equal(random.fixedPassword, false);
});
test('direct IP listener requires its private host token and password, then approval', async t => {
  const hostToken = 'test-local-host-only-token';
  const { client } = await fixture(t, { directHostToken: hostToken, iceServers: [] });
  const host = await client(), guest = await client();
  guest.send({ type: 'host' }); assert.match((await guest.next('error')).message, /local device/);
  guest.send({ type: 'register', deviceId: 'guest', deviceSecret: 'x'.repeat(32) });
  assert.match((await guest.next('error')).message, /local host/);
  host.send({ type: 'register', hostToken, deviceId: require('node:crypto').randomUUID(), deviceSecret: 's'.repeat(43) });
  const credentials = await host.next('registered');
  guest.send({ type: 'join', id: 'direct', password: 'wrong' }); assert.match((await guest.next('error')).message, /درست نیست/);
  guest.send({ type: 'join', id: 'direct', password: credentials.password, name: 'LAN viewer' });
  await guest.next('waiting'); await host.next('join-request');
  assert.equal(guest.queue.some(m => m.type === 'accepted'), false);
  host.send({ type: 'accept', control: false });
  assert.deepEqual((await guest.next('ice')).iceServers, []);
  await guest.next('accepted'); await host.next('peer-ready');
  guest.send({ type: 'end-session' }); await host.next('peer-left');
  guest.send({ type: 'join', id: 'direct', password: credentials.password });
  await guest.next('waiting'); await host.next('join-request');
  host.send({ type: 'reject' }); await guest.next('ended');
});
test('credentials, consent gate, bidirectional signaling, guest departure and password revocation', async t => {
  const { client, service } = await fixture(t);
  const { host, credentials } = await hosted(client), guest = await client();
  assert.match(credentials.id, /^\d{9}$/); assert.match(credentials.password, /^[\w-]{8}$/);
  guest.send({ ...credentials, type: 'join', name: 'Viewer' });
  await guest.next('waiting');
  assert.equal((await host.next('join-request')).name, 'Viewer');
  const offer = { description: { type: 'offer', sdp: 'test-offer' } };
  guest.send({ type: 'signal', data: offer });
  await new Promise(r => setTimeout(r, 50));
  assert.equal(host.queue.some(m => m.type === 'signal'), false);
  guest.send({ type: 'accept' }); // only the host can approve
  await new Promise(r => setTimeout(r, 30));
  assert.equal(service.rooms.get(credentials.id).approved, false);
  host.send({ type: 'accept', control: false });
  assert.equal((await guest.next('accepted')).control, false); await host.next('peer-ready');
  host.send({ type: 'signal', data: offer }); assert.deepEqual((await guest.next('signal')).data, offer);
  const candidate = { candidate: { candidate: 'candidate:test', sdpMid: '0' } };
  guest.send({ type: 'signal', data: candidate }); assert.deepEqual((await host.next('signal')).data, candidate);
  guest.send({ type: 'leave' }); await host.next('peer-left');
  assert.equal(service.rooms.get(credentials.id).guest, null);
  guest.send({ ...credentials, type: 'join' }); await guest.next('waiting'); await host.next('join-request');
  host.send({ type: 'reject' }); await guest.next('ended');
  host.send({ type: 'leave' });
  guest.send({ ...credentials, type: 'join' }); assert.match((await guest.next('error')).message, /درست نیست/);
});
test('wrong credentials, malformed payloads and brute force throttling', async t => {
  const { client } = await fixture(t), { credentials } = await hosted(client), guest = await client();
  guest.ws.send('not json'); assert.match((await guest.next('error')).message, /نامعتبر/);
  guest.ws.send('null'); guest.ws.send('[]');
  for (let i = 0; i < 5; i++) {
    guest.send({ type: 'join', id: credentials.id, password: 'wrong' });
    assert.match((await guest.next('error')).message, /درست نیست/);
  }
  guest.send({ ...credentials, type: 'join' }); assert.match((await guest.next('error')).message, /تلاش زیاد/);
});
test('unexpected host disconnect ends guest session and removes room', async t => {
  const { client, service } = await fixture(t), { host, credentials } = await hosted(client), guest = await client();
  guest.send({ ...credentials, type: 'join' }); await guest.next('waiting'); await host.next('join-request');
  host.send({ type: 'accept', control: true }); assert.equal((await guest.next('accepted')).control, true);
  host.ws.close(); await guest.next('ended'); assert.equal(service.rooms.size, 0);
  guest.send({ type: 'host' }); assert.match((await guest.next('hosted')).id, /^\d{9}$/);
});
test('unrelated client cannot relay into an approved session; second guest is refused', async t => {
  const { client } = await fixture(t), { host, credentials } = await hosted(client), guest = await client(), intruder = await client();
  guest.send({ ...credentials, type: 'join' }); await guest.next('waiting'); await host.next('join-request');
  host.send({ type: 'accept', control: false }); await guest.next('accepted'); await host.next('peer-ready');
  intruder.send({ ...credentials, type: 'join' }); assert.match((await intruder.next('error')).message, /در حال اتصال/);
  intruder.send({ type: 'signal', data: { description: { type: 'offer', sdp: 'injected' } } });
  guest.send({ type: 'signal', data: { description: { type: 'offer', sdp: 42 } } });
  await new Promise(r => setTimeout(r, 50)); assert.equal(host.queue.some(m => m.type === 'signal'), false);
});

test('additional viewers have isolated consent and signaling; first viewer departure preserves the others', async t => {
  const crypto = require('node:crypto'), { client } = await fixture(t,{iceServers:[]});
  const host=await client(); host.send({type:'register',deviceId:crypto.randomUUID(),deviceSecret:crypto.randomBytes(32).toString('base64url'),multiDesktop:true}); const credentials=await host.next('registered');
  const first=await client(), second=await client(), stranger=await client();
  first.send({...credentials,type:'join'}); await host.next('join-request'); host.send({type:'accept',control:false}); await first.next('accepted'); await host.next('peer-ready');
  second.send({...credentials,type:'join'}); const invite=await host.next('desktop-invite'); assert.match(invite.session,/^[a-f0-9-]{36}$/);
  const data={description:{type:'offer',sdp:'second-viewer-offer'}};
  stranger.send({type:'desktop-accept',session:invite.session,control:true}); second.send({type:'signal',data}); await new Promise(r=>setTimeout(r,30)); assert.equal(host.queue.some(m=>m.type==='desktop-signal'),false);
  host.send({type:'desktop-accept',session:invite.session,control:true}); assert.equal((await second.next('accepted')).control,true); await host.next('desktop-ready');
  second.send({type:'signal',data}); assert.equal((await host.next('desktop-signal')).session,invite.session); assert.equal(first.queue.some(m=>m.type==='signal'),false);
  first.send({type:'end-session'}); await host.next('peer-left'); host.send({type:'desktop-signal',session:invite.session,data}); assert.equal((await second.next('signal')).data.description.sdp,data.description.sdp);
  host.send({type:'desktop-end',session:invite.session}); await second.next('ended');
});
test('occupied port rejects cleanly instead of raising an unhandled WebSocketServer error', async t => {
  const { service } = await fixture(t);
  const second = createSignalingServer({ port: service.server.address().port, host: '127.0.0.1' });
  await assert.rejects(second.listen(), { code: 'EADDRINUSE' });
  await second.close();
});
test('two registered devices keep their own IDs across outgoing sessions and reconnect', async t => {
  const crypto = require('node:crypto');
  const { client, service } = await fixture(t), host = await client(), guest = await client();
  const hostIdentity = { deviceId: crypto.randomUUID(), deviceSecret: crypto.randomBytes(32).toString('base64url') };
  const guestIdentity = { deviceId: crypto.randomUUID(), deviceSecret: crypto.randomBytes(32).toString('base64url') };
  host.send({ type: 'register', ...hostIdentity }); const first = await host.next('registered');
  guest.send({ type: 'register', ...guestIdentity }); const second = await guest.next('registered');
  assert.notEqual(first.id, second.id); assert.equal(service.rooms.size, 2);
  guest.send({ type: 'join', id: first.id, password: first.password }); await guest.next('waiting'); await host.next('join-request');
  host.send({ type: 'accept', control: false }); await guest.next('accepted'); await host.next('peer-ready');
  guest.send({ type: 'end-session' }); await host.next('peer-left');
  assert.equal(service.rooms.size, 2); assert.equal(service.rooms.get(first.id).guest, null);
  guest.send({ type: 'join', id: first.id, password: first.password }); await guest.next('waiting'); await host.next('join-request');
  host.send({ type: 'reject' }); await guest.next('ended');
  const reconnected = await client(); reconnected.send({ type: 'register', ...hostIdentity });
  const resumed = await reconnected.next('registered'); assert.equal(resumed.id, first.id); assert.notEqual(resumed.password, first.password);
  guest.send({ type: 'join', id: first.id, password: first.password }); assert.match((await guest.next('error')).message, /درست نیست/);
});
test('connection key is checked before retrieving or disclosing managed TURN credentials', async t => {
  let calls = 0;
  const { client, service } = await fixture(t, { enrollmentKey: 'test-connection-key-with-32-characters', iceServers: () => { calls++; return [{ urls: 'turn:example.invalid', username: 'temporary', credential: 'temporary-only' }]; } });
  await client(); assert.equal(calls, 1);
  const intruder = new WebSocket(`ws://127.0.0.1:${service.server.address().port}`);
  t.after(() => intruder.terminate());
  const received = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Authentication test timed out')), 2000);
    intruder.on('message', raw => { const m = JSON.parse(raw); received.push(m); if (m.type === 'hello') intruder.send(JSON.stringify({ type: 'authenticate', serverKey: 'incorrect' })); });
    intruder.on('close', () => { clearTimeout(timer); resolve(); });
  });
  assert.equal(calls, 1); assert.equal(received.some(m => m.type === 'ready'), false);
  assert.equal(JSON.stringify(received).includes('temporary-only'), false);
  assert.match(received.find(m => m.type === 'error').message, /connection key/);
});

test('disconnect causes distinguish host intent, approval denial and unexpected transport loss',async t=>{const{client}=await fixture(t,{iceServers:[]});for(const mode of ['manual','denied','network','failure']){const{host,credentials}=await hosted(client),guest=await client();guest.send({type:'join',id:credentials.id,password:credentials.password});await host.next('join-request');if(mode==='denied')host.send({type:'reject'});else{host.send({type:'accept',control:true});await guest.next('accepted');if(mode==='network')host.ws.terminate();else host.send({type:'end-session',...(mode==='failure'?{reason:'transport-failed'}:{})});}const ended=await guest.next('ended');assert.equal(ended.retryable,['network','failure'].includes(mode));assert.equal(ended.reasonCode,mode==='manual'?'host-ended':mode==='denied'?'approval-denied':mode==='failure'?'transport-failed':'host-disconnected');host.ws.close();guest.ws.close();}});
