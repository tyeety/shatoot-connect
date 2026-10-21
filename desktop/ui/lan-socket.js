'use strict';
(() => {
  const sockets = new Map(), api = window.shatootconnect;
  api.onLANSocket(event => {
    const socket = sockets.get(event.id); if (!socket) return;
    if (event.type === 'open') { socket.readyState = 1; socket.onopen?.(); }
    if (event.type === 'message') socket.onmessage?.({ data: JSON.stringify(event.data) });
    if (event.type === 'error') socket.onerror?.({ message: event.message });
    if (event.type === 'close') { socket.readyState = 3; sockets.delete(event.id); socket.onclose?.(); }
  });
  window.LANSocket = class {
    constructor(endpoint) {
      this.id = crypto.randomUUID(); this.readyState = 0; sockets.set(this.id, this);
      api.lanOpen(this.id, endpoint).catch(error => { if (!sockets.has(this.id)) return; this.readyState = 3; sockets.delete(this.id); this.onerror?.(error); this.onclose?.(); });
    }
    send(message) { if (this.readyState !== 1) throw new Error('LAN connection closed.'); api.lanSend(this.id, message); }
    close() { if (this.readyState >= 2) return; this.readyState = 2; api.lanClose(this.id); }
  };
})();
