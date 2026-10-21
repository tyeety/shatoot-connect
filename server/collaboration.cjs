'use strict';
const { validSignal } = require('../shared/protocol.cjs');
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function collaborationBroker({ rooms, send, ice, direct }) {
  const sessions = new Map();
  function end(id, reason) { const s = sessions.get(id); if (!s) return; clearTimeout(s.timer); sessions.delete(id); for (const ws of [s.from, s.to]) send(ws, { type: 'collab-ended', session: id, reason }); }
  const identity = (ws, fallback) => ({ ...require('../shared/profile.cjs').profile(ws.deviceProfile || fallback), deviceId: ws.deviceId || fallback.deviceId, name: ws.deviceName || String(fallback.name || 'Computer').slice(0, 60), id: ws.registrationId || null });
  async function handle(ws, m) {
    if (typeof m.type !== 'string' || !m.type.startsWith('collab-')) return false;
    if (!UUID.test(m.session)) return true;
    const fail = reason => send(ws, { type: 'collab-ended', session: m.session, reason });
    if (m.type === 'collab-request') {
      if ((!direct && !ws.registrationId) || !UUID.test(ws.deviceId || m.deviceId)) { fail('Register your device before starting chat.'); return true; }
      if (sessions.has(m.session)) return true;
      if (sessions.size >= 500 || [...sessions.values()].filter(s => s.from === ws || s.to === ws).length >= 16) { fail('Chat connection limit reached.'); return true; }
      const room = direct && m.target === 'direct' ? [...rooms.values()][0] : rooms.get(String(m.target));
      if (!room || room.host === ws) { fail('Chat destination is offline or unavailable.'); return true; }
      if ([...sessions.values()].filter(s => s.from === room.host || s.to === room.host).length >= 16) { fail('Chat destination is busy.'); return true; }
      const session = { from: ws, to: room.host, accepted: false, fromPeer: identity(ws, m), toPeer: identity(room.host, {}) };
      if (!UUID.test(session.toPeer.deviceId)) { fail('The destination must update Shatoot Connect.'); return true; }
      session.timer = setTimeout(() => end(m.session, 'Chat invitation timed out.'), 60000); session.timer.unref(); sessions.set(m.session, session);
      send(room.host, { type: 'collab-invite', session: m.session, peer: session.fromPeer });
    } else {
      const session = sessions.get(m.session); if (!session || (ws !== session.from && ws !== session.to)) return true;
      if (m.type === 'collab-accept' && ws === session.to && !session.accepted && !session.accepting) {
        session.accepting = true;
        try {
          const config = await ice(); if (sessions.get(m.session) !== session) return true;
          session.accepted = true; clearTimeout(session.timer);
          send(session.from, { type: 'collab-accepted', session: m.session, offerer: true, peer: session.toPeer, ...config });
          send(session.to, { type: 'collab-accepted', session: m.session, offerer: false, peer: session.fromPeer, ...config });
        } catch { end(m.session, 'Chat connection configuration failed.'); }
      } else if (m.type === 'collab-signal' && session.accepted && validSignal(m.data)) {
        send(ws === session.from ? session.to : session.from, { type: 'collab-signal', session: m.session, data: m.data });
      } else if (m.type === 'collab-reject' && ws === session.to && !session.accepted) end(m.session, 'Chat invitation declined.');
      else if (m.type === 'collab-leave') end(m.session, 'Chat connection closed.');
    }
    return true;
  }
  return { handle, detach: ws => { for (const [id, s] of sessions) if (s.from === ws || s.to === ws) end(id, 'Chat peer disconnected.'); }, close: () => { for (const id of sessions.keys()) end(id, 'Server stopped.'); }, sessions };
}
module.exports = { collaborationBroker };
