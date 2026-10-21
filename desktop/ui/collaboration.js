'use strict';
(() => {
  const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  class CollaborationClient {
    constructor({ api, self, internet, ensureInternet, changed = () => {}, error = () => {}, progress = () => {} }) {
      Object.assign(this, { api, self, internet, ensureInternet, changed, error, progress }); this.sessions = new Map(); this.fileQueue = Promise.resolve(); this.catalog = { contacts: [], groups: [], conversations: [] }; this.ready = this.refresh();
    }
    async refresh() { this.catalog = await this.api.collaboration('list'); this.notify(); }
    notify() { this.changed(); }
    peer(id) { return [...this.sessions.values()].find(s => !s.closed && s.peer?.deviceId === id && s.channel?.readyState === 'open'); }
    group(id) { return this.catalog.groups.find(g => g.id === id); }
    connected() { return [...new Map([...this.sessions.values()].filter(s => !s.closed && s.channel?.readyState === 'open').map(s => [s.peer.deviceId, s.peer])).values()]; }
    session(id, route, peer) {
      if (this.sessions.size >= 16) throw new Error('Chat connection limit reached.');
      const s = { id, route, peer, candidates: [], pending: new Map(), sequence: 0, queue: Promise.resolve(), signaling: Promise.resolve(), groups: new Set(), declined: new Set(), frames: new Map() };
      s.promise = new Promise((resolve, reject) => { s.resolve = resolve; s.reject = reject; }); s.promise.catch(() => {});
      s.timer = setTimeout(() => this.close(s, 'Chat invitation timed out.'), 65000); this.sessions.set(id, s); this.notify(); return s;
    }
    async connect(destination) {
      await this.ready;
      if (destination.deviceId && this.peer(destination.deviceId)) return this.peer(destination.deviceId);
      const pending = [...this.sessions.values()].find(s => !s.closed && destination.deviceId && s.peer?.deviceId === destination.deviceId); if (pending) return pending.promise;
      const id = crypto.randomUUID(); let route;
      if (destination.type === 'lan') {
        const endpoint = await this.api.directEndpoint(destination.address), ws = new window.LANSocket(endpoint);
        route = { type: 'lan', address: destination.address, send: data => ws.send(JSON.stringify(data)), socket: ws };
        const s = this.session(id, route, destination.deviceId ? { deviceId: destination.deviceId, name: destination.name || 'Computer' } : null);
        ws.onerror = () => this.close(s, 'LAN connection failed. Check the address, firewall and VPN LAN access.');
        ws.onclose = () => this.close(s, 'Chat connection closed.');
        ws.onmessage = event => {
          let message; try { message = JSON.parse(event.data); } catch { return; }
          if (message.type === 'ready') {
            if (!message.features?.includes('collaboration-v1') || !message.direct) { this.close(s, 'Update Shatoot Connect on the other computer.'); return; }
            route.send({ type: 'collab-request', session: id, target: 'direct', ...this.self });
          } else if (message.type?.startsWith('collab-')) this.receive(message, route);
        };
        return s.promise;
      }
      await this.ensureInternet();
      for (let n = 0; !this.internet().registered && n < 100; n++) await pause(100);
      const context = this.internet();
      if (!context.registered || !context.supported) throw new Error('Update and connect to the Internet server to chat by ID.');
      if (destination.endpoint && destination.endpoint !== context.endpoint) throw new Error('Connect to this contact’s saved server in Settings first.');
      const address = String(destination.address).replace(/\s/g, ''); if (!/^\d{9}$/.test(address)) throw new Error('Enter a 9-digit ID or a LAN IP.');
      route = { type: 'id', address, endpoint: context.endpoint, send: context.send };
      const s = this.session(id, route, destination.deviceId ? { deviceId: destination.deviceId, name: destination.name || 'Computer' } : null);
      route.send({ type: 'collab-request', session: id, target: address, ...this.self }); return s.promise;
    }
    receive(message, route) {
      if (!message || !UUID.test(message.session)) return;
      if (message.type === 'collab-invite') {
        if (this.sessions.has(message.session) || !UUID.test(message.peer?.deviceId) || message.peer.deviceId === this.self.deviceId) return;
        if (this.peer(message.peer.deviceId) || this.sessions.size >= 16) { route.send({ type: 'collab-reject', session: message.session }); return; }
        const s = this.session(message.session, route, message.peer);
        this.api.collaboration('approve', { session: s.id, peer: s.peer }).then(accepted => {
          if (s.closed) { this.api.collaboration('end', { session: s.id }).catch(() => {}); return; }
          route.send({ type: accepted ? 'collab-accept' : 'collab-reject', session: s.id });
          if (!accepted) this.close(s, 'Chat invitation declined.');
        }).catch(error => this.close(s, error.message)); return;
      }
      const s = this.sessions.get(message.session); if (!s || s.closed) return;
      if (message.type === 'collab-ended') { this.close(s, message.reason || 'Chat connection closed.', false); return; }
      s.signaling = s.signaling.then(async () => {
        if (s.closed) return;
        if (message.type === 'collab-accepted') {
          if (!UUID.test(message.peer?.deviceId) || (s.peer && s.peer.deviceId !== message.peer.deviceId)) throw new Error('The chat device identity changed.');
          s.peer = message.peer;
          await this.api.collaboration('grant', { session: s.id, peer: s.peer });
          await this.api.collaboration('contact', { peer: s.peer, route: s.route.type === 'incoming-lan' ? null : { type: s.route.type, address: s.route.address || s.peer.id, endpoint: s.route.endpoint } });
          await this.makePeer(s, message); await this.refresh();
        } else if (message.type === 'collab-signal' && s.pc) {
          const data = message.data;
          if (data.description) { await s.pc.setRemoteDescription(data.description); for (const candidate of s.candidates.splice(0)) await s.pc.addIceCandidate(candidate); if (data.description.type === 'offer') { await s.pc.setLocalDescription(); s.route.send({ type: 'collab-signal', session: s.id, data: { description: s.pc.localDescription.toJSON() } }); } }
          else if (data.candidate) { if (s.pc.remoteDescription) await s.pc.addIceCandidate(data.candidate); else s.candidates.push(data.candidate); }
        }
      }).catch(error => this.close(s, error.message));
    }
    async makePeer(s, configuration) {
      if (s.pc) throw new Error('Duplicate chat acceptance.');
      const pc = s.pc = new RTCPeerConnection({ iceServers: s.route.type === 'id' ? configuration.iceServers || [] : [], iceTransportPolicy: s.route.type === 'id' && configuration.forceRelay ? 'relay' : 'all' });
      pc.onicecandidate = event => { if (event.candidate && !s.closed) { try { s.route.send({ type: 'collab-signal', session: s.id, data: { candidate: event.candidate.toJSON() } }); } catch (error) { this.error(error.message); } } };
      pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) this.close(s, 'Chat connection failed. Restricted networks may require TURN.'); this.notify(); };
      pc.ondatachannel = event => { if (event.channel.label === 'collaboration-v1' && !s.channel) this.bind(s, event.channel); else event.channel.close(); };
      if (configuration.offerer) { this.bind(s, pc.createDataChannel('collaboration-v1', { ordered: true, priority: 'low' })); await pc.setLocalDescription(); s.route.send({ type: 'collab-signal', session: s.id, data: { description: pc.localDescription.toJSON() } }); }
    }
    bind(s, channel) {
      s.channel = channel; channel.bufferedAmountLowThreshold = 131072;
      channel.onopen = () => { clearTimeout(s.timer); s.resolve(s); this.notify(); this.flush(s).catch(e => this.error(e.message)); };
      channel.onclose = () => this.close(s, 'Chat connection closed.');
      channel.onmessage = event => {
        if (typeof event.data !== 'string' || event.data.length > 64000) return this.close(s, 'Invalid chat packet.');
        let packet; try { packet = JSON.parse(event.data); } catch { return; }
        if (packet.frame != null) {
          if (!Number.isSafeInteger(packet.frame) || !Number.isInteger(packet.index) || !Number.isInteger(packet.total) || packet.total < 1 || packet.total > 512 || typeof packet.chunk !== 'string' || packet.chunk.length > 8192) return this.close(s, 'Invalid chat frame.');
          let frame = s.frames.get(packet.frame);
          if (!frame) { if (packet.index !== 0 || s.frames.size >= 4) return this.close(s, 'Invalid chat frame.'); frame = { next: 0, total: packet.total, bytes: '', timer: setTimeout(() => this.close(s, 'Chat frame timed out.'), 15000) }; s.frames.set(packet.frame, frame); }
          if (frame.next !== packet.index || frame.total !== packet.total) return this.close(s, 'Invalid chat frame.');
          frame.next++; frame.bytes += packet.chunk; if (frame.bytes.length > 3100000) return this.close(s, 'Chat packet is too large.');
          if (frame.next !== frame.total) return; clearTimeout(frame.timer); s.frames.delete(packet.frame);
          try { packet = JSON.parse(frame.bytes); } catch { return this.close(s, 'Invalid chat packet.'); }
        }
        if (packet.reply != null) { const pending = s.pending.get(packet.reply); if (pending) { clearTimeout(pending.timer); s.pending.delete(packet.reply); packet.error ? pending.reject(new Error(packet.error)) : pending.resolve(packet.value); } return; }
        if (!Number.isSafeInteger(packet.id) || typeof packet.op !== 'string') return;
        s.queue = s.queue.then(async () => {
          if (s.closed) return;
          try { const value = await this.request(s, packet.op, packet.value); if (!s.closed) this.raw(s, { reply: packet.id, value }); }
          catch (error) { if (!s.closed) this.raw(s, { reply: packet.id, error: String(error.message).slice(0, 300) }); }
        }).catch(error => this.close(s, error.message));
      };
    }
    raw(s, packet) {
      if (s.closed || s.channel?.readyState !== 'open') throw new Error('Chat connection closed.');
      const text = JSON.stringify(packet); if (text.length > 3100000) throw new Error('Chat packet is too large.');
      if (text.length <= 56000) { s.channel.send(text); return; }
      const frame = ++s.sequence, total = Math.ceil(text.length / 8192);
      for (let index = 0; index < total; index++) s.channel.send(JSON.stringify({ frame, index, total, chunk: text.slice(index * 8192, (index + 1) * 8192) }));
    }
    rpc(s, op, value) {
      if (s.closed || s.channel?.readyState !== 'open') return Promise.reject(new Error('Chat connection closed.'));
      if (s.pending.size >= 32) return Promise.reject(new Error('Chat request limit reached.'));
      const id = ++s.sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { s.pending.delete(id); reject(new Error('Chat operation timed out.')); }, op === 'begin' ? 120000 : 30000);
        s.pending.set(id, { resolve, reject, timer }); try { this.raw(s, { id, op, value }); } catch (error) { clearTimeout(timer); s.pending.delete(id); reject(error); }
      });
    }
    normalize(s, message) {
      if (!message || !UUID.test(message.sender) || !UUID.test(message.id) || typeof message.conversation !== 'string') throw new Error('Invalid chat message.');
      const result = { id: message.id, conversation: message.conversation, sender: message.sender, name: '', kind: message.kind, text: message.text, at: message.at };
      if (message.conversation === `p:${this.self.deviceId}` && message.sender === s.peer.deviceId) { result.conversation = `p:${s.peer.deviceId}`; result.name = s.peer.name; return result; }
      const group = this.group(message.conversation.slice(2));
      if (!message.conversation.startsWith('g:') || !group || !group.members.some(m => m.deviceId === message.sender) || (group.owner !== s.peer.deviceId && (group.owner !== this.self.deviceId || message.sender !== s.peer.deviceId))) throw new Error('Invalid group message.');
      result.name = group.members.find(m => m.deviceId === message.sender).name;
      if (group.owner === this.self.deviceId) result.pending = group.members.map(m => m.deviceId).filter(id => id !== this.self.deviceId && id !== message.sender);
      return result;
    }
    async request(s, op, value) {
      if (op === 'group') {
        if (value?.owner !== s.peer.deviceId) throw new Error('Only the group owner can invite members.');
        if (!this.group(value.id) && !await this.api.collaboration('approve-group', { session: s.id, group: value })) return false;
        await this.api.collaboration('group', value); await this.refresh(); return true;
      }
      if (op === 'message') {
        const now = Date.now(); if (!s.textRate || now - s.textRate.at > 10000) s.textRate = { at: now, count: 0 }; if (++s.textRate.count > 100) throw new Error('Too many chat messages.');
        const message = this.normalize(s, value); if (message.kind !== 'text') throw new Error('Invalid text message.');
        await this.api.collaboration('append', { message }); await this.refresh();
        for (const id of message.pending || []) { const next = this.peer(id); if (next) this.flush(next).catch(e => this.error(e.message)); }
        return true;
      }
      if (op === 'begin') {
        const message = this.normalize(s, value?.message); if (message.kind !== 'file') throw new Error('Invalid file message.');
        s.incomingFile = message; const result = await this.api.collaborationFiles(s.id, 'begin', { entries: value.entries, message }); this.progress({ conversation: message.conversation, text: 'Receiving files…' }); return result;
      }
      if (['write', 'end-file', 'cancel'].includes(op)) return this.api.collaborationFiles(s.id, op, value);
      if (op === 'finish') {
        const result = await this.api.collaborationFiles(s.id, 'finish'); const message = s.incomingFile; s.incomingFile = null; await this.refresh(); this.progress({ conversation: message?.conversation, text: 'Files received. Open the attachment to find them.' });
        const group = message?.conversation.startsWith('g:') && this.group(message.conversation.slice(2));
        if (group?.owner === this.self.deviceId) this.forwardFile(group, message, result.attachment).catch(error => this.error(error.message));
        return { count: result.count };
      }
      throw new Error('Unknown chat request.');
    }
    async send(conversation, text) {
      await this.ready; if (typeof text !== 'string' || !text.trim() || text.length > 8000) throw new Error('Enter a message of up to 8000 characters.');
      const group = conversation.startsWith('g:') && this.group(conversation.slice(2));
      const pending = group ? (group.owner === this.self.deviceId ? group.members.map(m => m.deviceId).filter(id => id !== this.self.deviceId) : [group.owner]) : [conversation.slice(2)];
      const message = { id: crypto.randomUUID(), conversation, sender: this.self.deviceId, name: this.self.name, kind: 'text', text: text.trim(), at: Date.now(), pending };
      await this.api.collaboration('append', { message, outgoing: true }); await this.refresh();
      for (const id of pending) { const s = this.peer(id); if (s) this.flush(s).catch(error => this.error(error.message)); }
      return message;
    }
    async announceGroup(s, group) {
      if (s.groups.has(group.id)) return true; if (s.declined.has(group.id)) return false;
      if (group.owner !== this.self.deviceId) return true;
      const accepted = await this.rpc(s, 'group', group); if (accepted) s.groups.add(group.id); else s.declined.add(group.id); return accepted;
    }
    async flush(s) {
      if (s.flushing) { s.flushAgain = true; return; } if (s.closed) return; s.flushing = true;
      try {
        do {
        s.flushAgain = false;
        const messages = await this.api.collaboration('pending', { peer: s.peer.deviceId });
        for (const message of messages) {
          if (message.kind !== 'text') continue;
          const group = message.conversation.startsWith('g:') && this.group(message.conversation.slice(2));
          if (group && !await this.announceGroup(s, group)) continue;
          await this.rpc(s, 'message', this.wire(message)); await this.api.collaboration('delivered', { id: message.id, peer: s.peer.deviceId });
        }
        await this.refresh();
        } while (s.flushAgain && !s.closed);
      } finally { s.flushing = false; }
    }
    wire(message) { return { id: message.id, conversation: message.conversation, sender: message.sender, name: message.name, kind: message.kind, text: message.text, at: message.at }; }
    async createGroup(name, members) {
      if (typeof name !== 'string' || !name.trim() || name.length > 60) throw new Error('Enter a group name of up to 60 characters.');
      const peers = [...new Set(members)].map(id => this.peer(id)?.peer); if (peers.some(p => !p) || peers.length < 2 || peers.length > 15) throw new Error('Select 2 to 15 connected contacts.');
      const group = { id: crypto.randomUUID(), name, owner: this.self.deviceId, members: [this.self, ...peers].map(p => ({ deviceId: p.deviceId, name: p.name })) };
      const accepted = [];
      for (const peer of peers) if (await this.rpc(this.peer(peer.deviceId), 'group', group)) accepted.push(peer);
      if (!accepted.length) throw new Error('No contact accepted the group invitation.');
      group.members = [this.self, ...accepted].map(p => ({ deviceId: p.deviceId, name: p.name }));
      await this.api.collaboration('group', group);
      for (const peer of accepted) { const s = this.peer(peer.deviceId); await this.rpc(s, 'group', group); s.groups.add(group.id); }
      await this.refresh(); return group;
    }
    sendFiles(conversation, selection = 'pick', value) {
      const operation = this.fileQueue.then(() => this.sendSelectedFiles(conversation, selection, value)); this.fileQueue = operation.catch(() => {}); return operation;
    }
    async sendSelectedFiles(conversation, selection = 'pick', value) {
      const group = conversation.startsWith('g:') && this.group(conversation.slice(2));
      const ids = group ? (group.owner === this.self.deviceId ? group.members.map(m => m.deviceId).filter(id => id !== this.self.deviceId) : [group.owner]) : [conversation.slice(2)];
      const targets = ids.map(id => this.peer(id)); if (targets.some(s => !s)) throw new Error('All file recipients must be connected. Connect them and try again.');
      const first = targets[0]; if (!first) throw new Error('Connect to a contact first.');
      const entries = selection === 'drop' ? await this.api.collaborationDrop(first.id, value) : await this.api.collaborationFiles(first.id, selection, value); if (!entries.length) return;
      const message = { id: crypto.randomUUID(), conversation, sender: this.self.deviceId, name: this.self.name, kind: 'file', text: entries.slice(0, 12).map(e => e.name).join('\n').slice(0, 7800) + (entries.length > 12 ? `\n+ ${entries.length - 12}` : ''), at: Date.now(), pending: ids };
      await this.api.collaboration('append', { message, outgoing: true }); await this.refresh();
      for (const s of targets) {
        if (group && !await this.announceGroup(s, group)) continue;
        try { await this.transfer(s, entries, message, first); await this.api.collaboration('delivered', { id: message.id, peer: s.peer.deviceId }); }
        catch (error) { this.error(`${s.peer.name}: ${error.message}`); }
      }
      await this.refresh();
    }
    async transfer(s, entries, message, source = s) {
      if (s.sendingFile) throw new Error('A file transfer is already in progress.'); s.sendingFile = true;
      try {
        await this.rpc(s, 'begin', { entries, message: this.wire(message) }); const total = entries.reduce((n, e) => n + e.size, 0); let sent = 0, reported = 0;
        for (let index = 0; index < entries.length; index++) {
          const entry = entries[index]; let offset = 0, hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; const pending = new Set();
          while (offset < entry.size) {
            if (s.closed) throw new Error('Chat connection closed.');
            while (s.channel.bufferedAmount > 262144) { if (s.closed) throw new Error('Chat connection closed.'); await pause(10); }
            const chunk = await this.api.collaborationFiles(source.id, 'read', { id: entry.id, offset }); if (!chunk.length) throw new Error('The source file could not be read.');
            const request = this.rpc(s, 'write', { index, offset, bytes: chunk.bytes }); pending.add(request); request.then(() => pending.delete(request), () => {});
            offset += chunk.length; sent += chunk.length; if (chunk.hash) hash = chunk.hash;
            if (Date.now() - reported > 400) { reported = Date.now(); this.progress({ conversation: message.conversation, text: 'Transferring files…', percent: Math.floor(sent / Math.max(1, total) * 100) }); }
            if (pending.size >= 2) await Promise.race(pending);
          }
          await Promise.all(pending); await this.rpc(s, 'end-file', { index, hash });
        }
        await this.rpc(s, 'finish'); this.progress({ conversation: message.conversation, text: 'Files sent.' });
      } catch (error) { if (!s.closed) await this.rpc(s, 'cancel').catch(() => {}); throw error; }
      finally { s.sendingFile = false; }
    }
    forwardFile(group, message, attachment) {
      const operation = this.fileQueue.then(() => this.forwardReceivedFile(group, message, attachment)); this.fileQueue = operation.catch(() => {}); return operation;
    }
    async forwardReceivedFile(group, message, attachment) {
      for (const member of group.members) {
        if ([this.self.deviceId, message.sender].includes(member.deviceId)) continue;
        const s = this.peer(member.deviceId); if (!s) { this.error('A group file recipient is offline. The file remains in the group owner’s history.'); continue; }
        try { if (!await this.announceGroup(s, group)) continue; const entries = await this.api.collaborationFiles(s.id, 'received-sources', attachment); await this.transfer(s, entries, message); await this.api.collaboration('delivered', { id: message.id, peer: s.peer.deviceId }); }
        catch (error) { this.error(`${member.name}: ${error.message}`); }
      }
    }
    close(s, reason = 'Chat connection closed.', notifyRemote = true) {
      if (!s || s.closed) return; s.closed = true; clearTimeout(s.timer);
      if (notifyRemote) try { s.route.send({ type: 'collab-leave', session: s.id }); } catch {}
      s.pc?.close(); s.route.socket?.close(); for (const p of s.pending.values()) { clearTimeout(p.timer); p.reject(new Error(reason)); } for (const f of s.frames.values()) clearTimeout(f.timer);
      s.pending.clear(); s.frames.clear(); s.reject(new Error(reason)); this.sessions.delete(s.id); this.api.collaboration('end', { session: s.id }).catch(() => {}); this.notify();
    }
  }
  window.CollaborationClient = CollaborationClient;
})();
