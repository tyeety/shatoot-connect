'use strict';
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({ host, viewer, states, wait, createWindow, log, artifacts, phase = 'multi' }) => {
  const run = (win, code) => win.webContents.executeJavaScript(code);
  if (phase === 'multi') {
    const panel=states.get(host.webContents.id).overlay;
    if(!panel || !await panel.webContents.executeJavaScript(`(async()=>{for(const icon of document.querySelectorAll('.mi')){const mask=getComputedStyle(icon).maskImage,match=mask.match(/url\\(['"]?(.+?)['"]?\\)/);if(!match)return false;const image=new Image();image.src=match[1];try{await image.decode()}catch{return false}}return true})()`))throw new Error('Host panel icon definition/SVG missing');
    for(const language of ['en','fa']) {
      const errors=await run(viewer,`(()=>{window.i18n.setLanguage('${language}');return [...document.querySelectorAll('.session-toolbar button:not([hidden])')].flatMap(button=>{const icon=button.querySelector('.mi'),b=button.getBoundingClientRect(),i=icon.getBoundingClientRect();return Math.abs(b.x+b.width/2-i.x-i.width/2)>.75||Math.abs(b.y+b.height/2-i.y-i.height/2)>.75||i.width<20||i.height<20||[...button.querySelectorAll('span:not(.mi)')].some(label=>label.getClientRects().length)?[button.id]:[]})})()`);
      if(errors.length)throw new Error(`${language} live toolbar icons are not centered: ${errors.join(', ')}`);
      fs.writeFileSync(path.join(artifacts,`toolbar-${language}.png`),(await viewer.webContents.capturePage()).toPNG());
    }
    await run(viewer,"window.i18n.setLanguage('en');true");
    log('Live viewer toolbar icons are centered and readable in English and Persian, without invisible label spacing');
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
      await run(second,`document.querySelector('#remote-id').value=${JSON.stringify(credentials.id)};document.querySelector('#remote-id').dispatchEvent(new Event('input'));true`);
      await wait(second,`document.querySelector('#remote-password').value===${JSON.stringify(credentials.password)}`);
      await run(second,"document.querySelector('#remote-password').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));true");
      await wait(second,"window.shatootconnectDiagnostics().connection==='connected'");
      await run(second,'stopSession(true);true');
      for(let i=0;i<50 && [...states.values()].some(s=>s.owner===owner);i++) await new Promise(resolve=>setTimeout(resolve,100));
      log('Remembered password autofilled the matching ID and Enter reconnected through the real connection button');
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
  chat.close(); await new Promise(resolve=>setTimeout(resolve,150)); if(host.isVisible())throw new Error('Closing chat unexpectedly reopened the main window');await run(host,'api.showMain()');if(!host.isVisible())throw new Error('Main window cannot be restored from the tray');
  log('Separate chat continued with main window closed; actual OS file drop and automatic receipt preserved the exact contents');
};
