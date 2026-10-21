'use strict';
const dgram = require('node:dgram');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { localAddress, interfaces, sourceAddress } = require('../shared/network.cjs');
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const GROUP = '239.255.87.89', PORT = 8789;

class Discovery extends EventEmitter {
  constructor({ identity, name, port, discoveryPort = PORT, networkInterfaces, neighbors = process.platform === 'win32', ttl = 20000 } = {}) {
    super(); Object.assign(this, { identity, name, port, discoveryPort, networkInterfaces, neighbors, ttl });
    this.peers = new Map(); this.senders = new Map(); this.errors = new Set(); this.closed = false; this.lastReply = new Map();
  }
  presence() { return { service: 'ShatootConnect', version: 1, kind: 'presence', deviceId: this.identity.deviceId, name: String(this.name).slice(0, 60), port: this.port, capabilities: ['desktop', 'chat', 'files', 'groups'] }; }
  snapshot() { return { peers: [...this.peers.values()].map(p => ({ ...p, endpoints: [...p.endpoints.keys()] })), interfaces: interfaces(this.networkInterfaces?.()), errors: [...this.errors] }; }
  publish() { if (!this.closed) this.emit('change', this.snapshot()); }
  ingest(data, remote) {
    if (!localAddress(remote) || !Buffer.isBuffer(data) || data.length > 1400) return;
    let value; try { value = JSON.parse(data); } catch { return; }
    if (value?.service !== 'ShatootConnect' || value.version !== 1 || !UUID.test(value.deviceId) || value.deviceId === this.identity.deviceId || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || typeof value.name !== 'string' || value.name.length > 60) return;
    if (this.peers.size >= 256 && !this.peers.has(value.deviceId)) return;
    const peer = this.peers.get(value.deviceId) || { deviceId: value.deviceId, endpoints: new Map() };
    peer.name = value.name; peer.lastSeen = Date.now(); peer.endpoints.set(`${remote}:${value.port}`, peer.lastSeen);
    for (const [endpoint, seen] of peer.endpoints) if (peer.lastSeen - seen > this.ttl || peer.endpoints.size > 8) peer.endpoints.delete(endpoint);
    this.peers.set(value.deviceId, peer); this.publish();
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
      request.on('timeout', () => request.destroy()); request.on('error', resolve);
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
    for (const sender of this.senders.values()) try { sender.close(); } catch {}
    this.senders.clear(); try { this.receiver?.close(); } catch {}
  }
}
module.exports = { Discovery, UUID };
