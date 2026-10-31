'use strict';
(() => {
  const api = window.shatootconnect;
  let videoQuality,privacyAllowed=false;
  let hostInputState={type:'input-state',reason:'ready'},lastCursor,cursorSequence=0;
  let config, pc, stream, sender, exchange, control, pointer, allowed = false, profile, candidates = [], stopped = false, queue = Promise.resolve(), sync = new window.LayoutSync(true);
  const send = data => api.hostSend(data);
  window.shatootconnectHostDiagnostics=()=>({active:videoQuality?.active,automaticQuality:videoQuality?.automatic,qualityProfile:videoQuality?.name,privacyAllowed});
  function stop(reason='host-ended') { if (stopped) return; stopped = true;if(reason==='host-ended'&&control?.readyState==='open')try{control.send(JSON.stringify({type:'session-ending'}));}catch{} videoQuality?.stop(); exchange?.close(); pc?.close(); stream?.getTracks().forEach(t => t.stop()); api.revoke(); api.watchKeyboard(false); send({ type: 'desktop-end',reason }); }
  window.shatootconnectCapture = async () => { const p = config.profiles[profile] || config.profiles.speed; stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'never', frameRate: { ideal: p.fps, max: p.fps }, width: { max: p.width }, height: { max: p.height } }, audio: false }); stream.getVideoTracks()[0].contentHint = ['lan','quality'].includes(profile) ? 'detail' : 'motion'; stream.getVideoTracks()[0].onended = ()=>stop(); };
  async function quality(name,automatic=config.autoQuality!==false) {
    if(!config.profiles[name]||!stream)return;
    profile=name;if(!sender)return;
    if(!videoQuality){videoQuality=new window.StreamQuality({profiles:config.profiles,peer:pc,stream,sender,automatic,profile:name});await videoQuality.start();}
    else await videoQuality.setMode(automatic,name);
  }
  api.onPrivacyScreenState(value=>{privacyAllowed=value.allowed===true;if(control?.readyState==='open')control.send(JSON.stringify({type:'privacy-screen-state',...value}));});
  api.onInputState(value=>{hostInputState=value;if(control?.readyState==='open')control.send(JSON.stringify(value));});

  const motionReceive=new window.MotionSequence();
  function bind(channel) {
    channel.onopen = () => {
      if (channel.label === 'control') {api.watchKeyboard(true);channel.send(JSON.stringify({type:'features',keyboardSync:true,bidirectionalLayout:true,motionV2:true,mediaFeedback:true,privacyScreen:privacyAllowed}));channel.send(JSON.stringify(hostInputState));}
      if(channel.label==='pointer'&&lastCursor)channel.send(JSON.stringify({...lastCursor,sequence:++cursorSequence,visible:config.showHostCursor&&lastCursor.visible}));
    };
    channel.onmessage = event => {
      if (typeof event.data !== 'string' || event.data.length > 2048) return;
      let data; try { data = JSON.parse(event.data); } catch { return; }
      if (!data || typeof data !== 'object') return;
      if(data.type==='viewer-state'&&channel.label==='control'&&typeof data.active==='boolean'){videoQuality?.setActive(data.active);return;}
      if(data.type==='media-feedback'&&channel.label==='control'){videoQuality?.feedback(data);return;}
      if (data.type === 'profile' && channel.label === 'control') { quality(data.name,data.auto===true).catch(()=>stop('transport-failed')); return; }
      if (data.type === 'features' && channel.label === 'control') { sync.ready = data.bidirectionalLayout === true; channel.send(JSON.stringify({ type: 'features', keyboardSync: true, bidirectionalLayout: true,motionV2:true, mediaFeedback:true, privacyScreen:privacyAllowed })); return; }
      if (data.type === 'guest-cursor') { api.guestCursor(data); return; }
      if(channel.label==='control'&&data.type==='privacy-screen'&&typeof data.active==='boolean'){api.privacyScreen(data.active).then(value=>channel.readyState==='open'&&channel.send(JSON.stringify({type:'privacy-screen-state',...value}))).catch(e=>{if(channel.readyState==='open')channel.send(JSON.stringify({type:'privacy-screen-state',active:false,allowed:false,error:e.message}));});return;}
      if (!allowed) return;
      if (data.type === 'layout-sync' && channel.label === 'control') { if (sync.receive(data)) api.applyKeyboard(data.layout).catch(() => {}); return; }
      if(motionReceive.accept(data,channel.label==='pointer'))api.input(data);
    };
  }
  api.onKeyboardLayout(layout => { if (allowed && control?.readyState === 'open') { const packet = sync.observe(layout); if (packet) control.send(JSON.stringify(packet)); } });
  api.onKeyboardApplied(data => { if (control?.readyState === 'open') control.send(JSON.stringify(data)); });
  api.onHostCursor(data => {lastCursor=data;if(pointer?.readyState==='open'&&pointer.bufferedAmount<4096)pointer.send(JSON.stringify({...data,sequence:++cursorSequence,visible:config.showHostCursor&&data.visible}));});
  api.onHostDisconnect(()=>stop()); api.onEmergency(()=>stop());
  api.onHostSignal(message => { queue = queue.then(async () => {
    if (stopped) return;
    if (message.type === 'desktop-ready') {
      if (pc) return;
      pc = new RTCPeerConnection({ iceServers: config.lan ? [] : message.iceServers || [], iceTransportPolicy: !config.lan && message.forceRelay ? 'relay' : 'all', bundlePolicy: 'max-bundle' });
      pc.onicecandidate = event => { if (event.candidate) send({ type: 'desktop-signal', data: { candidate: event.candidate.toJSON() } }); };
      pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') stop('transport-failed'); };
      sender = pc.addTrack(stream.getVideoTracks()[0],stream); const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs; if (codecs) for (const t of pc.getTransceivers()) t.setCodecPreferences([...codecs].sort((a,b) => Number(b.mimeType === 'video/H264')-Number(a.mimeType === 'video/H264')));
      control = pc.createDataChannel('control',{ordered:true}); pointer = pc.createDataChannel('pointer',{ordered:false,maxRetransmits:0,priority:'high'}); bind(control); bind(pointer);
      if (allowed) exchange = new window.SessionExchange(pc.createDataChannel('exchange',{ordered:true,priority:'very-low'}), () => {});
      await pc.setLocalDescription(await pc.createOffer()); send({type:'desktop-signal',data:{description:pc.localDescription.toJSON()}}); await quality(profile);
    } else if (message.type === 'desktop-signal' && pc) {
      const data = message.data; if (data.description) { await pc.setRemoteDescription(data.description); for (const candidate of candidates.splice(0)) await pc.addIceCandidate(candidate); }
      else if (data.candidate) { if (pc.remoteDescription) await pc.addIceCandidate(data.candidate); else candidates.push(data.candidate); }
    }
  }).catch(()=>stop('transport-failed')); });
  (async () => { config = await api.hostInit(); profile = config.autoQuality!==false?'balanced':config.profile; const sources = await api.sources(); await api.selectSource(config.source || sources[0]?.id); const result = await api.approve(config.invitation.name,config.invitation.fixedPassword===true,config.invitation.peer,config.lan&&config.invitation.lanPassword===true); if (!result.accepted) { send({type:'desktop-reject'}); return; } allowed = result.control;privacyAllowed=result.privacyAllowed===true; await api.capture(); send({type:'desktop-accept',control:allowed}); })().catch(() => send({type:'desktop-reject'}));
})();
