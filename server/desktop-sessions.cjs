'use strict';
const crypto = require('node:crypto');
const { validSignal } = require('../shared/protocol.cjs');
// Additional guests use separate, consent-gated sessions. Legacy first-guest
// signaling remains compatible with older clients and existing registrations.
function desktopSessions({ rooms, send, ice, direct }) {
  const sessions = new Map();
  function end(id, reason) { const s = sessions.get(id); if (!s) return; clearTimeout(s.timer); sessions.delete(id); if (s.guest.desktopSession === id) s.guest.desktopSession = null; send(s.guest, { type: 'ended', reason }); send(s.host, { type: 'desktop-ended', session: id, reason }); }
  async function join(ws, m, room) {
    if (ws.desktopSession) { send(ws, { type: 'error', message: 'End the current session first.' }); return; }
    if (!room.host.multiDesktop || [...sessions.values()].filter(s => s.host === room.host).length >= 7 || sessions.size >= 500) { send(ws, { type: 'error', message: 'The remote computer is busy.' }); return; }
    const id = crypto.randomUUID(), s = { host: room.host, guest: ws, approved: false };
    s.timer = setTimeout(() => end(id, 'Screen invitation timed out.'), 60000); s.timer.unref(); sessions.set(id,s); ws.desktopSession = id;
    send(ws, { type: 'waiting' }); send(s.host, { type: 'desktop-invite', session: id, peer:{deviceId:ws.deviceId||m.deviceId},fixedPassword: room.fixedPassword === true, name: typeof m.name === 'string' ? m.name.slice(0,60) : 'Guest' });
  }
  async function handle(ws,m) {
    if (ws.desktopSession && ['signal','end-session','leave','unregister'].includes(m.type)) {
      const id = ws.desktopSession, s = sessions.get(id); if (!s || s.guest !== ws) return true;
      if (m.type === 'signal') { if (s.approved && validSignal(m.data)) send(s.host, { type: 'desktop-signal', session: id, data: m.data }); }
      else end(id, 'Viewer disconnected.'); return true;
    }
    if (!String(m.type).startsWith('desktop-')) return false;
    const s = sessions.get(m.session); if (!s || s.host !== ws) return true;
    if (m.type === 'desktop-accept' && !s.approved && !s.accepting) {
      s.accepting = true;
      try { const config = await ice(); if (sessions.get(m.session) !== s) return true; clearTimeout(s.timer); s.approved = true; send(s.guest, { type: 'ice', ...config }); send(s.guest, { type:'accepted',peer:{...s.host.deviceProfile,deviceId:s.host.deviceId,name:s.host.deviceName,id:s.host.registrationId},control:m.control===true }); send(s.host, { type: 'desktop-ready', session: m.session, ...config }); }
      catch { end(m.session, 'Screen connection configuration failed.'); }
    } else if (m.type === 'desktop-signal' && s.approved && validSignal(m.data)) send(s.guest, { type: 'signal', data: m.data });
    else if (['desktop-reject','desktop-end'].includes(m.type)) end(m.session, 'The host ended the session.');
    return true;
  }
  return { sessions, join, handle, detach: ws => { for (const [id,s] of sessions) if (s.host === ws || s.guest === ws) end(id,'Screen peer disconnected.'); }, close: () => { for (const id of sessions.keys()) end(id,'Server stopped.'); } };
}
module.exports = { desktopSessions };
