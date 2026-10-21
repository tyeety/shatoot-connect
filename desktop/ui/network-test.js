'use strict';
window.testTurnRelay = async iceServers => {
  if (!iceServers.some(s => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(u => /^turns?:/.test(u)))) throw new Error('No TURN server configured. Ask the server administrator to configure internet relay.');
  const a = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' });
  const b = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' });
  const queuedA = [], queuedB = [];
  a.onicecandidate = e => { if (e.candidate) { if (b.remoteDescription) b.addIceCandidate(e.candidate).catch(() => {}); else queuedB.push(e.candidate); } };
  b.onicecandidate = e => { if (e.candidate) { if (a.remoteDescription) a.addIceCandidate(e.candidate).catch(() => {}); else queuedA.push(e.candidate); } };
  let timer, channel;
  try {
    const result = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('TURN relay probe timed out. Check TURN credentials, firewall, TLS and relay ports.')), 18000);
      b.ondatachannel = event => { event.channel.onmessage = () => event.channel.send('pong'); };
      channel = a.createDataChannel('shatootconnect-relay-probe');
      let sent;
      channel.onopen = () => { sent = performance.now(); channel.send('ping'); };
      channel.onmessage = async () => {
        const rtt = Math.round(performance.now() - sent);
        const stats = await a.getStats();
        const pair = [...stats.values()].find(s => s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated);
        if (!pair || stats.get(pair.localCandidateId)?.candidateType !== 'relay') { reject(new Error('Relay candidate was not selected.')); return; }
        resolve({ ok: true, rttMs: rtt, route: 'TURN' });
      };
      a.onconnectionstatechange = () => { if (a.connectionState === 'failed') reject(new Error('TURN relay connection failed.')); };
    });
    await a.setLocalDescription(await a.createOffer()); await b.setRemoteDescription(a.localDescription);
    for (const candidate of queuedB.splice(0)) await b.addIceCandidate(candidate);
    await b.setLocalDescription(await b.createAnswer()); await a.setRemoteDescription(b.localDescription);
    for (const candidate of queuedA.splice(0)) await a.addIceCandidate(candidate);
    return await result;
  } finally { clearTimeout(timer); channel?.close(); a.close(); b.close(); }
};
