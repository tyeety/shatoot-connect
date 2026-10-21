const { spawn } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'tools', 'relay-fixture.exe');
const fixture = spawn(executable, [], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
fixture.stderr.on('data', data => require('node:fs').appendFileSync(path.join(root, 'artifacts/turn-fixture.log'), data));
let started = false;
const timeout = setTimeout(() => { console.error('TURN fixture startup timed out'); fixture.kill(); process.exitCode = 1; }, 5000);
fixture.on('error', error => { clearTimeout(timeout); console.error(error.message); process.exitCode = 1; });
fixture.stdout.on('data', data => {
  if (started) return;
  let ready; try { ready = JSON.parse(data.toString()); } catch { return; }
  started = true; clearTimeout(timeout);
  const smoke = spawn(require('electron'), ['.', '--smoke-test'], {
    cwd: root, windowsHide: true, stdio: 'inherit',
    env: { ...process.env, SHATOOTCONNECT_SMOKE_ICE: JSON.stringify([{ urls: `turn:${ready.host}:${ready.port}?transport=udp`, username: 'local-test-user', credential: 'local-test-password' }]) }
  });
  smoke.on('exit', code => { fixture.kill(); process.exitCode = code || 0; });
  smoke.on('error', error => { fixture.kill(); console.error(error.message); process.exitCode = 1; });
});
