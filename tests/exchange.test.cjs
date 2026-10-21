const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { Transfers } = require('../desktop/transfers.cjs');
test('exchange protocol synchronizes Unicode text, waits before paste and transfers multi-chunk files in both directions', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shatoot-exchange-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const code = await fs.readFile(path.join(__dirname, '../desktop/ui/exchange.js'), 'utf8');
  const channels = [{ readyState: 'open' }, { readyState: 'open' }], states = [], exchanges = [];
  for (let i = 0; i < 2; i++) {
    const state = { transfers: new Transfers(path.join(root, String(i))), seq: 1, text: '', files: [] }; states.push(state);
    const api = { exchange: async (op, value) => {
      if (op === 'clipboard-read') return { seq: state.seq, text: state.text, files: !!state.files.length };
      if (op === 'clipboard-write') { state.text = value; state.files = []; return { seq: ++state.seq }; }
      if (op === 'clipboard-sources') return state.transfers.offer(state.files);
      if (op === 'sources') return state.transfers.offer(value);
      if (op === 'finish') { state.received = await state.transfers.finish(); if(state.failClipboard)return {count:state.received.length,clipboardReady:false}; state.files = state.received; state.text = ''; return { seq: ++state.seq }; }
      if (op === 'end-file') return state.transfers.endFile(value);
      if (op === 'stop' || op === 'cancel') return state.transfers.reset();
      return state.transfers[op](value);
    } };
    const window = { shatootconnect: api }; vm.runInNewContext(code, { window, Map, Set, Promise, JSON, Error, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask });
    exchanges.push(new window.SessionExchange(channels[i], () => {}));
  }
  channels.forEach((channel, i) => { channel.send = data => { assert.ok(Buffer.byteLength(data) < 65536); queueMicrotask(() => channels[1 - i].onmessage({ data })); }; });
  t.after(() => exchanges.forEach(e => e.close()));
  await Promise.all(exchanges.map(e => e.poll())); assert.ok(exchanges.every(e=>e.started),'already-open channels must initialize without a later open event');
  states[0].text = 'متن فارسی\nEnglish 🫐'.repeat(12000); states[0].seq++; await exchanges[0].flushClipboard(); assert.equal(states[1].text, states[0].text);
  const bytes = crypto.randomBytes(640123), file = path.join(root, 'اطلاعات.bin'); await fs.writeFile(file, bytes);
  states[0].files = [file]; states[0].seq++; await exchanges[0].flushClipboard();
  assert.deepEqual(await fs.readFile(states[1].files[0]), bytes);
  const other = path.join(root, 'response.txt'); await fs.writeFile(other, 'پاسخ');
  await exchanges[1].sendFiles('sources', [other]); assert.equal(await fs.readFile(states[0].files[0], 'utf8'), 'پاسخ');
  states[1].text = 'Text after files'; states[1].files = []; states[1].seq++; await exchanges[1].poll(); assert.equal(states[0].text, states[1].text);
  states[0].failClipboard=true;const result=await exchanges[1].sendFiles('sources',[file]);assert.equal(result.clipboardReady,false);assert.deepEqual(await fs.readFile(states[0].received[0]),bytes);assert.equal(exchanges[0].receiving,false);
});
