'use strict';
const {BrowserWindow,screen}=require('electron'),{spawn}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
module.exports=async({host,createWindow,states,privacy,app,log})=>{
 const run=(win,code)=>win.webContents.executeJavaScript(code),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(win,code)=>{for(let n=0;n<300;n++){if(await run(win,code))return;await pause(100);}throw Error('Media acceptance timed out: '+code);};
 let viewer,extra,target,helper,network;const savedScreen=privacy.screen,savedEscape=privacy.escapeAvailable;
 try{
  await until(host,'window.shatootconnectReady===true&&!!window.shatootconnectDirect');
  const saved=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'connection.json'),'utf8'));
  if(saved.autoQuality===undefined&&!await run(host,'config.autoQuality===true'))throw Error('Automatic quality migration default was not enabled');
  if(saved.allowPrivacyScreen===undefined&&!await run(host,'config.allowPrivacyScreen===false'))throw Error('Privacy permission was not opt-in');
  if(!await run(host,"document.querySelector('#quality').value===(config.autoQuality?'auto':config.qualityProfile)"))throw Error('Saved quality mode did not survive startup');
  await run(host,"(async()=>{Object.assign(config,await api.videoPreferences({autoQuality:true,allowPrivacyScreen:false}));document.querySelector('#quality').value='auto';return true})()");
  await run(host,"document.querySelector('#internet-enabled').checked=false;document.querySelector('#internet-enabled').dispatchEvent(new Event('change'));true");
  await until(host,'config.internetEnabled===false');
  const direct=await run(host,'window.shatootconnectDirect');viewer=createWindow();await until(viewer,'window.shatootconnectReady===true');
  const option=name=>Number(process.argv.find(a=>a.startsWith('--'+name+'='))?.split('=')[1]);
  if(option('network-kbps')){
   network=await require('./media-network.cjs')({kbps:option('network-kbps'),rtt:option('network-rtt')||0,loss:option('network-loss')||0});
   await run(viewer,`window.originalCreatePeer=createPeer;createPeer=()=>{iceServers=${JSON.stringify(network.iceServers)};forceRelay=true;originalCreatePeer();};true`);
  }
  const join=async win=>{await run(win,`document.querySelector('#remote-id').value=${JSON.stringify('127.0.0.1:'+direct.port)};document.querySelector('#remote-password').value=${JSON.stringify(direct.password)};document.querySelector('#join').click();true`);await until(win,'document.querySelector("#remote-video").videoWidth>0&&controlChannel?.readyState==="open"');};
  if(process.argv.some(a=>a.startsWith('--codec='))){const name=process.argv.find(a=>a.startsWith('--codec=')).split('=')[1];for(const win of [host,viewer])await run(win,`preferCodec=()=>{const preferred='video/${name}';const codecs=[...RTCRtpReceiver.getCapabilities('video').codecs].sort((a,b)=>Number(b.mimeType===preferred)-Number(a.mimeType===preferred));for(const t of pc.getTransceivers())t.setCodecPreferences(codecs);};true`);}
  if(process.argv.some(a=>a.startsWith('--capture='))){const height=Number(process.argv.find(a=>a.startsWith('--capture=')).split('=')[1]);for(const win of [host,viewer])await run(win,`config.profiles.balanced={...config.profiles.balanced,width:Math.round(${height}*16/9),height:${height}};true`);}
  const manual=process.argv.find(a=>a.startsWith('--mode='))?.split('=')[1];if(manual)for(const win of [host,viewer])await run(win,`config.autoQuality=false;config.qualityProfile='${manual}';true`);
  await join(viewer);await until(host,manual?'videoQuality?.automatic===false':'videoQuality?.automatic===true');
  if(!await run(viewer,'peerMediaFeedback===true'))throw Error('Decoder feedback capability was not negotiated');
  if(process.argv.includes('--media-performance')){
   const capturedId=states.get(host.webContents.id)?.source?.display_id;const captureDisplay=screen.getAllDisplays().find(d=>String(d.id)===String(capturedId))||screen.getPrimaryDisplay();const area=captureDisplay.bounds;
   target=new BrowserWindow({...area,frame:false,focusable:false,alwaysOnTop:true,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
   await target.loadURL('data:text/html,'+encodeURIComponent(`<canvas></canvas><script>const c=document.querySelector('canvas');c.width=innerWidth;c.height=innerHeight;const x=c.getContext('2d');function draw(t){x.fillStyle='#231339';x.fillRect(0,0,c.width,c.height);x.font='24px sans-serif';for(let i=0;i<40;i++){const y=(i*45+t*.12)%c.height;x.fillStyle=i%2?'#ecdcff':'#ad65ef';x.fillRect((i*113+t*.25)%c.width,y,160,22);x.fillText('Shatoot Connect '+i,20,y);}requestAnimationFrame(draw)}requestAnimationFrame(draw)</script>`));target.showInactive();
   const read=win=>run(win,`(async()=>{const r=await pc.getStats(),v=[...r.values()].find(s=>s.kind==='video'&&s.type==='${win===host?'outbound':'inbound'}-rtp'),p=r.get([...r.values()].find(s=>s.type==='transport'&&s.selectedCandidatePairId)?.selectedCandidatePairId)||[...r.values()].find(s=>s.type==='candidate-pair'&&s.nominated&&s.state==='succeeded');return {time:performance.now(),frames:v?.framesEncoded??v?.framesDecoded,bytes:v?.bytesSent??v?.bytesReceived,encode:v?.totalEncodeTime,decode:v?.totalDecodeTime,jitter:v?.jitterBufferDelay,emitted:v?.jitterBufferEmittedCount,freezeCount:v?.freezeCount,freezeSeconds:v?.totalFreezesDuration,framesDropped:v?.framesDropped,sendDelay:v?.totalPacketSendDelay,packets:v?.packetsSent,width:v?.frameWidth,height:v?.frameHeight,sourceFps:[...r.values()].find(s=>s.type==='media-source'&&s.kind==='video')?.framesPerSecond,sourceFrames:[...r.values()].find(s=>s.type==='media-source'&&s.kind==='video')?.frames,limitation:v?.qualityLimitationReason,codec:r.get(v?.codecId)?.mimeType,implementation:v?.encoderImplementation,capacity:p?.availableOutgoingBitrate,relay:[r.get(p?.localCandidateId),r.get(p?.remoteCandidateId)].some(c=>c?.candidateType==='relay'),capture:typeof stream==='undefined'?null:(({width,height,frameRate})=>({width,height,frameRate}))(stream?.getVideoTracks()[0]?.getSettings()||{}),encoding:typeof sender==='undefined'?null:sender?.getParameters().encodings?.[0],profile:typeof videoQuality==='undefined'?null:videoQuality?.name,ceiling:typeof videoQuality==='undefined'?null:videoQuality?.bitrate}})()`);
   await run(viewer,"window.frameAges=[];window.frameWork=[];const video=document.querySelector('#remote-video');function frameProbe(now,data){if(Number.isFinite(data.captureTime)&&now>=data.captureTime)frameAges.push(now-data.captureTime);if(data.processingDuration)frameWork.push(data.processingDuration*1000);if(frameAges.length>3000)frameAges.shift();video.requestVideoFrameCallback(frameProbe);}video.requestVideoFrameCallback(frameProbe);true");
   await pause(5000);await run(viewer,"frameAges=[];frameWork=[];true");const a=await read(host),b=await read(viewer);const timeline=[];for(let n=0;n<(option('duration')||15);n++){await pause(1000);if(network&&n===7&&option('network-recover'))network.setRate(option('network-recover'));const s=await read(host);timeline.push({profile:s.profile,capacity:s.capacity,limitation:s.limitation,frames:s.frames,encode:s.encode,width:s.width,height:s.height});}const c=await read(host),d=await read(viewer);
   const result={senderFps:(c.frames-a.frames)*1000/(c.time-a.time),receiverFps:(d.frames-b.frames)*1000/(d.time-b.time),mbps:(c.bytes-a.bytes)*8/(c.time-a.time)/1000,encodeMs:(c.encode-a.encode)*1000/(c.frames-a.frames),decodeMs:(d.decode-b.decode)*1000/(d.frames-b.frames),jitterMs:(d.jitter-b.jitter)*1000/(d.emitted-b.emitted),queueMs:(c.sendDelay-a.sendDelay)*1000/(c.packets-a.packets),final:c};
   const age=await run(viewer,"(()=>{const a=frameAges.sort((x,y)=>x-y);return {samples:a.length,medianMs:a[Math.floor(a.length/2)],p95Ms:a[Math.floor(a.length*.95)],decoderMs:frameWork.length?frameWork.reduce((x,y)=>x+y)/frameWork.length:null}})()");
   if(!(result.receiverFps>0))throw Error('No decoded frames crossed the measured link');
   if(network&&(!c.relay||!d.relay||network.counters.bytes<1000))throw Error('The measured video bypassed the UDP bottleneck: '+JSON.stringify({senderRelay:c.relay,receiverRelay:d.relay,bytes:network.counters.bytes}));
   if(network&&option('network-recover')&&option('duration')>=60&&c.width<Math.min(1280,c.capture?.width||1280))throw Error('Video detail did not recover after the bottleneck was removed');
   await run(viewer,"controlChannel.send(JSON.stringify({type:'viewer-state',active:false}));true");await until(host,"sender.getParameters().encodings[0].maxFramerate===3");await pause(1000);const idleA=await read(host);await pause(3000);const idleB=await read(host),backgroundFps=(idleB.frames-idleA.frames)*1000/(idleB.time-idleA.time);
   await run(viewer,"controlChannel.send(JSON.stringify({type:'viewer-state',active:true}));true");await until(host,"sender.getParameters().encodings[0].maxFramerate>3");await pause(1000);const activeA=await read(host);await pause(3000);const activeB=await read(host),restoredFps=(activeB.frames-activeA.frames)*1000/(activeB.time-activeA.time);if(backgroundFps>5||!network&&restoredFps<10)throw Error('Background frame budget did not reduce and recover actual encode work.');
   console.log('MEDIA_PERFORMANCE '+JSON.stringify({...result,backgroundFps,restoredFps,age,timeline,network:network?{kbps:option('network-kbps'),rttMs:option('network-rtt')||0,lossPercent:option('network-loss')||0,...network.counters}:undefined}));app.quit();return;
  }
  if(!await run(viewer,"document.querySelector('#privacy-screen').disabled"))throw Error('Privacy screen available without prior consent');
  const refused="api.privacyScreen(true).then(()=>false,()=>true)";
  if(!await run(host,refused))throw Error('Main process did not enforce consent');
  await run(host,'(async()=>{Object.assign(config,await api.videoPreferences({allowPrivacyScreen:true}));return true})()');
  if(!await run(host,refused))throw Error('Enabling consent mid-session granted retroactive permission');
  await run(viewer,"document.querySelector('#disconnect').click();true");await until(host,"role==='idle'");await join(viewer);
  await until(viewer,"!document.querySelector('#privacy-screen').disabled");
  await run(viewer,"document.querySelector('#live-quality').value='economy';document.querySelector('#live-quality').dispatchEvent(new Event('change'));true");
  await until(host,"videoQuality?.automatic===false&&videoQuality.name==='economy'");
  if(!await run(viewer,"(async()=>(await api.config()).autoQuality===false)()"))throw Error('Fixed quality preference was not persisted');
  await run(viewer,"document.querySelector('#live-quality').value='auto';document.querySelector('#live-quality').dispatchEvent(new Event('change'));true");await until(host,'videoQuality?.automatic===true');
  await run(host,"(async()=>{await videoQuality.queue;while(videoQuality.polling)await new Promise(r=>setTimeout(r,20));const report=new Map(await pc.getStats());for(const [id,value] of report)if(value.type==='candidate-pair')report.set(id,{...value,availableOutgoingBitrate:600000});const video=[...report.values()].find(s=>s.type==='outbound-rtp'&&s.kind==='video');const at=performance.now();videoQuality.policy.sample(report,at-1000);report.set(video.id,{...video,packetsSent:video.packetsSent+100,qualityLimitationReason:'bandwidth'});videoQuality.policy.sample(report,at-500);report.set(video.id,{...video,packetsSent:video.packetsSent+200,qualityLimitationReason:'bandwidth'});const plan=videoQuality.policy.sample(report,at);await videoQuality.apply(plan.name,plan.bitrate);return true})()");
  await until(host,"videoQuality.automatic===true&&['survival','narrow','mobile','economy'].includes(videoQuality.name)");await until(viewer,"document.querySelector('#remote-video').videoWidth<=1280");
  log('Simulated poor capacity in real RTC stats lowered sender resolution/bitrate while automatic mode stayed enabled');
  log('Real RTC: automatic default, manual override, persistence, re-enable and prior-session privacy consent passed');
  const display=screen.getPrimaryDisplay(),bounds={x:display.bounds.x+40,y:display.bounds.y+40,width:400,height:260};
  privacy.screen={getAllDisplays:()=>[{id:display.id,bounds}]};privacy.escapeAvailable=()=>true;
  // Keep acceptance covers inside a small test rectangle. Geometry across all
  // physical monitors and emergency/timeout restoration are unit-tested.
  target=new BrowserWindow({...bounds,frame:false,focusable:false,alwaysOnTop:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await target.loadURL('data:text/html,'+encodeURIComponent('<!doctype html><style>html,body{margin:0;width:100%;height:100%}button{width:100%;height:100%;border:0;background:rgb(25,190,125)}</style><button onclick="window.clicks=(window.clicks||0)+1">Privacy capture acceptance</button>'));
  target.setAlwaysOnTop(true,'screen-saver');target.showInactive();
  const x=(bounds.x+bounds.width*.2-display.bounds.x)/display.bounds.width,y=(bounds.y+bounds.height*.2-display.bounds.y)/display.bounds.height;
  const pixel=`(()=>{const v=document.querySelector('#remote-video'),c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const a=c.getContext('2d');a.drawImage(v,0,0);const p=a.getImageData(Math.floor(c.width*${x}),Math.floor(c.height*${y}),1,1).data;return p[1]>120&&p[0]<90&&p[2]>60})()`;
  await until(viewer,pixel);await run(viewer,"document.querySelector('#privacy-screen').click();true");
  await until(viewer,'remotePrivacyActive===true');await pause(1000);
  if(privacy.windows.size!==1||![...privacy.windows.values()].every(w=>w.isVisible()))throw Error('Physical privacy cover did not appear');
  const mask=[...privacy.windows.values()][0],bitmap=(await mask.webContents.capturePage()).toBitmap(),offset=(20*mask.getContentBounds().width+20)*4;
  if(bitmap[offset]>20||bitmap[offset+1]>20||bitmap[offset+2]>20)throw Error('Local privacy cover was not black');
  if(!await run(viewer,pixel))throw Error('Privacy cover leaked into captured remote video');
  helper=spawn(path.join(__dirname,'../native/publish/ShatootConnect.Input.exe'),[],{windowsHide:true,stdio:['pipe','ignore','pipe']});helper.stdin.on('error',()=>{});
  await pause(2200);const physical=screen.dipToScreenRect(null,bounds);
  for(const data of [{type:'bounds',...physical,sharedCursor:true},{type:'button',button:0,down:true,x:.5,y:.5},{type:'button',button:0,down:false,x:.5,y:.5}])helper.stdin.write(JSON.stringify(data)+'\n');
  await until(target,'window.clicks===1');helper.stdin.end();helper=null;
  log('Protected black cover stays absent from live remote video; native shared mouse clicks through the cover');
  extra=createWindow();await until(extra,'window.shatootconnectReady===true');await join(extra);await until(extra,"!document.querySelector('#privacy-screen').disabled");
  const worker=[...states.values()].find(s=>s.owner===states.get(host.webContents.id));if(!worker)throw Error('Additional viewer did not use its own sender');
  await run(extra,"document.querySelector('#live-quality').value='economy';document.querySelector('#live-quality').dispatchEvent(new Event('change'));true");
  await until(worker.win,"window.shatootconnectHostDiagnostics?.().automaticQuality===false&&window.shatootconnectHostDiagnostics().qualityProfile==='economy'");
  if(!await run(host,'videoQuality.automatic===true'))throw Error('One viewer changed a different viewer’s quality');
  await run(extra,"document.querySelector('#privacy-screen').click();true");await until(extra,'remotePrivacyActive===true');
  if(privacy.owners.size!==2)throw Error('Additional viewer privacy request was not tracked');
  await run(viewer,"document.querySelector('#privacy-screen').click();true");await until(viewer,'remotePrivacyActive===false');if(privacy.owners.size!==1)throw Error('One viewer restored another active request');
  await run(extra,"document.querySelector('#disconnect').click();true");
  for(let n=0;n<30&&privacy.owners.size;n++)await pause(100);if(privacy.windows.size)throw Error('Disconnected worker retained privacy covers');
  await run(viewer,"document.querySelector('#privacy-screen').click();true");await until(viewer,'remotePrivacyActive===true');
  await run(host,'(async()=>{Object.assign(config,await api.videoPreferences({allowPrivacyScreen:false}));return true})()');await until(viewer,'remotePrivacyActive===false&&remotePrivacyAllowed===false');
  if(privacy.windows.size)throw Error('Revoking consent did not immediately restore displays');
  log('Multiple viewers have independent quality and privacy leases; worker disconnect and consent revocation restore displays');
  const beforeRecovery=await run(viewer,'peerGeneration');
  await run(viewer,"remoteRetry=new window.SessionReconnect({connect:target=>joinTarget(target,true)});remoteRetry.arm(connectionAttempt);remoteRetry.connected();directSocket.close();true");
  await until(viewer,`peerGeneration>${beforeRecovery}&&role==='viewer'&&pc?.connectionState==='connected'&&document.querySelector('#remote-video').videoWidth>0`);
  if(!await run(viewer,"remoteRetry.wanted&&remoteRetry.state==='connected'"))throw Error('Live media did not resume after an unexpected transport closure');
  await run(host,"document.querySelector('#disconnect').click();true");await until(viewer,"role==='idle'&&!remoteRetry.wanted");await pause(2300);
  if(!await run(viewer,"role==='idle'&&remoteRetry.state==='idle'"))throw Error('Explicit host disconnect restarted the live connection');
  log('Real RTC transport interruption reconnects through fresh host approval; explicit host disconnect cancels recovery');
  console.log('SHATOOTCONNECT_MEDIA_SMOKE passed');
 }catch(error){
  if(network)console.error('MEDIA_NETWORK_FAILURE '+JSON.stringify({counters:network.counters,host:await run(host,"({role,signal:pc?.signalingState,local:pc?.localDescription?.type,remote:pc?.remoteDescription?.type,gather:pc?.iceGatheringState,policy:pc?.getConfiguration().iceTransportPolicy,servers:pc?.getConfiguration().iceServers?.length,state:pc?.connectionState,ice:pc?.iceConnectionState,candidates:pc?.localDescription?.sdp.split('\\r\\n').filter(l=>l.startsWith('a=candidate')),errors:iceErrors})").catch(()=>null),viewer:await run(viewer,"({role,signal:pc?.signalingState,local:pc?.localDescription?.type,remote:pc?.remoteDescription?.type,gather:pc?.iceGatheringState,policy:pc?.getConfiguration().iceTransportPolicy,servers:pc?.getConfiguration().iceServers?.length,state:pc?.connectionState,ice:pc?.iceConnectionState,candidates:pc?.localDescription?.sdp.split('\\r\\n').filter(l=>l.startsWith('a=candidate')),errors:iceErrors})").catch(()=>null)}));
  throw error;
 }finally{
  network?.close();helper?.stdin.end();privacy.clear('closed');privacy.screen=savedScreen;privacy.escapeAvailable=savedEscape;
  target?.destroy();extra?.destroy();viewer?.destroy();
 }
 app.quit();
};
