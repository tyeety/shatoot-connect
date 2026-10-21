// Real Chromium focus-thread interoperability; no keystrokes are injected.
// Run: npx electron tests/keyboard-probe.cjs
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const profile = path.resolve(__dirname, '../artifacts/keyboard-profile');
fs.mkdirSync(profile, { recursive: true }); app.setPath('userData', profile);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 360, height: 170, alwaysOnTop: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  let child;
  try {
    await win.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><body style="font:14px sans-serif;padding:20px">Keyboard layout compatibility check<input autofocus placeholder="No keys are injected"></body>'));
    win.focus(); await win.webContents.executeJavaScript('document.querySelector("input").focus()');
    await new Promise(resolve => setTimeout(resolve, 150));
    if (!win.isFocused()) throw new Error('Isolated Chromium keyboard fixture is not focused.');
    child = spawn(path.resolve(__dirname, '../native/publish/ShatootConnect.Input.exe'), [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => errors += chunk);
    child.stdin.end([{ type: 'layout', layout: '00000409' }, { type: 'layout', layout: '00000429' }, { type: 'layout-stop' }].map(m => JSON.stringify(m)).join('\n') + '\n');
    const code = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Keyboard helper timed out')), 5000); child.once('error', reject); child.once('exit', code => { clearTimeout(timer); resolve(code); }); });
    const results = output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    if (code !== 0 || errors || results.length !== 2 || results.some(result => result.type !== 'layout-status' || !result.ok)) throw new Error(`Chromium keyboard layout verification failed: ${output} ${errors}`);
    console.log('CHROMIUM_KEYBOARD_LAYOUTS', JSON.stringify(results));
  } catch (error) { console.error(error.stack); app.exitCode = 1; }
  finally { child?.stdin.end(); if (!win.isDestroyed()) win.destroy(); app.exit(app.exitCode || 0); }
});
