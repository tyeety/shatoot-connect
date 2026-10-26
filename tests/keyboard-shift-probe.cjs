'use strict';
// Exercise the actual Windows input helper in an isolated, explicitly focused
// Chromium text field. Never inject a key after focus leaves this fixture.
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { GuestShiftState } = require('../desktop/ui/keyboard-sync.js');
app.setPath('userData', path.resolve(__dirname, '../artifacts/keyboard-shift-profile'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 400, height: 180, title: 'Isolated Shift input test', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  let worker, output = '', errors = '';
  const pause = ms => new Promise(r => setTimeout(r, ms));
  try {
    const executable = process.env.SHATOOTCONNECT_KEYBOARD_HELPER || path.resolve(__dirname, '../native/publish/ShatootConnect.Input.exe');
    if (!fs.existsSync(executable)) throw Error('Build the native helper before running the Shift input test.');
    await win.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><title>Isolated Shift input test</title><textarea autofocus aria-label="Shift test"></textarea>'));
    win.focus(); await win.webContents.executeJavaScript('document.querySelector("textarea").focus()'); await pause(200);
    await win.webContents.executeJavaScript("window.keyEvents=[];for(const type of ['keydown','keyup','input'])document.addEventListener(type,e=>keyEvents.push({type,key:e.key,code:e.code,shift:e.shiftKey}));true");
    const focused = async () => {
      if (!win.isFocused() || !await win.webContents.executeJavaScript('document.activeElement === document.querySelector("textarea")')) throw Error('Shift fixture lost focus; no further keys will be sent.');
    };
    await focused();
    worker = spawn(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let spawnError; worker.on('error', error => { spawnError = error; });
    worker.stdout.on('data', c => output += c); worker.stderr.on('data', c => errors += c);
    for (let i = 0; i < 100 && !output.includes('input-ready'); i++) { if (spawnError) throw spawnError; if (worker.exitCode !== null) throw Error('Input helper exited early: ' + errors); await pause(30); }
    if (!output.includes('input-ready')) throw Error('Input helper did not become ready.');
    const hostActive = () => { const events = output.trim().split('\n').filter(Boolean).map(s => JSON.parse(s)).filter(e => e.type === 'host-activity'); return events.at(-1)?.active === true; };
    await pause(2500);
    for (let i = 0; i < 100 && hostActive(); i++) await pause(50);
    if (hostActive()) throw Error('Physical host input is still active; Shift test cannot inject safely.');
    output = '';
    const state = new GuestShiftState();
    const send = async packet => { await focused(); if(hostActive())throw Error('Physical host activity interrupted the Shift test; no further keys will be sent.'); worker.stdin.write(JSON.stringify({ ...packet, layout: '00000409' }) + '\n'); await pause(30); };
    const key = async (packet, shift) => { for (const p of state.packets(packet, shift)) await send(p); };
    const slash = async shift => { for (const down of [true, false]) await key({type:'physical-key',vk:0xBF,scan:0x35,extended:false,down},shift); };
    const results = [];
    async function check(name, action, expected) {
      await send({type:'release'}); state.reset();
      await win.webContents.executeJavaScript('document.querySelector("textarea").value=""');
      await action(); await pause(120);
      const text = await win.webContents.executeJavaScript('document.querySelector("textarea").value');
      assert.equal(text, expected, name); results.push({name,text});
    }
    await check('held Shift at capture start and right-side release', async () => { await slash(true); await key({type:'physical-key',vk:0xA1,scan:0x36,down:false},true); await slash(false); }, '?/');
    await check('DOM Shift down followed by native Shift up', async () => { await key({type:'key',code:'ShiftLeft',down:true},true); await slash(true); await key({type:'physical-key',vk:0xA0,scan:0x2A,down:false},true); await slash(false); }, '?/');
    await check('right Shift and missing key-up recovery', async () => { await key({type:'physical-key',vk:0xA1,scan:0x36,down:true},false); await slash(true); await slash(false); }, '?/');
    await check('release while held followed by recapture', async () => { await slash(true); await send({type:'release'}); state.reset(); await slash(true); await slash(false); }, '??/');
    if (errors || output.includes('"ok":false') || output.includes('"active":true')) throw Error('Windows input was blocked or physical host activity interrupted the test: ' + errors + output);
    console.log('SHATOOTCONNECT_SHIFT_INPUT ' + JSON.stringify(results));
  } catch (error) { console.error(error.stack); console.error('Input worker:', output, errors); if(!win.isDestroyed())console.error('Fixture events:',await win.webContents.executeJavaScript('window.keyEvents')); process.exitCode = 1; }
  finally {
    if (worker?.stdin.writable) worker.stdin.end('{"type":"release"}\n{"type":"layout-stop"}\n');
    if (worker && worker.exitCode === null) await Promise.race([new Promise(r => worker.once('exit', r)), pause(2000)]);
    if (worker && worker.exitCode === null) worker.kill();
    win.destroy(); app.exit(process.exitCode || 0);
  }
});
