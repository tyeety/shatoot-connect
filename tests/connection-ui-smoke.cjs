'use strict';
const fs=require('node:fs'),path=require('node:path'),{WebSocketServer}=require('ws');
module.exports=async({host,states,app,log,artifacts})=>{
  const run=code=>host.webContents.executeJavaScript(code),pause=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async fn=>{for(let i=0;i<400;i++){if(await fn())return;await pause(50)}throw Error('Connection UI timed out: '+fn.toString())};
  await until(()=>run('window.shatootconnectReady===true'));
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
    if(states.get(host.webContents.id).captureAllowed)throw Error('Connection fixture unexpectedly granted capture');
    console.log('SHATOOTCONNECT_CONNECTION_UI_SMOKE passed');app.quit();
  }finally{for(const ws of clients)ws.terminate();server.close()}
};
