'use strict';
const net = require('node:net');
function ipv4(value) { if (net.isIP(value) !== 4) return null; return value.split('.').reduce((n, part) => ((n << 8) | Number(part)) >>> 0, 0); }
function localAddress(value) {
  const n = ipv4(value); if (n === null) return false;
  return (n >>> 24) === 10 || (n >>> 24) === 127 || (n >>> 20) === 0xac1 || (n >>> 16) === 0xc0a8 || (n >>> 16) === 0xa9fe || (n >>> 22) === 0x191;
}
function interfaces(networks = require('node:os').networkInterfaces()) {
  return Object.entries(networks).flatMap(([name, values]) => (values || []).filter(n => (n.family === 'IPv4' || n.family === 4) && !n.internal && localAddress(n.address) && ipv4(n.netmask) !== null).map(n => ({ name, address: n.address, netmask: n.netmask, broadcast: ((ipv4(n.address) | ~ipv4(n.netmask)) >>> 0).toString(16).padStart(8, '0').match(/../g).map(b => parseInt(b, 16)).join('.') })));
}
function sourceAddress(remote, networks) {
  const ip = ipv4(remote); if (ip === null) return undefined;
  return interfaces(networks).filter(n => ((ipv4(n.address) & ipv4(n.netmask)) >>> 0) === ((ip & ipv4(n.netmask)) >>> 0)).sort((a, b) => ipv4(b.netmask) - ipv4(a.netmask))[0]?.address;
}
module.exports = { ipv4, localAddress, interfaces, sourceAddress };
