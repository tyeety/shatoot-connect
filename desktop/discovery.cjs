'use strict';
const dgram = require('node:dgram');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { localAddress, interfaces, sourceAddress, ipv4 } = require('../shared/network.cjs');
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const GROUP = '239.255.87.89', PORT = 8789;

// Probe only small private networks anchored by a known computer or local NIC.
// Rotate across networks so a large address book cannot starve later entries.
function discoveryTargets(endpoints, networks, offset = 0) {
  const own = new Set(networks.map(n => n.address)), blocks = new Set();
  for (const endpoint of endpoints) {
    try { const ip = new URL(`http://${endpoint}`).hostname;
      if (localAddress(ip) && !ip.startsWith('127.') && !ip.startsWith('169.254.')) blocks.add(ip.slice(0, ip.lastIndexOf('.')));
    } catch {}
  }
  for (const nic of networks) if (nic.netmask === '255.255.255.0' && !nic.address.startsWith('169.254.')) blocks.add(nic.address.slice(0, nic.address.lastIndexOf('.')));
  const list = [...blocks], targets = [];
  for (let i = 0; i < Math.min(4, list.length); i++) {
    const block = list[(offset + i) % list.length];
    for (let host = 1; host < 255; host++) { const ip = `${block}.${host}`; if (!own.has(ip) && localAddress(ip) && ipv4(ip) !== null) targets.push(ip); }
  }
  return targets;
}

