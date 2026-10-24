'use strict';
// A separate reliable channel keeps file acknowledgements off the input channel.
window.SessionExchange = class {
  constructor(channel, report) {
    this.channel = channel; this.report = report; this.pending = new Map(); this.next = 0; this.frameId = 0; this.revision = 0; this.queue = Promise.resolve(); this.lastSeq = null;
    channel.onmessage = event => {
      if (typeof event.data !== 'string' || event.data.length > 60000) return;
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (message.frame) {
        const { frame, index, total, chunk } = message;
        if (!Number.isSafeInteger(frame) || !Number.isInteger(total) || total < 1 || total > 257 || typeof chunk !== 'string' || chunk.length > 8192) return;
        if (index === 0) this.fragment = { frame, total, next: 0, parts: [] };
        const pending = this.fragment;
        if (!pending || pending.frame !== frame || pending.total !== total || index !== pending.next) { this.fragment = null; return; }
        pending.parts.push(chunk); pending.next++;
        if (pending.next !== total) return;
        this.fragment = null;
        try { message = JSON.parse(pending.parts.join('')); } catch { return; }
        if (!message || typeof message !== 'object') return;
      }
      if (message.reply) { const p = this.pending.get(message.reply); if (p) { clearTimeout(p.timer); this.pending.delete(message.reply); message.error ? p.reject(new Error(message.error)) : p.resolve(message.value); } return; }
      this.queue = this.queue.then(async () => {
        if (this.closed) return;
        try {
          let result;
          if (message.op === 'text') { this.revision++; result = await window.shatootconnect.exchange('clipboard-write', message.value); this.lastSeq = result.seq; }
          else if (['begin','write','end-file','finish','cancel'].includes(message.op)) {
            result = await window.shatootconnect.exchange(message.op, message.value);
            if (message.op === 'begin') this.receiving = true;
            if (message.op === 'finish') { this.revision++; if(result.clipboardReady!==false)this.lastSeq=result.seq; this.clipboardSent=result.clipboardReady!==false; this.receiving=false; this.report(result.clipboardReady===false?'Files received in Downloads. Clipboard is unavailable.':'Files received in Downloads. Ready to paste.',false,{received:true,...result}); }
            if (message.op === 'cancel') this.receiving = false;
          } else throw new Error('Unknown exchange request.');
          if (!this.closed) this.send({ reply: message.id, value: result });
        } catch (error) { if (!this.closed) this.send({ reply: message.id, error: error.message }); this.report(error.message, true); }
      }).catch(error => this.report(error.message, true));
    };
    channel.onopen = () => { if(this.started || this.closed)return; this.started=true;this.poll();this.timer=setInterval(()=>this.poll(),650); };
    if(channel.readyState==='open')queueMicrotask(()=>channel.onopen());
    channel.onclose = () => this.close();
  }
  send(message) {
    const data = JSON.stringify(message);
    if (data.length > 2100000) throw new Error('Exchange message is too large.');
    if (data.length <= 10000) { this.channel.send(data); return; }
    const frame = ++this.frameId, total = Math.ceil(data.length / 8192);
    for (let index = 0; index < total; index++) this.channel.send(JSON.stringify({ frame, index, total, chunk: data.slice(index * 8192, (index + 1) * 8192) }));
  }
  rpc(op, value) {
    if (this.closed || this.channel.readyState !== 'open') return Promise.reject(new Error('File channel is closed.'));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('File exchange timed out.')); }, op === 'begin' ? 120000 : 30000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, op, value }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async poll() {
    if (this.polling || this.busy || this.receiving || this.closed) return;
    this.polling = true; const revision = this.revision; let data;
    try {
      data = await window.shatootconnect.exchange('clipboard-read');
      if (this.closed || this.receiving || revision !== this.revision || data.seq === this.lastSeq) return;
      // Opening a session does not send the previous contents of the clipboard.
      if (data.supported === false) { this.lastSeq = data.seq; return; }
      if (this.lastSeq === null) { this.lastSeq = data.seq; return; }
      if (data.files) await this.sendFiles('clipboard-sources');
      else await this.rpc('text', data.text);
      this.lastSeq = data.seq; this.clipboardSent = true;
    } catch (error) { if (data) { this.lastSeq = data.seq; this.clipboardSent = false; } if (!this.closed) this.report(error.message, true); }
    finally { this.polling = false; }
  }
  async flushClipboard() {
    if (this.busy) await this.sending;
    while (this.polling && !this.closed) await new Promise(resolve => setTimeout(resolve, 20));
    if (this.closed) throw new Error('Session ended.');
    const data = await window.shatootconnect.exchange('clipboard-read');
    if (data.supported === false) throw new Error('Copy text or files to paste.');
    if (data.files) { if (data.seq !== this.lastSeq || !this.clipboardSent) await this.sendFiles('clipboard-sources'); }
    else await this.rpc('text', data.text);
    this.clipboardSent = true; this.lastSeq = data.seq;
  }
  async sendFiles(operation, value) {
    if (this.busy) throw new Error('A file transfer is already in progress.');
    this.busy = true;
    this.sending = this.transfer(operation, value);
    try { return await this.sending; } finally { this.busy = false; this.sending = null; }
  }
  async transfer(operation, value) {
    const api = window.shatootconnect;
    try {
      const entries = operation === 'drop' ? await api.droppedFiles(value) : await api.exchange(operation, value);
      if (!entries.length) return;
      this.report('Transferring files…'); await this.rpc('begin', entries);
      const total=entries.reduce((n,e)=>n+e.size,0);let sent=0,lastProgress=0;
      for (let index = 0; index < entries.length; index++) {
        const file = entries[index]; let offset = 0, hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; const pending = new Set();
        while (offset < file.size) {
          if (this.closed) throw new Error('Session ended.');
          const chunk = await api.exchange('read', { id: file.id, offset });
          if (!chunk.length) throw new Error('The source file could not be read.');
          const request = this.rpc('write', { index, offset, bytes: chunk.bytes }); pending.add(request); request.then(() => pending.delete(request), () => {});
          offset += chunk.length;sent+=chunk.length;if(Date.now()-lastProgress>500){lastProgress=Date.now();this.report('Transferring files…',false,{percent:Math.floor(sent/Math.max(1,total)*100)});} if (chunk.hash) hash = chunk.hash;
          if (pending.size >= 4) await Promise.race(pending);
        }
        await Promise.all(pending); await this.rpc('end-file', { index, hash });
      }
      const result=await this.rpc('finish'); this.report(result.clipboardReady===false?'Files arrived in Downloads. Open received files on the other computer.':'Files sent to Downloads. Paste them on the destination.');return result;
    } catch (error) { if (!this.closed) await this.rpc('cancel').catch(() => {}); throw error; }
  }
  close() {
    if (this.closed) return; this.closed = true; clearInterval(this.timer);
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Session ended.')); } this.pending.clear();
    window.shatootconnect.exchange('stop').catch(() => {});
  }
};
