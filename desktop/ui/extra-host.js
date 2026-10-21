'use strict';
(() => {
  const api = window.shatootconnect;
  let config, pc, stream, sender, exchange, control, pointer, allowed = false, profile, candidates = [], stopped = false, queue = Promise.resolve(), sync = new window.LayoutSync(true);
  const send = data => api.hostSend(data);
  function stop() { if (stopped) return; stopped = true; exchange?.close(); pc?.close(); stream?.getTracks().forEach(t => t.stop()); api.revoke(); api.watchKeyboard(false); send({ type: 'desktop-end' }); }
  window.shatootconnectCapture = async () => { const p = config.profiles[profile] || config.profiles.speed; stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'never', frameRate: { ideal: p.fps, max: p.fps }, width: { max: p.width }, height: { max: p.height } }, audio: false }); stream.getVideoTracks()[0].contentHint = ['lan','quality'].includes(profile) ? 'detail' : 'motion'; stream.getVideoTracks()[0].onended = stop; };
  async function quality(name) {
    const p = config.profiles[name]; if (!p || !stream) return; profile = name;
    const track = stream.getVideoTracks()[0]; track.contentHint = ['lan','quality'].includes(name) ? 'detail' : 'motion';
    await track.applyConstraints({ width: { max: p.width }, height: { max: p.height }, frameRate: { ideal: p.fps, max: p.fps } });
    if (sender) { const params = sender.getParameters(); if (!params.encodings?.length) params.encodings = [{}]; Object.assign(params.encodings[0], { maxBitrate: p.bitrate, maxFramerate: p.fps, priority: 'high', networkPriority: 'high' }); params.degradationPreference = ['lan','quality'].includes(name) ? 'maintain-resolution' : 'maintain-framerate'; await sender.setParameters(params); }
  }
  function bind(channel) {
    channel.onopen = () => { if (channel.label === 'control') api.watchKeyboard(true); };
    channel.onmessage = event => {
      if (typeof event.data !== 'string' || event.data.length > 2048) return;
      let data; try { data = JSON.parse(event.data); } catch { return; }
      if (!data || typeof data !== 'object') return;
      if (data.type === 'profile' && channel.label === 'control') { quality(data.name).catch(stop); return; }
      if (data.type === 'features' && channel.label === 'control') { sync.ready = data.bidirectionalLayout === true; channel.send(JSON.stringify({ type: 'features', keyboardSync: true, bidirectionalLayout: true })); return; }
      if (data.type === 'guest-cursor') { api.guestCursor(data); return; }
      if (!allowed) return;
      if (data.type === 'layout-sync' && channel.label === 'control') { if (sync.receive(data)) api.applyKeyboard(data.layout).catch(() => {}); return; }
      api.input(data);
    };
  }
  api.onKeyboardLayout(layout => { if (allowed && control?.readyState === 'open') { const packet = sync.observe(layout); if (packet) control.send(JSON.stringify(packet)); } });
  api.onKeyboardApplied(data => { if (control?.readyState === 'open') control.send(JSON.stringify(data)); });
  api.onHostCursor(data => { if (pointer?.readyState === 'open') pointer.send(JSON.stringify(data)); });
  api.onHostDisconnect(stop); api.onEmergency(stop);
  api.onHostSignal(message => { queue = queue.then(async () => {
    if (stopped) return;
    if (message.type === 'desktop-ready') {
      if (pc) return;
      pc = new RTCPeerConnection({ iceServers: config.lan ? [] : message.iceServers || [], iceTransportPolicy: !config.lan && message.forceRelay ? 'relay' : 'all', bundlePolicy: 'max-bundle' });
      pc.onicecandidate = event => { if (event.candidate) send({ type: 'desktop-signal', data: { candidate: event.candidate.toJSON() } }); };
      pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') stop(); };
      sender = pc.addTrack(stream.getVideoTracks()[0],stream); const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs; if (codecs) for (const t of pc.getTransceivers()) t.setCodecPreferences([...codecs].sort((a,b) => Number(b.mimeType === 'video/H264')-Number(a.mimeType === 'video/H264')));
      control = pc.createDataChannel('control',{ordered:true}); pointer = pc.createDataChannel('pointer',{ordered:false,maxRetransmits:0}); bind(control); bind(pointer);
      if (allowed) exchange = new window.SessionExchange(pc.createDataChannel('exchange',{ordered:true,priority:'very-low'}), () => {});
      await pc.setLocalDescription(await pc.createOffer()); send({type:'desktop-signal',data:{description:pc.localDescription.toJSON()}}); await quality(profile);
    } else if (message.type === 'desktop-signal' && pc) {
      const data = message.data; if (data.description) { await pc.setRemoteDescription(data.description); for (const candidate of candidates.splice(0)) await pc.addIceCandidate(candidate); }
      else if (data.candidate) { if (pc.remoteDescription) await pc.addIceCandidate(data.candidate); else candidates.push(data.candidate); }
    }
  }).catch(stop); });
  (async () => { config = await api.hostInit(); profile = config.lan ? 'lan' : config.profile; const sources = await api.sources(); await api.selectSource(config.source || sources[0]?.id); const result = await api.approve(config.invitation.name,config.invitation.fixedPassword === true); if (!result.accepted) { send({type:'desktop-reject'}); return; } allowed = result.control; await api.capture(); send({type:'desktop-accept',control:allowed}); })().catch(() => send({type:'desktop-reject'}));
})();
