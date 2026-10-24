const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { validSignal } = require('../shared/protocol.cjs');
const { IdentityStore } = require('./identity-store.cjs');

function createSignalingServer({ port = 8787, host = '0.0.0.0', iceServers = [], tls, identityFile, forceRelay = false, enrollmentKey, directHostToken, presence, deviceProfile } = {}) {
  const identities = new IdentityStore(identityFile);
  const rooms = new Map(), attempts = new Map(), connections = new Map();
  const handler = (req, res) => {
    if (req.url === '/presence' && directHostToken && presence) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(presence())); return; }
    if (req.url === '/profile' && directHostToken && deviceProfile) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(deviceProfile())); return; }
    res.writeHead(req.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(req.url === '/health' ? { ok: true, service: 'ShatootConnect signaling' } : { error: 'Not found' }));
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  const wss = new WebSocketServer({ server, maxPayload: 110000, perMessageDeflate: false });
  const ice = async () => ({ iceServers: typeof iceServers === 'function' ? await iceServers() : iceServers, forceRelay });
  // HTTP listen errors are also forwarded to WSS. The listen promise handles them.
  wss.on('error', () => {});
  const send = (ws, data) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  const collaboration = require('./collaboration.cjs').collaborationBroker({ rooms, send, ice, direct: !!directHostToken });
  const desktops = require('./desktop-sessions.cjs').desktopSessions({ rooms, send, ice, direct: !!directHostToken });
  function detach(ws, keepRegistration = false) {
    const room = rooms.get(ws.roomId);
    if (!room) {
      if (!keepRegistration && ws.registrationId) { rooms.delete(ws.registrationId); ws.registrationId = null; }
      return;
    }
    if (room.host === ws) {
      send(room.guest, { type: 'ended', reason: 'میزبان اشتراک‌گذاری را متوقف کرد.' });
      if (room.guest) room.guest.roomId = null;
      if (keepRegistration && ws.registrationId === room.id) { room.guest = null; room.approved = false; }
      else { rooms.delete(room.id); ws.registrationId = null; }
    } else if (room.guest === ws) {
      room.guest = null; room.approved = false;
      if (room.host.registrationId) room.host.roomId = null;
      send(room.host, { type: 'peer-left' });
    }
    ws.roomId = null;
    if (!keepRegistration && ws.registrationId) { rooms.delete(ws.registrationId); ws.registrationId = null; }
  }
  wss.on('connection', (ws, req) => {
    // Use the socket address: an untrusted X-Forwarded-For must not bypass throttling.
    const ip = req.socket.remoteAddress;
    const localProxy = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
    if (wss.clients.size > 2000 || (connections.get(ip) || 0) >= (localProxy ? 1000 : 12)) { ws.close(1008, 'Too many connections'); return; }
    connections.set(ip, (connections.get(ip) || 0) + 1);
    ws.alive = true; ws.messages = 0;
    ws.on('pong', () => { ws.alive = true; });
    let ready = false, authenticating = false;
    const handshakeTimeout = setTimeout(() => { if (!ready) ws.close(1008, 'Handshake timed out'); }, 20000);
    async function prepare() {
      if (authenticating || ready) return; authenticating = true;
      try { const config = await ice(); ready = true; send(ws, { type: 'ready', service: 'ShatootConnect', protocol: 2, features: ['fixed-password', 'collaboration-v1'], direct: !!directHostToken, ...config }); }
      catch { send(ws, { type: 'error', message: 'Internet relay configuration failed. Contact the server administrator.' }); ws.close(1011, 'TURN unavailable'); }
    }
    if (enrollmentKey) send(ws, { type: 'hello', service: 'ShatootConnect', protocol: 2, requiresKey: true });
    else prepare();
    ws.on('message', async raw => {
      if (++ws.messages > 150) { ws.close(1008, 'Rate limit'); return; }
      let m;
      try { m = JSON.parse(raw); } catch { send(ws, { type: 'error', message: 'پیام نامعتبر است.' }); return; }
      if (!m || typeof m !== 'object') return;
      const fail = message => send(ws, { type: 'error', message });
      if (!ready) {
        if (enrollmentKey && m.type === 'authenticate') {
          const received = crypto.createHash('sha256').update(typeof m.serverKey === 'string' ? m.serverKey.slice(0, 256) : '').digest();
          const expected = crypto.createHash('sha256').update(enrollmentKey).digest();
          if (!crypto.timingSafeEqual(received, expected)) { fail('The server connection key is incorrect. Import the client connection file from Server Manager.'); ws.close(1008, 'Invalid connection key'); return; }
          prepare();
        }
        return;
      }
      if (await collaboration.handle(ws, m)) return;
      if (await desktops.handle(ws,m)) return;
      if (m.type === 'hosting-busy') { if (ws.registrationId && typeof m.busy === 'boolean') ws.desktopBusy = m.busy; return; }
      if (m.type === 'profile') { if (ws.deviceId) { ws.deviceProfile = require('../shared/profile.cjs').profile(m); ws.deviceName = ws.deviceProfile.name || ws.deviceName; } return; }
      if (m.type === 'register') {
        if (directHostToken && (m.hostToken !== directHostToken || !localProxy)) return fail('Direct listeners only register their local host.');
        if (m.password != null && (typeof m.password !== 'string' || (m.password.length > 0 && m.password.length < 8) || m.password.length > 128)) return fail('A fixed password must be 8 to 128 characters.');
        if (ws.roomId || ws.desktopSession) return fail('Finish the active session before registering.');
        if (ws.deviceId && ws.deviceId !== m.deviceId) return fail('A connection cannot change its device identity.');
        if (rooms.size >= 1000 && !ws.registrationId) return fail('Server capacity reached.');
        let id;
        try { id = identities.register(m.deviceId, m.deviceSecret); } catch (e) { return fail(e.message); }
        const previous = rooms.get(id);
        if (previous && previous.host !== ws) { detach(previous.host); previous.host.close(1000, 'Device reconnected'); }
        const password = m.password || crypto.randomBytes(6).toString('base64url');
        rooms.set(id, { id, host: ws, guest: null, approved: false, fixedPassword: !!m.password, hash: crypto.createHash('sha256').update(password).digest() });
        ws.registrationId = id;
        ws.deviceId = m.deviceId;
        ws.deviceName = typeof m.name === 'string' ? m.name.slice(0, 60) : 'Computer';
        ws.deviceProfile = require('../shared/profile.cjs').profile(m);
        ws.multiDesktop = m.multiDesktop === true;
        send(ws, { type: 'registered', id, password, fixedPassword: !!m.password });
      } else if (m.type === 'host') {
        if (directHostToken) return fail('Direct listeners only host their local device.');
        if (ws.roomId || ws.desktopSession) return fail('ابتدا اتصال فعلی را ببندید.');
        if (rooms.size >= 1000) return fail('سرور پر است.');
        let id; do { id = String(crypto.randomInt(100000000, 1000000000)); } while (rooms.has(id));
        const password = crypto.randomBytes(6).toString('base64url');
        rooms.set(id, { id, host: ws, guest: null, approved: false,
          hash: crypto.createHash('sha256').update(password).digest() });
        ws.roomId = id;
        send(ws, { type: 'hosted', id, password });
      } else if (m.type === 'join') {
        if (ws.roomId || ws.desktopSession) return fail('ابتدا اتصال فعلی را ببندید.');
        const now = Date.now();
        const attemptKey = localProxy ? ws : ip;
        let a = attempts.get(attemptKey);
        if (!a || now - a.start > 60000) { a = { start: now, count: 0 }; attempts.set(attemptKey, a); }
        if (++a.count > 5) return fail('تلاش زیاد؛ یک دقیقه صبر کنید.');
        const room = directHostToken && m.id === 'direct' ? [...rooms.values()][0] : rooms.get(String(m.id));
        const hash = crypto.createHash('sha256').update(typeof m.password === 'string' ? m.password.slice(0, 128) : '').digest();
        if (!room || !crypto.timingSafeEqual(room.hash, hash)) return fail('شناسه یا رمز اتصال درست نیست.');
        if (room.host === ws) return fail('این میزبان در حال اتصال است.');
        if (room.guest || room.host.desktopBusy || (room.host.registrationId && room.host.roomId)) { if (!room.host.multiDesktop) return fail('این میزبان در حال اتصال است.'); await desktops.join(ws,m,room); return; }
        room.guest = ws; ws.roomId = room.id;
        if (room.host.registrationId) room.host.roomId = room.id;
        send(ws, { type: 'waiting' });
        send(room.host, { type: 'join-request', fixedPassword: room.fixedPassword === true, peer:{deviceId:ws.deviceId||m.deviceId},name: typeof m.name === 'string' ? m.name.slice(0, 60) : 'دستگاه مهمان' });
      } else if (m.type === 'accept' || m.type === 'reject') {
        const room = rooms.get(ws.registrationId || ws.roomId);
        if (room?.host !== ws || !room.guest || room.approved) return;
        if (m.type === 'reject') {
          send(room.guest, { type: 'ended', reason: 'میزبان درخواست را نپذیرفت.' });
          room.guest.roomId = null; room.guest = null;
          if (ws.registrationId) ws.roomId = null;
        } else {
          if (room.accepting) return; room.accepting = true;
          const guest = room.guest;
          let config;
          try { config = await ice(); }
          catch { room.accepting = false; return fail('Internet relay credentials are unavailable. Try again or contact the administrator.'); }
          room.accepting = false;
          if (room.guest !== guest || rooms.get(room.id) !== room) return;
          room.approved = true;
          send(guest, { type: 'ice', ...config }); send(room.host, { type: 'ice', ...config });
          send(guest, { type:'accepted',peer:{...room.host.deviceProfile,deviceId:room.host.deviceId,id:room.id,name:room.host.deviceName},control:m.control===true });
          send(room.host, { type: 'peer-ready' });
        }
      } else if (m.type === 'signal') {
        const room = rooms.get(ws.roomId);
        if (!room?.approved || !validSignal(m.data)) return;
        send(room.host === ws ? room.guest : room.host, { type: 'signal', data: m.data });
      } else if (m.type === 'end-session') detach(ws, true);
      else if (m.type === 'leave' || m.type === 'unregister') { desktops.detach(ws); detach(ws); }
    });
    ws.on('error', () => {});
    ws.on('close', () => { desktops.detach(ws); collaboration.detach(ws); clearTimeout(handshakeTimeout); attempts.delete(ws); connections.set(ip, Math.max(0, (connections.get(ip) || 1) - 1)); detach(ws); });
  });
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false; ws.messages = 0; ws.ping();
    }
    for (const [ip, a] of attempts) if (Date.now() - a.start > 60000) attempts.delete(ip);
    for (const [ip, count] of connections) if (!count) connections.delete(ip);
  }, 15000);
  timer.unref();
  server.on('close', () => clearInterval(timer));
  return {
    server, rooms,
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.removeListener('error', reject); resolve(server.address()); }); }),
    close: () => new Promise(resolve => { desktops.close(); collaboration.close(); clearInterval(timer); for (const ws of wss.clients) ws.terminate(); wss.close(() => server.close(resolve)); })
  };
}
if (require.main === module) {
  let iceServers;
  try { iceServers = JSON.parse(process.env.SHATOOTCONNECT_ICE_SERVERS || '[]'); }
  catch { console.error('SHATOOTCONNECT_ICE_SERVERS must be a JSON array'); process.exit(1); }
  if (!Array.isArray(iceServers)) { console.error('ICE configuration must be an array'); process.exit(1); }
  const service = createSignalingServer({ port: Number(process.env.PORT || 8787), host: process.env.HOST || '0.0.0.0', iceServers });
  service.listen().then(a => console.log(`ShatootConnect signaling listening on ${a.address}:${a.port}`)).catch(e => { console.error(e.message); process.exit(1); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => service.close().then(() => process.exit(0)));
}
module.exports = { createSignalingServer };
