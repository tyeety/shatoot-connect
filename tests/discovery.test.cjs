'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { Discovery } = require('../desktop/discovery.cjs');
const { localAddress, interfaces, sourceAddress } = require('../shared/network.cjs');

test('VPN discovery probes the company network from saved IPs without scanning broad VPN routes', () => {
  const { discoveryTargets } = require('../desktop/discovery.cjs');
  const targets = discoveryTargets(['192.168.1.14:8788', '192.168.1.63', '8.8.8.8', '127.0.0.1'], [{address:'192.168.8.252',netmask:'255.255.255.0'}, {address:'10.8.0.2',netmask:'255.0.0.0'}]);
  assert(targets.includes('192.168.1.99'));
  assert(!targets.includes('192.168.8.252'));
  assert(!targets.includes('192.168.1.0'));
  assert(!targets.includes('192.168.1.255'));
  assert(!targets.some(ip => ip.startsWith('10.') || ip.startsWith('8.') || ip.startsWith('127.')));
  assert.equal(new Set(targets).size, targets.length);
  const seeds = Array.from({length:6}, (_,i)=>`10.${i}.0.2`);
  assert.equal(discoveryTargets(seeds, []).length, 1016);
  assert(discoveryTargets(seeds, [], 4).includes('10.5.0.99'));
});

test('VPN sweep discovers an unsaved peer and refresh keeps it alive between sweeps', async t => {
  const discovery = new Discovery({ identity:{deviceId:crypto.randomUUID()}, networkInterfaces:()=>({}), knownEndpoints:()=>['192.168.1.14:8788'], neighbors:false });
  t.after(()=>discovery.close());
  const id = crypto.randomUUID(), calls=[];
  discovery.probe = async address => {
    calls.push(address);
    if(address==='192.168.1.99') discovery.ingest(Buffer.from(JSON.stringify({service:'ShatootConnect',version:1,deviceId:id,name:'Company',port:8788})),address);
  };
  discovery.refresh();
  for(let i=0;i<50 && discovery.sweeping;i++) await new Promise(r=>setImmediate(r));
  assert.equal(discovery.snapshot().peers[0].endpoints[0], '192.168.1.99:8788');
  calls.length=0; discovery.knownProbeAt=0; discovery.refresh();
  await new Promise(r=>setImmediate(r));
  assert(calls.includes('192.168.1.99'));
  assert(!calls.includes('192.168.1.98'));
  discovery.close(); calls.length=0; discovery.refresh(); assert.equal(calls.length,0);
});
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
