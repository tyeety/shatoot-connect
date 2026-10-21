const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { WebSocket } = require('ws');
const { readConfig } = require('../server/standalone.cjs');

function configFile(t, value) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ShatootConnect server test '));
  t.after(() => {
    if (path.dirname(path.resolve(folder)) !== path.resolve(os.tmpdir()) || !path.basename(folder).startsWith('ShatootConnect server test ')) throw new Error('Unexpected temporary directory');
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const file = path.join(folder, 'server.config.json'); fs.writeFileSync(file, JSON.stringify(value));
  return file;
}
test('standalone configuration validates input and respects explicit environment overrides', t => {
  const file = configFile(t, { port: 48761, host: '127.0.0.1', iceServers: [] });
  assert.deepEqual(readConfig(file, {}), { port: 48761, host: '127.0.0.1', iceServers: [] });
  assert.deepEqual(readConfig(file, { PORT: '12345', HOST: '0.0.0.0', SHATOOTCONNECT_ICE_SERVERS: '[{"urls":"stun:example.invalid"}]' }),
    { port: 12345, host: '0.0.0.0', iceServers: [{ urls: 'stun:example.invalid' }] });
  assert.throws(() => readConfig(file, { PORT: '65536' }), /Port/);
  assert.throws(() => readConfig(file, { PORT: '1.5' }), /Port/);
  assert.throws(() => readConfig(file, { SHATOOTCONNECT_ICE_SERVERS: '[{"urls":42}]' }), /iceServers/);
});
test('standalone process starts from config, serves health, and issues a compatible host ID', async t => {
  const file = configFile(t, { port: 0, host: '127.0.0.1', iceServers: [] });
  const env = { ...process.env }; for (const key of ['PORT', 'HOST', 'SHATOOTCONNECT_ICE_SERVERS']) delete env[key];
  const bundle = process.env.SHATOOTCONNECT_SERVER_BUNDLE;
  const runtime = bundle ? path.join(bundle, 'node.exe') : process.execPath;
  const entrypoint = bundle ? path.join(bundle, 'server/standalone.cjs') : path.resolve(__dirname, '../server/standalone.cjs');
  const child = spawn(runtime, [entrypoint, file], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode !== null) return;
    await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 5000);
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk; const match = output.match(/Listening on 127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
    child.once('error', e => { clearTimeout(timeout); reject(e); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Unexpected exit ${code}`)); });
  });
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/health`)).json(), { ok: true, service: 'ShatootConnect signaling' });
  const ws = new WebSocket(`ws://127.0.0.1:${port}`); t.after(() => ws.terminate());
  const hosted = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Host registration timed out')), 3000);
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.type === 'ready') ws.send(JSON.stringify({ type: 'host' }));
      if (m.type === 'hosted') { clearTimeout(timeout); resolve(m); }
    });
    ws.on('error', e => { clearTimeout(timeout); reject(e); });
  });
  assert.match(hosted.id, /^\d{9}$/); assert.match(hosted.password, /^[\w-]{8}$/);
});