class Discovery extends EventEmitter {
  constructor({ identity, name, port, discoveryPort = PORT, networkInterfaces, neighbors = process.platform === 'win32', ttl = 20000,knownEndpoints=()=>[] } = {}) {
    super(); Object.assign(this, { identity, name, port, discoveryPort, networkInterfaces, neighbors, ttl,knownEndpoints });
    this.peers = new Map(); this.senders = new Map(); this.errors = new Set(); this.closed = false; this.lastReply = new Map(); this.requests = new Set();
  }
  presence() { return { service: 'ShatootConnect', version: 1, kind: 'presence', deviceId: this.identity.deviceId, name: String(this.name).slice(0, 60), status: this.status || 'available', port: this.port, capabilities: ['desktop', 'chat', 'files', 'groups'] }; }
  snapshot() { return { peers: [...this.peers.values()].map(p => ({ ...p, endpoints: [...p.endpoints.keys()] })), interfaces: interfaces(this.networkInterfaces?.()), errors: [...this.errors] }; }
  publish() { if (!this.closed) this.emit('change', this.snapshot()); }
  ingest(data, remote) {
    if (!localAddress(remote) || !Buffer.isBuffer(data) || data.length > 1400) return;
    let value; try { value = JSON.parse(data); } catch { return; }
    if (value?.service !== 'ShatootConnect' || value.version !== 1 || !UUID.test(value.deviceId) || value.deviceId === this.identity.deviceId || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || typeof value.name !== 'string' || value.name.length > 60) return;
    if (this.peers.size >= 256 && !this.peers.has(value.deviceId)) return;
    const peer = this.peers.get(value.deviceId) || { deviceId: value.deviceId, endpoints: new Map() };
    peer.name = value.name; peer.status = require('../shared/profile.cjs').profile(value).status; peer.lastSeen = Date.now(); peer.endpoints.set(`${remote}:${value.port}`, peer.lastSeen);
    for (const [endpoint, seen] of peer.endpoints) if (peer.lastSeen - seen > this.ttl || peer.endpoints.size > 8) peer.endpoints.delete(endpoint);
    this.peers.set(value.deviceId, peer); this.publish();
    if (value.kind === 'presence' && (!peer.profileAt || Date.now() - peer.profileAt > 30000) && (this.profileRequests || 0) < 4) this.loadProfile(peer,remote,value.port);
  }
  loadProfile(peer, address, port) {
    peer.profileAt = Date.now(); this.profileRequests = (this.profileRequests || 0) + 1;
    const request = http.get({ hostname: address, port, path: '/profile', localAddress: sourceAddress(address,this.networkInterfaces?.()), agent: false, timeout: 1500 }, response => {
      let bytes = ''; response.on('data', chunk => { bytes += chunk; if (bytes.length > 120000) request.destroy(); });
      response.on('end', () => { try { const value = JSON.parse(bytes); if (response.statusCode === 200 && !this.closed && value.deviceId === peer.deviceId && this.peers.get(peer.deviceId) === peer) { Object.assign(peer,require('../shared/profile.cjs').profile(value));if(value.previewKind==='wallpaper'&&typeof value.preview==='string'&&value.preview.length<=90000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value.preview)){peer.preview=value.preview;peer.previewKind='wallpaper';}this.publish(); } } catch {} });
      response.on('error', () => {});
    });
    request.on('close', () => { this.profileRequests--; }); request.on('timeout', () => request.destroy()); request.on('error', () => {});
  }
  async start() {
    this.receiver = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.receiver.on('error', error => { this.errors.add(error.code || 'UDP unavailable'); this.publish(); });
    this.receiver.on('message', (data, remote) => {
      this.ingest(data, remote.address);
      if (data.length > 1400 || !localAddress(remote.address)) return;
      let query; try { query = JSON.parse(data); } catch { return; }
      if (query.service !== 'ShatootConnect' || query.kind !== 'query' || query.deviceId === this.identity.deviceId || Date.now() - (this.lastReply.get(remote.address) || 0) < 1000) return;
      if (this.lastReply.size > 512) this.lastReply.clear(); this.lastReply.set(remote.address, Date.now());
      const sender = this.senders.get(sourceAddress(remote.address, this.networkInterfaces?.()));
      (sender || this.receiver).send(Buffer.from(JSON.stringify(this.presence())), remote.port, remote.address, () => {});
    });
    await new Promise(resolve => { this.receiver.once('error', resolve); this.receiver.bind(this.discoveryPort, '0.0.0.0', () => { try { this.receiver.setBroadcast(true); } catch {} resolve(); }); });
    if (this.closed) { try { this.receiver.close(); } catch {} return; }
    this.refresh(); this.timer = setInterval(() => this.refresh(), 5000); this.timer.unref();
    if (this.neighbors) { this.probeNeighbors(); this.neighborTimer = setInterval(() => this.probeNeighbors(), 30000); this.neighborTimer.unref(); }
  }
  refresh() {
    if (this.closed) return;
    const active = interfaces(this.networkInterfaces?.()), addresses = new Set(active.map(n => n.address));
    for (const [address, sender] of this.senders) if (!addresses.has(address)) { try { sender.close(); this.receiver.dropMembership(GROUP, address); } catch {} this.senders.delete(address); }
    for (const nic of active) {
      if (!this.senders.has(nic.address)) {
        const sender = dgram.createSocket('udp4'); this.senders.set(nic.address, sender);
        sender.on('error', error => { this.errors.add(`${nic.name}: ${error.code || 'UDP unavailable'}`); this.publish(); });
        sender.on('message', (data, remote) => this.ingest(data, remote.address));
        sender.bind(0, nic.address, () => {
          if (this.closed) { try { sender.close(); } catch {} return; }
          try { sender.setBroadcast(true); sender.setMulticastInterface(nic.address); sender.setMulticastTTL(1); this.receiver.addMembership(GROUP, nic.address); } catch (error) { this.errors.add(`${nic.name}: ${error.code || 'Multicast unavailable'}`); }
          this.announce(sender, nic);
        });
      } else this.announce(this.senders.get(nic.address), nic);
    }
    for (const [id, peer] of this.peers) if (Date.now() - peer.lastSeen > this.ttl) this.peers.delete(id);
    if (!this.knownProbing && Date.now() - (this.knownProbeAt || 0) >= 10000) {
      this.knownProbeAt = Date.now(); this.knownProbing = true;
      const endpoints = [...new Set([...this.knownEndpoints(), ...[...this.peers.values()].flatMap(p => [...p.endpoints.keys()])])].slice(0, 512);
      (async () => { for (let i = 0; i < endpoints.length && !this.closed; i += 16) await Promise.allSettled(endpoints.slice(i, i + 16).map(endpoint => { try { const url = new URL(`http://${endpoint}`); return this.probe(url.hostname, Number(url.port) || 8788); } catch {} })); })().catch(() => {}).finally(() => { this.knownProbing = false; });
    }
    if (!this.sweeping && Date.now() - (this.sweepAt || 0) >= 60000) {
      this.sweepAt = Date.now(); this.sweeping = true;
      const targets = discoveryTargets(this.knownEndpoints(), active, this.sweepOffset || 0); this.sweepOffset = (this.sweepOffset || 0) + 4;
      (async () => { for (let i = 0; i < targets.length && !this.closed; i += 16) await Promise.allSettled(targets.slice(i, i + 16).map(ip => this.probe(ip))); })().catch(() => {}).finally(() => { this.sweeping = false; });
    }
    this.publish();
  }
  announce(sender, nic) {
    const bytes = Buffer.from(JSON.stringify({ ...this.presence(), kind: 'query' }));
    for (const address of [GROUP, nic.broadcast]) { try { sender.send(bytes, this.discoveryPort, address, () => {}); } catch {} }
  }
  async probe(address, port = 8788) {
    if (this.closed || !localAddress(address) || !Number.isInteger(port) || port < 1 || port > 65535) return;
    await new Promise(resolve => {
      const request = http.get({ hostname: address, port, path: '/presence', localAddress: sourceAddress(address, this.networkInterfaces?.()), agent: false, timeout: 1200 }, response => {
        let data = ''; response.on('data', chunk => { data += chunk; if (data.length > 1400) request.destroy(); });
        response.on('end', () => { if (response.statusCode === 200 && !this.closed) this.ingest(Buffer.from(data), address); resolve(); });
        response.on('error', resolve);
      });
      this.requests.add(request);
      const deadline = setTimeout(() => request.destroy(), 1500);
      request.on('timeout', () => request.destroy()); request.on('error', resolve);
      request.on('close', () => { clearTimeout(deadline); this.requests.delete(request); resolve(); });
    });
  }
  probeNeighbors() {
    if (this.closed || this.probing) return; this.probing = true;
    execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'arp.exe'), ['-a'], { windowsHide: true, timeout: 5000, maxBuffer: 131072 }, async (error, output) => {
      if (!error && !this.closed) {
        const own = new Set(interfaces(this.networkInterfaces?.()).map(n => n.address));
        const addresses = [...new Set((output.match(/^\s*(\d+\.\d+\.\d+\.\d+)\s+[a-f0-9-]{17}\s+/gim) || []).map(line => line.trim().split(/\s+/)[0]))].filter(ip => localAddress(ip) && !own.has(ip)).slice(0, 128);
        for (let index = 0; index < addresses.length && !this.closed; index += 8) await Promise.allSettled(addresses.slice(index, index + 8).map(ip => this.probe(ip)));
      }
      this.probing = false;
    });
  }
  close() {
    this.closed = true; clearInterval(this.timer); clearInterval(this.neighborTimer);
    for (const request of this.requests) request.destroy();
    for (const sender of this.senders.values()) try { sender.close(); } catch {}
    this.senders.clear(); try { this.receiver?.close(); } catch {}
  }
}
module.exports = { Discovery, UUID, discoveryTargets };
