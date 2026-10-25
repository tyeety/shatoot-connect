'use strict';
const fs=require('node:fs'),path=require('node:path'),{WebSocketServer}=require('ws');
module.exports=async({host,states,app,dialog,update,log,artifacts})=>{
  const run=code=>host.webContents.executeJavaScript(code),pause=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async fn=>{for(let i=0;i<400;i++){if(await fn())return;await pause(50)}throw Error('Connection UI timed out: '+fn.toString())};
  await until(()=>run('window.shatootconnectReady===true'));
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
    await until(()=>run("document.querySelector('#settings-status').textContent===window.i18n.translate('Profile saved.')&&document.querySelector('#action-snackbar')?.textContent===window.i18n.translate('Profile saved.')&&!document.querySelector('#action-snackbar').hidden"));
  }
  await run("document.querySelector('#settings-dialog').close();true");
  log('Actual Electron async clipboard API decoded PNG without readImage; Save Profile explicitly confirms changed and unchanged profiles');
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
    for(const language of ['en','fa']){await run(`window.i18n.setLanguage('${language}');true`);await pause(100);fs.writeFileSync(path.join(artifacts,`connections-${language}.png`),(await host.webContents.capturePage()).toPNG())}
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
    await run("window.sentEnd=[];role='viewer';sessionRoute='lan-viewer';directSocket={readyState:1,send:value=>sentEnd.push(JSON.parse(value)),close:()=>{}};updateControls();api.fitVideo({width:3840,height:2160}).then(()=>true)");
    const initial=host.getContentBounds();host.setContentSize(720,440);await run('api.fitVideo(null).then(()=>true)');await run('api.fitVideo({width:3840,height:2160}).then(()=>true)');
    const remembered=host.getContentBounds();if(remembered.width>722||remembered.height>442||initial.width<remembered.width)throw Error('Remote window did not respect last size/available display');
    host.close();await until(()=>run("role==='idle' && sentEnd.some(m=>m.type==='end-session')"));await until(()=>!host.isVisible());
    if(states.get(host.webContents.id).outgoingDesktop)throw Error('Closed remote window retained viewer state');
    log('Remote close sends end-session and hides only after cleanup; initial display fit and remembered geometry passed');
    if(states.get(host.webContents.id).captureAllowed)throw Error('Connection fixture unexpectedly granted capture');
    console.log('SHATOOTCONNECT_CONNECTION_UI_SMOKE passed');app.quit();
  }finally{for(const ws of clients)ws.terminate();server.close()}
};
