'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { Discovery } = require('../desktop/discovery.cjs');
const { localAddress, interfaces, sourceAddress } = require('../shared/network.cjs');
test('known LAN computers publish wallpaper without chat or screen approval; legacy screenshots are ignored',async t=>{
 const{createSignalingServer}=require('../server/index.cjs');let previewKind='wallpaper',requests=0;
 const deviceId=crypto.randomUUID(),preview='data:image/jpeg;base64,YWJj';let port;
 const server=createSignalingServer({host:'127.0.0.1',port:0,directHostToken:'test-token',presence:()=>({service:'ShatootConnect',version:1,kind:'presence',deviceId,name:'Nearby',port}),deviceProfile:async()=>{requests++;return{deviceId,name:'Nearby',preview,previewKind};}});
 port=(await server.listen()).port;
 t.after(()=>server.close());
 const discovery=new Discovery({identity:{deviceId:crypto.randomUUID()},networkInterfaces:()=>({}),knownEndpoints:()=>[`127.0.0.1:${port}`],neighbors:false});t.after(()=>discovery.close());
 const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('Wallpaper profile timeout');};
 discovery.refresh();await wait(()=>discovery.snapshot().peers[0]?.preview===preview);assert.equal(requests,1);assert.equal(discovery.snapshot().peers[0].previewKind,'wallpaper');
 previewKind='screenshot';discovery.peers.clear();discovery.knownProbeAt=0;discovery.refresh();await wait(()=>requests===2);await new Promise(r=>setTimeout(r,50));assert.equal(discovery.snapshot().peers[0].preview,undefined);
});
test('LAN interface selection keeps physical, VPN and link-local networks, choosing the most specific route', () => {
  const networks = { WiFi: [{ family: 'IPv4', internal: false, address: '192.168.1.4', netmask: '255.255.255.0' }], VPN: [{ family: 'IPv4', internal: false, address: '10.8.0.2', netmask: '255.0.0.0' }], Tail: [{ family: 'IPv4', internal: false, address: '100.77.1.1', netmask: '255.192.0.0' }], Link: [{ family: 'IPv4', internal: false, address: '169.254.10.1', netmask: '255.255.0.0' }] };
  assert.equal(interfaces(networks).length, 4); assert.equal(interfaces(networks)[0].broadcast, '192.168.1.255');
  assert.equal(sourceAddress('192.168.1.20', networks), '192.168.1.4'); assert.equal(sourceAddress('10.9.1.9', networks), '10.8.0.2'); assert.equal(sourceAddress('100.80.1.4', networks), '100.77.1.1');
  assert.equal(localAddress('8.8.8.8'), false); assert.equal(localAddress('100.127.255.254'), true); assert.equal(localAddress('100.128.0.1'), false); assert.equal(localAddress('192.168.1.5.evil'), false);
});
test('actual UDP discovery accepts valid peers, deduplicates addresses and drops malformed/public advertisements', async t => {
  const discovery = new Discovery({ identity: { deviceId: crypto.randomUUID() }, name: 'Test', port: 8788, discoveryPort: 0, neighbors: false, networkInterfaces: () => ({}) });
  await discovery.start(); t.after(() => discovery.close());
  const sender = dgram.createSocket('udp4'); sender.bind(0, '127.0.0.1'); await once(sender, 'listening'); t.after(() => sender.close());
  const presence = { service: 'ShatootConnect', version: 1, kind: 'presence', deviceId: crypto.randomUUID(), name: 'دستگاه تست', port: 8788 };
  const changed = once(discovery, 'change'); sender.send(Buffer.from(JSON.stringify(presence)), discovery.receiver.address().port, '127.0.0.1'); await changed;
  assert.equal(discovery.snapshot().peers.length, 1); assert.equal(discovery.snapshot().peers[0].endpoints[0], '127.0.0.1:8788');
  discovery.ingest(Buffer.from(JSON.stringify(presence)), '192.168.1.12'); assert.equal(discovery.snapshot().peers.length, 1); assert.equal(discovery.snapshot().peers[0].endpoints.length, 2);
  discovery.ingest(Buffer.from(JSON.stringify({ ...presence, deviceId: crypto.randomUUID() })), '8.8.8.8'); discovery.ingest(Buffer.alloc(1500), '127.0.0.1'); discovery.ingest(Buffer.from('{}'), '127.0.0.1'); assert.equal(discovery.snapshot().peers.length, 1);
});
