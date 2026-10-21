const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createSignalingServer } = require('./index.cjs');

function readConfig(filename, env = process.env) {
  const config = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Server config must be a JSON object.');
  const port = Number(env.PORT ?? config.port ?? 8787);
  const host = env.HOST ?? config.host ?? '0.0.0.0';
  const iceServers = env.SHATOOTCONNECT_ICE_SERVERS ? JSON.parse(env.SHATOOTCONNECT_ICE_SERVERS) : config.iceServers ?? [];
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
  if (typeof host !== 'string' || !host.trim()) throw new Error('Host must be a nonempty bind address.');
  if (!Array.isArray(iceServers) || iceServers.some(s => !s || typeof s !== 'object' ||
      !(typeof s.urls === 'string' || (Array.isArray(s.urls) && s.urls.length && s.urls.every(u => typeof u === 'string'))) ||
      (s.username != null && typeof s.username !== 'string') || (s.credential != null && typeof s.credential !== 'string'))) {
    throw new Error('iceServers must be an array of ICE servers with urls and optional username/credential.');
  }
  const result = { port, host, iceServers };
  if (config.enrollmentKey) {
    if (typeof config.enrollmentKey !== 'string' || config.enrollmentKey.length < 24 || config.enrollmentKey.length > 256) throw new Error('The server connection key must be 24 to 256 characters.');
    result.enrollmentKey = config.enrollmentKey;
  }
  if (config.tls?.enabled) {
    const resolve = filename => path.resolve(path.dirname(filenameConfig), filename);
    const filenameConfig = filename;
    if (!config.tls.certPath || !config.tls.keyPath) throw new Error('TLS requires both certPath and keyPath.');
    result.tls = { cert: fs.readFileSync(resolve(config.tls.certPath)), key: fs.readFileSync(resolve(config.tls.keyPath)), minVersion: 'TLSv1.2' };
  }
  if (config.forceRelay !== undefined) result.forceRelay = config.forceRelay === true;
  if (config.turnRest) {
    const { urls, sharedSecret, ttlSeconds = 86400 } = config.turnRest;
    if (!Array.isArray(urls) || !urls.length || !urls.every(u => /^turns?:/.test(u)) || typeof sharedSecret !== 'string' || sharedSecret.length < 24) throw new Error('TURN REST requires valid TURN URLs and a shared secret of at least 24 characters.');
    result.iceServers = () => {
      const username = `${Math.floor(Date.now() / 1000) + Math.max(600, Math.min(86400, ttlSeconds))}:${require('node:crypto').randomBytes(8).toString('hex')}`;
      const credential = require('node:crypto').createHmac('sha1', sharedSecret).update(username).digest('base64');
      return [...iceServers, { urls, username, credential }];
    };
  }
  if (config.managedTurn?.enabled) {
    if (!result.enrollmentKey) throw new Error('Managed TURN requires a server connection key. Save configuration through Server Manager.');
    if (config.managedTurn.provider !== 'cloudflare') throw new Error('Unsupported managed TURN provider.');
    result.iceServers = require('./managed-turn.cjs').cloudflareTurnProvider(config.managedTurn);
  }
  return result;
}
async function start(filename) {
  const service = createSignalingServer({ ...readConfig(filename), identityFile: path.join(path.dirname(filename), 'devices.json') });
  let address;
  try { address = await service.listen(); }
  catch (error) {
    await service.close();
    if (error.code === 'EADDRINUSE') throw new Error('Port is already in use. Change port in server.config.json, or use the already-running ShatootConnect server.');
    throw error;
  }
  const urls = address.address === '0.0.0.0' || address.address === '::'
    ? ['127.0.0.1', ...Object.values(os.networkInterfaces()).flat().filter(n => n.family === 'IPv4' && !n.internal).map(n => n.address)]
    : [address.address.includes(':') ? `[${address.address}]` : address.address];
  console.log('\nShatootConnect Server is ready. Keep this window open.');
  console.log(`Listening on ${address.address}:${address.port}`);
  console.log('In both ShatootConnect apps, enter the SAME reachable server address:');
  for (const ip of [...new Set(urls)]) console.log(`  ws://${ip}:${address.port}`);
  console.log('\n127.0.0.1 works only on the server computer.');
  console.log('Clients automatically register an ID when connected. No capture starts before host approval.');
  console.log('For internet access, use a WSS reverse proxy and configure STUN/TURN.');
  console.log(`Health check: http://127.0.0.1:${address.port}/health`);
  console.log('Stop: Ctrl+C\n');
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    if (closing) return; closing = true;
    service.close().then(() => process.exit(0));
  });
  return service;
}
if (require.main === module) {
  if (process.argv[2] === '--check-config') {
    try { readConfig(path.resolve(process.argv[3])); console.log('Configuration valid.'); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  } else start(path.resolve(process.argv[2] || path.join(__dirname, '../server.config.json')))
    .catch(error => { console.error(`\nShatootConnect Server could not start: ${error.message}`); process.exitCode = 1; });
}
module.exports = { readConfig, start };
