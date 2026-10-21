'use strict';
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({ host, viewer, states, wait, createWindow, log, artifacts, phase = 'multi' }) => {
  const run = (win, code) => win.webContents.executeJavaScript(code);
  if (phase === 'multi') {
    const second = createWindow();
    try {
      await wait(second,'!!window.shatootconnectReady && registered');
      const credentials = await run(host,"({id:internetId.replace(/\\s/g,''),password:config.fixedPassword||hostPasswordValue})");
      await run(second,`document.querySelector('#remote-id').value=${JSON.stringify(credentials.id)};document.querySelector('#remote-password').value=${JSON.stringify(credentials.password)};joinTarget().then(()=>true)`);
      await wait(second,"window.shatootconnectDiagnostics().connection==='connected' && document.querySelector('#remote-video').videoWidth>0");
      const owner=states.get(host.webContents.id), worker=[...states.values()].find(s=>s.owner===owner);
      if (!worker?.captureAllowed || !worker.overlay?.isVisible()) throw new Error('Second viewer has no separate approved capture or disconnect panel');
      if (!await run(viewer,"window.shatootconnectDiagnostics().connection==='connected'")) throw new Error('Second viewer interrupted the first viewer');
      await run(second,'stopSession(true);true');
      for(let i=0;i<50 && [...states.values()].some(s=>s.owner===owner);i++) await new Promise(resolve=>setTimeout(resolve,100));
      if ([...states.values()].some(s=>s.owner===owner) || !owner.captureAllowed) throw new Error('Second viewer cleanup affected first viewer');
      log('Two simultaneous ID desktop viewers decoded actual video; independent approval, overlay and disconnect passed');
      await run(second,`document.querySelector('#remote-id').value='127.0.0.1:${owner.directInfo.port}';document.querySelector('#remote-password').value=${JSON.stringify(owner.directInfo.password)};joinTarget().then(()=>true)`);
      await wait(second,"window.shatootconnectDiagnostics().connection==='connected' && document.querySelector('#remote-video').videoWidth>0");
      if (!await run(second,"document.querySelector('#quality').value==='lan'")) throw new Error('LAN connection did not select Ultra quality');
      if (!await run(viewer,"window.shatootconnectDiagnostics().connection==='connected'")) throw new Error('Mixed LAN/ID viewers interrupted one another');
      await run(second,'stopSession(true);true');
      for(let i=0;i<50 && [...states.values()].some(s=>s.owner===owner);i++) await new Promise(resolve=>setTimeout(resolve,100));
      log('Mixed Internet-ID and LAN desktop viewers shared the host independently; LAN Ultra selected automatically');
    } finally { second.destroy(); }
    return;
  }
  await run(host,'api.openChat()'); const owner=states.get(host.webContents.id), chat=owner.chatWindow;
  await wait(chat,'window.shatootconnectChatReady===true');
  const peer=states.get(viewer.webContents.id).identity.deviceId, self=owner.identity.deviceId;
  await run(chat,`messenger.select('p:${peer}').then(()=>true)`);
  host.close(); if (host.isDestroyed() || host.isVisible()) throw new Error('Closing the main window did not keep the chat engine alive');
  await run(chat,"document.querySelector('#chat-text').value='Message from independent chat window';document.querySelector('#chat-compose').requestSubmit();true");
  await wait(viewer,`api.collaboration('history',{conversation:'p:${self}'}).then(rows=>rows.some(m=>m.text==='Message from independent chat window'))`);
  await run(viewer,"api.chatPreferences({autoAcceptFiles:true,requireChatApproval:false})");
  const file=path.join(artifacts,'chat-window-drop.txt'), content='Real OS file dragged onto the separate chat window'; fs.writeFileSync(file,content);
  await run(chat,"(()=>{const input=document.createElement('input');input.type='file';input.id='smoke-drop-files';input.hidden=true;document.body.append(input);return true})()");
  chat.webContents.debugger.attach('1.3');
  try { const {root}=await chat.webContents.debugger.sendCommand('DOM.getDocument'); const {nodeId}=await chat.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:root.nodeId,selector:'#smoke-drop-files'}); await chat.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[file]}); }
  finally { chat.webContents.debugger.detach(); }
  await run(chat,"(()=>{const transfer=new DataTransfer();transfer.items.add(document.querySelector('#smoke-drop-files').files[0]);const target=document.querySelector('#chat-text');target.dispatchEvent(new DragEvent('dragover',{dataTransfer:transfer,bubbles:true,cancelable:true}));target.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));return true})()");
  await wait(viewer,`api.collaboration('history',{conversation:'p:${self}'}).then(rows=>rows.some(m=>m.kind==='file'&&m.text.includes('chat-window-drop.txt')&&m.attachment))`);
  const received=states.get(viewer.webContents.id).chatStore.history({conversation:`p:${self}`}).find(m=>m.kind==='file'&&m.text.includes('chat-window-drop.txt')&&m.attachment);
  if (fs.readFileSync(states.get(viewer.webContents.id).chatStore.files(received.attachment)[0],'utf8')!==content) throw new Error('Chat window drag/drop corrupted the file');
  chat.show(); chat.focus(); await new Promise(resolve=>setTimeout(resolve,300)); fs.writeFileSync(path.join(artifacts,'chat-window.png'),(await chat.webContents.capturePage()).toPNG());
  chat.close(); for(let i=0;i<50 && !host.isVisible();i++) await new Promise(resolve=>setTimeout(resolve,100)); if (!host.isVisible()) throw new Error('Main window was inaccessible after closing the last chat window');
  log('Separate chat continued with main window closed; actual OS file drop and automatic receipt preserved the exact contents');
};
