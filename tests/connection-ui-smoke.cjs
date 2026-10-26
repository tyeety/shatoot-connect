'use strict';
const fs=require('node:fs'),path=require('node:path'),{WebSocketServer}=require('ws');
module.exports=async({host,createWindow,states,app,dialog,update,log,artifacts})=>{
  const run=code=>host.webContents.executeJavaScript(code),pause=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async fn=>{for(let i=0;i<400;i++){if(await fn())return;await pause(50)}throw Error('Connection UI timed out: '+fn.toString())};
  await until(()=>run('window.shatootconnectReady===true'));
  if(!await run("(async()=>{for(const value of [{autoQuality:'yes'},{allowPrivacyScreen:1},{unknown:true}])if(await api.videoPreferences(value).then(()=>true,()=>false))return false;return true})()"))throw Error('Invalid video settings were accepted');
  await run("document.querySelector('#quality').value='auto';document.querySelector('#quality').dispatchEvent(new Event('change'));true");await until(()=>run('config.autoQuality===true'));
  await run("document.querySelector('#quality').value='balanced';document.querySelector('#quality').dispatchEvent(new Event('change'));true");await until(()=>run("config.autoQuality===false&&config.qualityProfile==='balanced'"));
  if(!await run("(async()=>(await api.config()).autoQuality===false)()"))throw Error('Manual quality mode was not saved');
  await run("document.querySelector('#quality').value='auto';document.querySelector('#quality').dispatchEvent(new Event('change'));true");await until(()=>run('config.autoQuality===true'));
  await run("document.querySelector('#allow-privacy-screen').checked=false;document.querySelector('#allow-privacy-screen').dispatchEvent(new Event('change'));true");await until(()=>run('config.allowPrivacyScreen===false'));
  if(!await run("api.privacyScreen(true).then(()=>false,()=>true)"))throw Error('Privacy request without hosting/consent was accepted');

  if(!await run("config.startupEnabled===true&&document.querySelector('#startup-enabled').checked&&document.querySelector('.settings-tabs').firstElementChild.id==='tab-general'&&!document.querySelector('#settings-general').hidden"))throw Error('Default-on tray startup is missing from the first settings page');
  await run("document.querySelector('#startup-enabled').checked=false;document.querySelector('#startup-enabled').dispatchEvent(new Event('change'));true");
  await until(()=>run("config.startupEnabled===false&&!document.querySelector('#startup-enabled').disabled"));
  const startupWindow=createWindow();
  try{await until(()=>startupWindow.webContents.executeJavaScript('window.shatootconnectReady===true'));if(!await startupWindow.webContents.executeJavaScript("config.startupEnabled===false&&!document.querySelector('#startup-enabled').checked"))throw Error('Disabled Windows startup did not persist when reopening');}finally{startupWindow.destroy();}
  await run("document.querySelector('#startup-enabled').checked=true;document.querySelector('#startup-enabled').dispatchEvent(new Event('change'));true");await until(()=>run('config.startupEnabled===true'));
  if(!await run("config.sharedCursor===true&&document.querySelector('#shared-cursor').checked"))throw Error('Shared mouse was not the migrated/default input mode');
  await run("api.sharedCursor(false)");const limited=createWindow();
  try{await until(()=>limited.webContents.executeJavaScript('window.shatootconnectReady===true'));if(!await limited.webContents.executeJavaScript("config.sharedCursor===false&&!document.querySelector('#shared-cursor').checked"))throw Error('Explicit independent mode did not survive reopening');}finally{limited.destroy();await run("api.sharedCursor(true)");}
  await run("document.querySelector('#settings-dialog').showModal();window.tabSelects=[];window.originalSelectSettingsTab=selectSettingsTab;selectSettingsTab=(...args)=>{tabSelects.push(args[0]);return originalSelectSettingsTab(...args)};true");
  for(const tab of ['host','lan','display','internet','general','profile','chat','updates']){
    const point=await run(`(()=>{const r=document.querySelector('#tab-${tab}').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    host.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});host.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
    await until(()=>run(`document.querySelector('#tab-${tab}').getAttribute('aria-selected')==='true'&&!document.querySelector('#settings-${tab}').hidden`));
  }
  if(!await run("tabSelects.length===8"))throw Error('A settings tab click was skipped or invoked twice');
  await run("selectSettingsTab=originalSelectSettingsTab;document.querySelector('#settings-dialog').close();true");
  await run("document.querySelector('#settings-dialog').showModal();selectSettingsTab('display');document.querySelector('#appearance-theme').value='light';document.querySelector('#appearance-theme').dispatchEvent(new Event('change'));true");
  await until(()=>run("document.documentElement.dataset.theme==='light'&&config.theme==='light'"));
  if(!await run("(async()=>getComputedStyle(document.body).backgroundColor==='rgb(250, 246, 255)'&&getComputedStyle(document.querySelector('#remote-id')).color==='rgb(48, 32, 57)'&&(await api.config()).theme==='light'&&await api.appearance('invalid').then(()=>false,()=>true))()"))throw Error('Light palette, persistence or theme validation failed');
  for(const language of ['en','fa']){await run(`api.language('${language}').then(value=>window.i18n.setLanguage(value))`);await until(()=>run(`document.documentElement.lang==='${language}'`));await pause(80);
    if(!await run("(()=>{const nav=document.querySelector('.settings-tabs'),tabs=[...nav.children],rects=tabs.map(t=>t.getBoundingClientRect()),page=document.querySelector('.settings-page:not([hidden])').getBoundingClientRect(),n=nav.getBoundingClientRect(),d=document.querySelector('#settings-dialog').getBoundingClientRect();return nav.getAttribute('aria-orientation')==='vertical'&&rects.every((r,i)=>Math.abs(r.left-rects[0].left)<1&&(!i||r.top>=rects[i-1].bottom))&&(document.dir==='rtl'?page.right<=n.left:page.left>=n.right)&&d.top>=0&&d.bottom<=innerHeight})()"))throw Error('Vertical settings tabs overlap or escape the viewport');
    if(!await run("(()=>{document.querySelector('#tab-display').focus();document.querySelector('#tab-display').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));const selected=document.querySelector('#tab-updates').getAttribute('aria-selected')==='true';selectSettingsTab('display');return selected})()"))throw Error('Vertical settings keyboard navigation omitted dynamic tabs');
    fs.writeFileSync(path.join(artifacts,`theme-settings-${language}.png`),(await host.webContents.capturePage()).toPNG());}
  await run("document.querySelector('#settings-dialog').close();api.language('en').then(value=>window.i18n.setLanguage(value))");fs.writeFileSync(path.join(artifacts,'theme-main-light.png'),(await host.webContents.capturePage()).toPNG());
  await run("api.appearance('dark')");await until(()=>run("document.documentElement.dataset.theme==='dark'&&document.querySelector('#appearance-theme').value==='dark'"));
  log('Settings theme selector applies light/dark immediately, persists, translates and rejects invalid themes');
  const photos={"avif":"AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAQQAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAYAAAADAAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAASW1kYXQSAAoJGBlv3tEBDQaEMjJEmPDwzKBBBBPKAAABAMIRadbcFWl1kK3P2h3d8oLkpv3qH/CY+aLy1QinBeMPZTDmXQ==","webp":"UklGRnwAAABXRUJQVlA4IHAAAACQBQCdASpgADAAPm0wk0akIyGhLGgAgA2JYwDUEaF+AfgBpgPwA/W4Awz/wKhYnmQs+qqNwAD+8JsewyTALkW9PTAJC/8gP+tX/+GE3kginPUajF/0eU3//7y3n0WrG2QV8Gyw4boeLcm4Y21QAAAA","gif":"R0lGODlhYAAwAIEAAADuAP8AAAAA/wAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQABQAAACwAAAAAYAAwAAAI/wADCBxIsKDBgQASKlzIsKHDhxAVCphIsaLFixQPatwYsaPHjwkxihy5sWRBkChTShzJsqLJlwFUyvzYsqYAmCZn6oRosyXOkjuDMuzJ8idHoUiJkjR6EGlSpRiZNnUaFGpUqSep7rR6EWtWrTO5WvRKEKxOsS7JCjQbFu1EtWvZqnT7Fq7cuXThxryLku5Nu3xB+tUbWHBewIU7DkacmOdhtY0VPyYbOeJiyJUfXqac2eFmr509TwYdeuhorKVNuyWceuVqxqk/o24d8rRU2rVfY6Yt+zbu3kxxAwBuVDjxn8ZtB/+tvDhz3Zx5N0f+HC1r6dBJY7cOu/RxnMmzzw7eLvZ66+8ww3PffZ5uQAAh+QQBBQABACwYAAAASAAwAIH/AAAAAAAAAAAAAAAIYAABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzBjypxJs6bNmzhz6tzJs6fPn0CDCh1KtKjRo0iTKl3KtKnTp1CjSq0ZEAA7","png":"iVBORw0KGgoAAAANSUhEUgAAAGAAAAAwCAIAAABhdOiYAAAAhklEQVR4nO3QQQ2AQBAEwTsk4F8jFsAB/dkHIVUCJpne95qxr/Ut58yzY2TlxwQKAgWBgkBBoCBQECgIFAQKAgWBgkBBoCBQECgIFAQKAgWBgkBBoCBQECgIFAQKAgWBgkBBoCBQECgIFAQKAgWBgkBBoCBQECgIFAQKAgWBgkBBoCDQevcAk3gDXzqwZCEAAAAASUVORK5CYII=","jpeg":"/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAwAGADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3EK9Arz+vQK8/H/Z+f6H414t/8wf/AHE/9sCiiivPPxoKKKKACvEK9vrxCv1vws/5i/8AuH/7efR8P/8ALz5fqFFFFfrh9GdfRRRX80H9CBXoFef16BXn4/7Pz/Q/GvFv/mD/AO4n/tgUUUV55+NBRRRQAV4hXt9eIV+t+Fn/ADF/9w//AG8+j4f/AOXny/UKKKK/XD6M6+iiiv5oP6ECvQK8/r0CvPx/2fn+h+NeLf8AzB/9xP8A2wKKKK88/GgooooAK8Qr2+vEK/W/Cz/mL/7h/wDt59Hw/wD8vPl+oUUUV+uH0Z//2Q=="};
  const originalPicker=dialog.showOpenDialog;let selected;
  dialog.showOpenDialog=async(_win,options)=>{
    if(!['avif','webp','gif'].every(ext=>options.filters[0].extensions.includes(ext)))throw Error('Photo picker omitted requested formats');
    return {canceled:false,filePaths:[selected]};
  };
  try{
    for(const [extension,base64]of Object.entries(photos)){
      selected=path.join(artifacts,'profile.'+extension);fs.writeFileSync(selected,Buffer.from(base64,'base64'));
      await run("document.querySelector('#profile-photo-remove').click();true");await until(()=>run("config.avatar===''") );
      await run("document.querySelector('#profile-photo').click();true");await until(()=>run("config.avatar?.startsWith('data:image/png;base64,')"));
      const valid=await run(`(async()=>{const image=new Image();image.src=config.avatar;await image.decode();const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.drawImage(image,0,0);const pixel=x.getImageData(32,32,1,1).data;return image.width===64&&image.height===64&&pixel[1]>180&&pixel[0]<60&&pixel[2]<70&&(await api.config()).avatar===config.avatar&&document.querySelector('#profile-photo-preview').src===config.avatar})()`);
      if(!valid)throw Error('Profile decode/crop/first frame/preview/persistence failed: '+extension);
    }
    selected=path.join(artifacts,'broken.avif');fs.writeFileSync(selected,'Not an image');
    if(!await run("api.profilePhoto(false).then(()=>false,()=>true)"))throw Error('Malformed profile photo was accepted');
    log('Real AVIF, WebP, animated GIF first frame, PNG and JPEG decode/crop/preview/profile persistence passed; malformed photo rejected');
  }finally{dialog.showOpenDialog=originalPicker;}
  const clipboard=require('electron').clipboard,originalRead=clipboard.read;
  try{
    clipboard.read=async()=>[{types:['image/png'],getType:async()=>new Blob([Buffer.from(photos.png,'base64')],{type:'image/png'})}];
    const image=await require('../desktop/clipboard-image.cjs').clipboardImage(clipboard);if(image!=='data:image/png;base64,'+photos.png)throw Error('Electron asynchronous clipboard image read failed');
  }finally{clipboard.read=originalRead;}
  await run("document.querySelector('#open-settings').click();document.querySelector('#tab-profile').click();true");
  for(let i=0;i<2;i++){
    await run("document.querySelector('#profile-name').value='Profile feedback test';document.querySelector('#profile-save').click();true");
    await until(()=>run("document.querySelector('#settings-status').textContent===window.i18n.translate('Profile saved.')&&document.querySelector('#action-snackbar .snackbar-message')?.textContent===window.i18n.translate('Profile saved.')&&!document.querySelector('#action-snackbar').hidden"));
  }
  await run("document.querySelector('#settings-dialog').close();true");
  log('Actual Electron async clipboard API decoded PNG without readImage; Save Profile explicitly confirms changed and unchanged profiles');
  const worker=path.join(artifacts,'update-launch.ps1'),token=require('node:crypto').randomUUID();
  fs.writeFileSync(worker,"param($Version,$ReadyToken,$CacheDirectory)\n[IO.File]::WriteAllText((Join-Path $CacheDirectory ($ReadyToken+'.worker.json')),(@{token=$ReadyToken;version=$Version}|ConvertTo-Json -Compress));Start-Sleep -Milliseconds 200");
  const launch=await require('../desktop/update-launch.cjs').startUpdateWorker({powershell:path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),worker,directory:artifacts,parameters:{Version:'0.19.4',ReadyToken:token,CacheDirectory:artifacts}});
  await new Promise(resolve=>launch.exitCode!==null?resolve():launch.once('exit',resolve));if(launch.exitCode!==0)throw Error('Electron update-worker launch failed');
  log('PowerShell worker started and confirmed readiness from the actual Electron main process');
  const server=new WebSocketServer({host:'127.0.0.1',port:0}),clients=new Set();
  let greet=false,joined=false;await new Promise(r=>server.once('listening',r));server.on('connection',ws=>{clients.add(ws);ws.once('close',()=>clients.delete(ws));ws.on('message',data=>{if(JSON.parse(data).type==='join')joined=true});if(greet)ws.send(JSON.stringify({type:'ready',direct:true,service:'ShatootConnect',protocol:2}))});
  const address='127.0.0.1:'+server.address().port;
  try{
    await run(`document.querySelector('#remote-id').value='${address}';document.querySelector('#remote-password').value='saved-secret';document.querySelector('#quick-save').click();true`);
    await until(()=>run("!!document.querySelector('#save-computer-dialog')?.open"));
    await run("document.querySelector('#saved-computer-name').value='دفتر مرکزی';document.querySelector('#save-computer-form').requestSubmit();true");
    await until(()=>run("config.favorites.some(f=>f.name==='دفتر مرکزی')"));
    const favorite=await run('api.favoriteGet(config.favorites[0].id)');
    await run("document.querySelector('.rename-computer').click();true");await until(()=>run("document.querySelector('#save-computer-dialog').open"));
    await run("document.querySelector('#saved-computer-name').value='حسابداری';document.querySelector('#save-computer-form').requestSubmit();true");
    await until(()=>run("config.favorites.some(f=>f.name==='حسابداری')"));
    const renamed=await run('api.favoriteGet(config.favorites[0].id)');
    if(renamed.id!==favorite.id||renamed.password!==favorite.password)throw Error('Renaming changed saved credentials/identity');
    await run("api.connections('connected',{address:'192.168.99.254',name:'Recent computer'}).then(renderHistory)");
    await until(()=>run("document.querySelector('#favorites-list>div')?.dataset.saved==='false'"));
    await run(`api.connections('connected',{address:'${address}',name:'Saved computer'}).then(renderHistory)`);
    await until(()=>run("document.querySelector('#favorites-list>div')?.dataset.saved==='true'"));
    if(!await run("document.querySelectorAll('#favorites-list>div').length===2 && !document.querySelector('#connection-history') && !!document.querySelector('.favorite-row .computer-kind.star_outline') && !!document.querySelector('.history-row .computer-kind.schedule') && document.querySelector('.rename-computer').textContent==='' && document.querySelectorAll('.connection-grid .muted').length===0"))throw Error('Combined computer list, markers, icon-only rename or removed helper text regressed');
    await run("document.querySelector('.history-row .computer-pin').click();true");
    await until(()=>run("document.querySelector('#favorites-list>div')?.dataset.saved==='false'&&document.querySelector('#favorites-list>div .computer-pin')?.getAttribute('aria-pressed')==='true'"));await pause(200);
    if(!await run("getComputedStyle(document.querySelector('.computer-pin[aria-pressed=true] .mi')).transform!=='none'"))throw Error('Pinned connection icon did not tilt');
    await run(`api.connections('connected',{address:'${address}',name:'Saved computer'}).then(renderHistory)`);
    if(!await run("document.querySelector('#favorites-list>div')?.dataset.saved==='false'"))throw Error('A new connection displaced the pinned computer');
    await run("document.querySelector('.history-row .computer-pin').click();true");await until(()=>run("document.querySelector('#favorites-list>div')?.dataset.saved==='true'"));
    await run("document.querySelector('.favorite-row .computer-pin').click();true");await until(()=>run("document.querySelector('.favorite-row .computer-pin')?.getAttribute('aria-pressed')==='true'"));
    if(!await run("(async()=>{const rows=await api.connections('computers');return rows[0].saved&&rows[0].pinned&&[...document.querySelectorAll('.favorite-actions button')].every(b=>b.getBoundingClientRect().right<=b.closest('.favorite-row,.history-row').getBoundingClientRect().right)})()"))throw Error('Saved pin persistence or card button layout regressed');
    await run("document.querySelector('.favorite-row .computer-pin').click();true");await until(()=>run("document.querySelector('.favorite-row .computer-pin')?.getAttribute('aria-pressed')==='false'"));
    await run("document.querySelector('.history-row .computer-pin').click();document.querySelector('.favorite-row .computer-pin').click();true");await until(()=>run("document.querySelectorAll('.pinned-draggable').length===2"));
    if(!await run("(()=>{const list=document.querySelector('#favorites-list'),source=list.querySelector('.favorite-row'),target=list.querySelector('.history-row'),data=new DataTransfer(),y=target.getBoundingClientRect().top+1;const started=source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:data}));target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data,clientY:y}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientY:y}));source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));return started})()"))throw Error('Text drag blocker swallowed pinned connection drag');
    await until(()=>run("document.querySelector('#favorites-list>div')?.dataset.saved==='true'&&!document.querySelector('#favorites-list').dataset.reordering"));
    await run("api.connections('connected',{address:'192.168.99.254',name:'Recent computer'}).then(renderHistory)");
    if(!await run("document.querySelector('#favorites-list>div')?.dataset.saved==='true'"))throw Error('Reconnect reset manual pinned order');
    await run("document.querySelector('.favorite-row .computer-pin').click();document.querySelector('.history-row .computer-pin').click();true");await until(()=>run("!document.querySelector('.pinned-draggable')"));
    log('Saved/recent connection pin buttons persist, tilt and stay above newer unpinned connections without clipping');
    for(let i=0;i<3;i++){
      greet=i===2;joined=false;
      await run("document.querySelector('.favorite-connect').click();true");
      await until(()=>run("!document.querySelector('#cancel-connection').hidden"));await until(()=>clients.size===1);if(greet)await until(()=>joined);
      await run("document.querySelector('#cancel-connection').click();true");
      await until(()=>run("role==='idle' && !outgoingAttempt && !document.querySelector('#join').disabled"));await until(()=>clients.size===0);
    }
    await run("onMessage({type:'accepted',control:true}).then(()=>true)");if(!await run("role==='idle' && !pc"))throw Error('Late acceptance revived a cancelled connection');greet=false;
    log('Actual stalled LAN connection cancels immediately, closes its transport and can be retried; chosen nickname preserves password and identity');
    await run(`document.querySelector('#server-url').value='ws://${address}';document.querySelector('#connect-server').click();true`);
    await until(()=>run("!document.querySelector('#cancel-server').hidden"));await until(()=>clients.size===1);
    await run("document.querySelector('#cancel-server').click();true");await until(()=>clients.size===0);
    if(!await run('!serverAttempt && !connectPromise && !socket && !registrationWanted'))throw Error('Coordinator cancellation left reconnect work');
    await run(`messenger.start({type:'lan',address:'${address}'}).catch(()=>{});true`);
    await until(()=>run("!document.querySelector('#chat-cancel-connect').hidden"));await until(()=>clients.size===1);
    await run("document.querySelector('#chat-cancel-connect').click();true");await until(()=>clients.size===0);await until(()=>run('collaboration.connectAttempts.size===0 && collaboration.sessions.size===0'));
    log('Coordinator and chat waiting states cancel through actual buttons without leftover sessions');
    await run("document.querySelector('#messenger-dialog').close();true");
    for(const language of ['en','fa']){
      await run(`window.i18n.setLanguage('${language}');status('زمان انتظار اتصال تمام شد؛ تأیید میزبان و تنظیمات شبکه را بررسی کنید.',true);true`);
      if(!await run(`document.querySelector('#session-status').textContent===window.i18n.translate('Connection timed out. Check host approval and network settings.')`))throw Error('Connection timeout used the wrong language in '+language);
      await run(`window.i18n.setLanguage('${language}');status('');true`);await pause(450);
      const layout=await run("(()=>{const main=document.querySelector('main'),footer=main.querySelector('footer').getBoundingClientRect(),panel=document.querySelector('#network-panel').getBoundingClientRect(),list=document.querySelector('#network-list'),card=document.querySelector('.host-card'),button=[...card.querySelectorAll('.full')].find(b=>b.getClientRects().length),box=button.getBoundingClientRect(),cb=card.getBoundingClientRect();return{bottom:Math.abs(footer.bottom-innerHeight),panelBottom:footer.top-panel.bottom,listMax:getComputedStyle(list).maxHeight,hostBottom:cb.bottom-box.bottom,hostPadding:parseFloat(getComputedStyle(card).paddingBottom),overflow:document.documentElement.scrollHeight-innerHeight,pills:document.querySelectorAll('.card .pill').length,status:document.querySelector('#session-status').textContent,headings:[...document.querySelectorAll('.card-top')].every(e=>!!e.querySelector('h2')),icons:[...document.querySelectorAll('.favorite-actions .icon-button')].every(b=>{const r=b.getBoundingClientRect(),i=b.querySelector('.mi').getBoundingClientRect();return Math.abs((r.left+r.right-i.left-i.right)/2)<1&&Math.abs((r.top+r.bottom-i.top-i.bottom)/2)<1})}})()");
      if(layout.bottom>1||layout.panelBottom>2||layout.listMax!=='none'||Math.abs(layout.hostBottom-layout.hostPadding-1)>1||layout.overflow>1||layout.pills||!layout.headings||!layout.icons||layout.status.includes('LAN is ready'))throw Error('Main layout failed in '+language+': '+JSON.stringify(layout));
      fs.writeFileSync(path.join(artifacts,`connections-${language}.png`),(await host.webContents.capturePage()).toPNG());
    }
    if(!await run("document.querySelector('#allow-firewall').hidden"))throw Error('Firewall shortcut visible despite allowed access');
    const owner=states.get(host.webContents.id);for(const needsRepair of [null,false,true]){owner.firewallStatus={needsRepair};await run('refreshFirewallAction().then(()=>true)');if(!await run(`document.querySelector('#allow-firewall').hidden===${needsRepair!==true}`))throw Error('Firewall shortcut visibility disagrees with policy');}
    await run("document.querySelector('#allow-firewall').click();true");await until(()=>run("document.querySelector('#action-snackbar .snackbar-message')?.textContent===window.i18n.translate('Firewall access repaired.')&&!document.querySelector('#allow-firewall').disabled"));
    await until(()=>run("document.querySelector('#allow-firewall').hidden"));
    if(!await run("(()=>{const b=document.querySelector('#action-snackbar .snackbar-confirm'),r=b.getBoundingClientRect();return r.width>=28&&r.height>=28&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()"))throw Error('Snackbar confirmation cannot receive pointer input');
    await run("document.querySelector('#action-snackbar .snackbar-confirm').click();true");if(!await run("document.querySelector('#action-snackbar').hidden"))throw Error('Snackbar confirmation did not dismiss it');
    if(!await run("document.querySelector('#open-settings').nextElementSibling.id==='allow-firewall'"))throw Error('Firewall button is not immediately after Settings');
    const focusPeer=createWindow();await until(()=>focusPeer.webContents.executeJavaScript('window.shatootconnectReady===true'));
    try{for(let i=0;i<8;i++){focusPeer.show();focusPeer.focus();await pause(60);host.show();host.focus();await pause(60);const capture=await host.webContents.capturePage();if(capture.isEmpty())throw Error('Focus/screenshot returned an empty image');if(host.webContents.isCrashed())throw Error('Renderer crashed during focus/screenshot');}}finally{focusPeer.destroy();}
    log('English/Persian main layout fills the window, footer/host button stay at bottom, edit icons center; header firewall feedback and repeated native focus/screenshot passed');
    update.emit({state:'available',version:'99.0.0'});await until(()=>run("!document.querySelector('#update-notice').hidden"));
    for(const language of ['en','fa']){
      await run(`window.i18n.setLanguage('${language}');document.querySelector('#settings-dialog').showModal();selectSettingsTab('updates');true`);
      for(const percent of [0,37,100]){
        update.emit({state:'downloading',percent});
        await until(()=>run(`['update-notice','install-update'].every(id=>{const b=document.getElementById(id),p=b.querySelector('.update-percent');return !b.hidden&&b.disabled&&p?.textContent==='${percent}%'&&!p.hidden})`));
        if(!await run("['update-notice','install-update'].every(id=>{const b=document.getElementById(id),p=b.querySelector('.update-percent'),outer=b.getBoundingClientRect(),inner=p.getBoundingClientRect();return inner.width>25&&inner.left>=outer.left&&inner.right<=outer.right&&p.scrollWidth<=p.clientWidth&&getComputedStyle(b).opacity==='1'})"))throw Error('Update percentage is clipped or dimmed in '+language);
      }
      fs.writeFileSync(path.join(artifacts,`update-${language}.png`),(await host.webContents.capturePage()).toPNG());
      await run("document.querySelector('#settings-dialog').close();true");
    }
    update.emit({state:'error',error:'Update network interrupted'});await until(()=>run("!document.querySelector('#action-snackbar').hidden && document.querySelector('#action-snackbar').textContent.includes('Update network interrupted')"));
    update.emit({state:'current',version:'0.0.0'});
    for(const language of ['en','fa']){await run(`window.i18n.setLanguage('${language}');true`);if(!await run("(()=>{const buttons=['own-profile','open-messenger','open-settings'].map(id=>document.getElementById(id).getBoundingClientRect());return buttons.every(b=>Math.abs(b.height-38)<1&&Math.abs(b.top-buttons[0].top)<1)})()"))throw Error('Header button heights/alignment differ in '+language);}
    await run("window.i18n.setLanguage('en');window.automaticListAnimations=0;window.animationProbe=new MutationObserver(records=>{for(const r of records)if(r.target.classList.contains('data-feedback'))automaticListAnimations++});animationProbe.observe(document.body,{attributes:true,attributeFilter:['class'],subtree:true});renderFavorites(config.favorites);true");
    await pause(500);if(await run('automaticListAnimations!==0'))throw Error('Background list rendering triggered a loading animation');
    await run("animationProbe.disconnect();document.querySelector('#refresh-discovery').click();true");await until(()=>run("document.querySelector('#network-list').classList.contains('data-feedback')"));
    log('Update progress stays visible outside Settings and a failed update reports its error');
    if(!await run("!!document.querySelector('.favorite-actions .mi.shortcut') && !!document.querySelector('.favorite-actions .mi.screen_share')"))throw Error('Saved computer actions omitted shortcut/connect icons');
    await run("window.shiftPackets=[];role='viewer';allowedControl=true;peerKeyboardSync=true;guestKeyboardLayout='00000409';controlChannel={readyState:'open',bufferedAmount:0,send:value=>shiftPackets.push(JSON.parse(value)),close:()=>{}};showSession();stage.focus();true");
    host.webContents.send('grabbed-key',{vk:0xBF,scan:0x35,extended:false,down:true,shift:true,ctrl:false});
    await until(()=>run('shiftPackets.length===2'));
    for(const data of [{vk:0xBF,scan:0x35,down:false,shift:true},{vk:0xA1,scan:0x36,down:false,shift:true},{vk:0xBF,scan:0x35,down:true,shift:false},{vk:0xBF,scan:0x35,down:false,shift:false}])host.webContents.send('grabbed-key',{extended:false,ctrl:false,...data});
    await until(()=>run('shiftPackets.length===6'));
    if(!await run("shiftPackets[0].code==='ShiftLeft'&&shiftPackets[0].down&&shiftPackets[1].type==='physical-key'&&shiftPackets[3].code==='ShiftLeft'&&!shiftPackets[3].down&&shiftPackets.every(p=>p.layout==='00000409')"))throw Error('Native Shift snapshot did not recover and release the remote modifier');
    await run("stage.dispatchEvent(new KeyboardEvent('keydown',{code:'ShiftRight',shiftKey:true,bubbles:true,cancelable:true}));true");await until(()=>run('shiftPackets.length===7'));
    host.webContents.send('grabbed-key',{vk:0xA1,scan:0x36,extended:false,down:false,shift:true});await until(()=>run('shiftPackets.length===8'));
    if(!await run("shiftPackets[6].code==='ShiftRight'&&shiftPackets[6].type==='key'&&shiftPackets[7].code==='ShiftRight'&&!shiftPackets[7].down"))throw Error('DOM/native Shift handoff used mismatched key representations');
    await run("sendGuestKey({type:'key',code:'Slash',down:true},false,true).then(()=>true)");await run('stopSession(false);true');
    if(!await run('guestShift.held.size===0'))throw Error('Session teardown retained a Shift modifier');
    log('Native modifier snapshots recover held Shift, DOM/native handoff releases the same key, and teardown resets modifiers');
    await run("window.sentEnd=[];role='viewer';sessionRoute='lan-viewer';directSocket={readyState:1,send:value=>sentEnd.push(JSON.parse(value)),close:()=>{}};updateControls();api.fitVideo({width:3840,height:2160}).then(()=>true)");
    const initial=host.getContentBounds(),target={width:Math.min(720,initial.width),height:Math.min(440,initial.height)};host.setContentSize(target.width,target.height);await run('api.fitVideo(null).then(()=>true)');await run('api.fitVideo({width:3840,height:2160}).then(()=>true)');
    const remembered=host.getContentBounds();if(remembered.width>target.width+2||remembered.height>target.height+2||initial.width<remembered.width)throw Error('Remote window did not respect last size/available display');
    host.close();await until(()=>run("role==='idle' && sentEnd.some(m=>m.type==='end-session')"));await until(()=>!host.isVisible());
    if(states.get(host.webContents.id).outgoingDesktop)throw Error('Closed remote window retained viewer state');
    log('Remote close sends end-session and hides only after cleanup; initial display fit and remembered geometry passed');
    if(states.get(host.webContents.id).captureAllowed)throw Error('Connection fixture unexpectedly granted capture');
    console.log('SHATOOTCONNECT_CONNECTION_UI_SMOKE passed');app.quit();
  }finally{for(const ws of clients)ws.terminate();server.close()}
};
