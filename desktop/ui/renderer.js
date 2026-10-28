'use strict';
const $ = id => document.getElementById(id);
const api = window.shatootconnect;
const tr = value => window.i18n.translate(value);
let config, socket, connectPromise, role = 'idle', stream, pc, sender, controlChannel, pointerChannel;
let iceServers = [], candidates = [], peerGeneration = 0, allowedControl = false, statsTimer, joinTimer, previousStats;
let profileName = 'speed', pointerFrame = 0, latestPointer, toastTimer, currentStats = {};
let requestPending = false, messageQueue = Promise.resolve();
let outgoingAttempt=null,serverAttempt=null,remoteComputer={};
function applyComputerPreview(element,record){element.classList.add('computer-preview');if(record.preview){const image=document.createElement('img');image.className='desktop-preview';image.src=record.preview;image.alt='';image.draggable=false;element.prepend(image);}}
let registered = false, incomingEnabled = true, registrationWanted = true, internetId = '', reconnectTimer, reconnectAttempts = 0, forceRelay = false, requestSerial = 0;
const iceErrors = [];
let directSocket, sessionRoute = 'server', serverIce = [], serverRelay = false;
let exchange, keyboardGrabActive = false, layoutSync, hostCursor, hostPasswordValue = '', hostPasswordShown = false, lastLocalCursor;
const guestShift = new window.GuestShiftState();
const motionSend=new window.MotionSequence(),motionReceive=new window.MotionSequence();let peerMotionV2=false;
let supportsFixedPassword = false, guestKeyboardLayout = '', keyboardTimer, keyboardQueue = Promise.resolve(), keyboardEpoch = 0, peerKeyboardSync = false;
let connectionAttempt, recallRevision=0,remoteRetry,loadingScreen,framePreviewTimer,disconnectTimer,reconnectTextTimer;
let videoQuality,hostPrivacyAllowed=false,remotePrivacyAllowed=false,remotePrivacyActive=false,privacyHeartbeat;
let hostInputState={type:'input-state',reason:'ready'},remoteInputReason='ready';
let cursorSequence=0,lastHostCursorSequence=-1,hostCursorTimer,guestPointerPoint;
function setRemoteInputState(data){
  if(!['ready','host','busy','unavailable'].includes(data.reason))return;
  if(data.reason!==remoteInputReason){remoteInputReason=data.reason;if(remoteInputReason!=='ready'){latestPointer=null;releaseGuestKeyboard();sendGuestCursor({visible:false});}inputLabel(true);}
  renderHostCursor();renderPointerPause();
}
function inputLabel(updateStatus=false){ $('control-label').textContent=tr(!allowedControl?'View only':remoteInputReason==='unavailable'?'Remote input is unavailable. Reconnect.':remoteInputReason==='host'?'Control paused while the host is active':remoteInputReason==='busy'?'Another guest is controlling':'Mouse and keyboard enabled');if(updateStatus&&role==='viewer'&&allowedControl)status(remoteInputReason==='ready'?'Connected. Click the video to send mouse and keyboard input.':$('control-label').textContent,remoteInputReason==='unavailable'); }
api.onInputState(data=>{hostInputState=data;if(role==='host'&&controlChannel?.readyState==='open')controlChannel.send(JSON.stringify(data));});
function signalReady() { return sessionRoute === 'lan-host' || (sessionRoute === 'lan-viewer' ? directSocket : socket)?.readyState === WebSocket.OPEN; }

function status(message, error = false) {if(loadingScreen&&!loadingScreen.box.hidden){loadingScreen.message.textContent=tr(message);loadingScreen.message.classList.toggle('error',error);} const notice=$('file-transfer-status');if(!error&&notice?.dataset.statusError==='true'){notice.hidden=true;notice.textContent='';delete notice.dataset.statusError;}if(error&&notice)notice.dataset.statusError='true'; if(error && role==='viewer' && $('file-transfer-status')){$('file-transfer-status').hidden=false;$('file-transfer-status').textContent=tr(message);} if ($('settings-status')) { $('settings-status').textContent = tr(message); $('settings-status').classList.toggle('error', error); } $('session-status').textContent = tr(message); $('session-status').classList.toggle('error', error); }
function toast(message) { window.actionNotice?.(tr(message)); }
function serverState(online, text) { $('server-status').dataset.state = online ? 'online' : 'offline'; $('server-status').querySelector('span').textContent = tr(text); }
function send(message) {
  if (sessionRoute === 'lan-host') { api.directSend(JSON.parse(JSON.stringify(message))); return; }
  const transport = sessionRoute === 'lan-viewer' ? directSocket : socket;
  if (transport?.readyState !== WebSocket.OPEN) throw new Error('اتصال به سرور برقرار نیست.');
  transport.send(JSON.stringify(message));
}
async function dispatch(message, source = 'server') {
  if (message.type?.startsWith('desktop-')) { if (!incomingEnabled) { const m = { type: 'desktop-reject', session: message.session }; if (source === 'lan-host') api.directSend(m); else socket?.send(JSON.stringify(m)); return; } await api.hostSession(message, source, $('screen-select').value); return; }
  if (message.type?.startsWith('collab-')) { window.collaboration?.receive(message, source === 'lan-host' ? { send: data => api.directSend(data), type: 'incoming-lan' } : { send: data => socket?.send(JSON.stringify(data)), type: 'id', endpoint: config.endpoint }); return; }
  if(message.type==='join-request'){message={...message,name:(await api.computerCard('resolve',{peer:{...message.peer,name:message.name}})).displayName};
    if (role !== 'idle' || requestPending || !incomingEnabled) {
      if (source === 'lan-host') api.directSend({ type: 'reject' });
      else socket?.send(JSON.stringify({ type: 'reject' }));
      return;
    }
    sessionRoute = source;
    iceServers = source === 'server' ? serverIce : []; forceRelay = source === 'server' && serverRelay;
    profileName = config.autoQuality!==false?'balanced':config.qualityProfile;
  }
  if (source !== sessionRoute && message.type !== 'registered') return;
  if (message.type === 'ice' && source === 'server') { serverIce = message.iceServers || []; serverRelay = message.forceRelay === true; }
  await onMessage(message);
}
api.onDirect(message => {
  messageQueue = messageQueue.then(() => dispatch(message, 'lan-host')).catch(e => { stopSession(true); status(e.message, true); });
});
api.onHostSignalOut(message => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); });
function guarded(fn) { return async (...args) => { try { await window.withActionFeedback(args[0]?.currentTarget,()=>fn(...args)); } catch (e) { if(e.name==='AbortError')return;const message=(e.message||String(e)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''); status(message, true); toast(message); } }; }
function updateControls() {
  api.desktopViewing(role==='viewer');
  const busy = { type: 'hosting-busy', busy: role !== 'idle' || requestPending }; if (socket?.readyState === WebSocket.OPEN && registered) socket.send(JSON.stringify(busy)); if (window.shatootconnectDirect) api.directSend(busy);
  const hosting = incomingEnabled && (registered || !!window.shatootconnectDirect);
  renderHostCredentials();
  $('host-start').hidden = hosting; $('host-stop').hidden = !hosting;
  $('host-start').disabled = role !== 'idle'; $('screen-select').disabled = role !== 'idle';
  $('join').disabled = role !== 'idle'; $('join-label').textContent = tr(role === 'joining' ? 'در انتظار تأیید میزبان…' : 'اتصال به دستگاه');
  $('cancel-connection').hidden=!outgoingAttempt;$('cancel-server').hidden=!serverAttempt;
  $('shared-cursor').disabled = role !== 'idle';
  $('unattended').disabled = role !== 'idle' || requestPending || !config?.fixedPassword; $('fixed-password').disabled = role !== 'idle' || requestPending; $('save-fixed-password').disabled = role !== 'idle' || requestPending;
  for (const button of document.querySelectorAll('.favorite-connect,.history-connect')) button.disabled = role !== 'idle' || requestPending;
  $('remote-id').disabled = role !== 'idle'; $('remote-password').disabled = role !== 'idle';
  $('server-url').disabled = role !== 'idle'; $('connect-server').disabled = role !== 'idle'; $('local-server').disabled = role !== 'idle';
  $('copy-id').disabled = !hosting; $('copy-password').disabled = !hosting;
}
function register() {
  if (!registrationWanted || socket?.readyState !== WebSocket.OPEN) return;
  if (config.fixedPassword && !supportsFixedPassword) { status('Fixed password is saved for LAN. Update the Internet server for Internet access.', true); return; }
  socket.send(JSON.stringify({ type: 'register', deviceId: config.deviceId, deviceSecret: config.deviceSecret, name: config.name, avatar: config.avatar, status: config.status,appVersion:config.version,multiDesktop: true, password: config.fixedPassword || '' }));
  status('دریافت شناسه از سرور…');
}
function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  if (!registrationWanted || config?.internetEnabled === false) return;
  const delay = Math.min(15000, 700 * 2 ** Math.min(reconnectAttempts++, 5)) + Math.random() * 500;
  reconnectTimer = setTimeout(() => { if (role === 'idle' && !window.shatootconnectDirect) status('در حال تلاش مجدد برای اتصال به سرور…'); connect().catch(e => { if (!window.shatootconnectDirect && role === 'idle') status(e.message, true); scheduleReconnect(); }); }, delay);
}
function connect() {
  if(connectPromise)return connectPromise;
  if(socket?.readyState===WebSocket.OPEN)return Promise.resolve();
  const attempt=new window.ConnectionAttempt();serverAttempt=attempt;updateControls();
  const pending=connectServer(attempt).finally(()=>{if(serverAttempt===attempt)serverAttempt=null;if(connectPromise===pending)connectPromise=null;updateControls();});
  connectPromise=pending;return pending;
}
async function connectServer(attempt) {
  if (config?.internetEnabled === false) throw new Error(tr('Internet server is disabled. Enter a LAN IP or enable it in Settings.'));
  const endpoint = await attempt.wait(api.validateEndpoint($('server-url').value.trim()));
  $('server-url').value = endpoint;
  serverState(false, 'در حال اتصال…');
  return attempt.wait(new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint); socket = ws;
    let connectionError = '';
    const timeout = setTimeout(() => { ws.close(); reject(new Error('سرور پاسخ نداد. نشانی و دسترسی شبکه را بررسی کنید.')); }, 20000);
    ws.onmessage = event => {
      if (socket !== ws) return;
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'error' && !registered) { connectionError = tr(message.message); reject(new Error(connectionError)); }
      if (message.type === 'hello' && message.service === 'ShatootConnect' && message.protocol === 2) {
        ws.send(JSON.stringify({ type: 'authenticate', serverKey: $('server-key').value.trim() })); return;
      }
      if (message.type === 'ready') {
        if (message.service !== 'ShatootConnect' || message.protocol !== 2) {
          clearTimeout(timeout); ws.close(); reject(new Error(tr('پیکربندی سرور با این نسخه سازگار نیست. سرور را به نسخهٔ جدید ارتقا دهید.'))); return;
        }
        supportsFixedPassword = message.features?.includes('fixed-password') === true;
        window.collaborationServerReady = message.features?.includes('collaboration-v1') === true;
        clearTimeout(timeout); serverIce = Array.isArray(message.iceServers) ? message.iceServers : []; serverRelay = message.forceRelay === true;
        if (sessionRoute === 'server') { iceServers = serverIce; forceRelay = serverRelay; }
        (config.viewerWindow?Promise.resolve():api.saveEndpoint(endpoint, $('server-key').value.trim())).then(() => {
          if (socket !== ws) return;
          config.endpoint = endpoint;
          reconnectAttempts = 0; clearTimeout(reconnectTimer); serverState(true, 'سرور آمادهٔ اتصال'); register(); resolve();
        }).catch(reject); return;
      }
      messageQueue = messageQueue.then(() => dispatch(message)).catch(e => {
        status(e.message, true); toast(e.message);
        if(pc){if(role==='viewer')interruptSession(e.message);else stopSession(true,'transport-failed');}
      });
    };
    ws.onerror = () => { clearTimeout(timeout); reject(new Error('اتصال به سرور ناموفق بود. IP، پورت و گواهی TLS را بررسی کنید.')); };
    ws.onclose = () => {
      clearTimeout(timeout); reject(new Error('اتصال سرور بسته شد.'));
      if (socket !== ws) return;
      serverState(false, 'ارتباط سرور قطع شد'); socket = null;
      registered = false; internetId = ''; renderHostCredentials();
      if(sessionRoute==='server'&&(role!=='idle'||requestPending)){if(role==='viewer'||role==='joining')interruptSession(connectionError||'Connection interrupted. Trying to recover…');else stopSession(false);}
      updateControls();
      scheduleReconnect();
    };
  }));
}
$('cancel-server').onclick=()=>{const attempt=serverAttempt;if(!attempt)return;const previous=socket;socket=null;registered=false;serverAttempt=null;connectPromise=null;registrationWanted=false;clearTimeout(reconnectTimer);attempt.cancel();previous?.close();serverState(false,'Connection cancelled.');updateControls();status('Connection cancelled.');};
async function onMessage(m) {
  if (m.type === 'ice') {
    iceServers = Array.isArray(m.iceServers) ? m.iceServers : []; forceRelay = m.forceRelay === true;
  } else if (m.type === 'registered') {
    registered = true;
    window.collaboration?.notify();
    internetId = m.id.match(/.{1,3}/g).join(' '); $('host-id').textContent = internetId; hostPasswordValue = m.password; $('host-password').textContent = hostPasswordShown ? hostPasswordValue : '••••••••';
    updateControls(); status('شناسه آماده است. برای اتصال، شناسه و رمز را با فرد مورد اعتماد به اشتراک بگذارید.');
    verifyNetwork();
  } else if (m.type === 'waiting') {
    status('درخواست ارسال شد؛ منتظر تأیید میزبان هستیم.');
  } else if (m.type === 'join-request' && (registered || sessionRoute === 'lan-host')) {
    if (role !== 'idle' || requestPending) { send({ type: 'reject' }); return; }
    requestPending = true; const generation = peerGeneration;
    updateControls();
    const serial = ++requestSerial;
    status(window.i18n.language === 'fa' ? `${m.name} منتظر تأیید شماست.` : `${m.name} is waiting for your approval.`);
    // Do not block the message queue with a native consent dialog; a guest can leave meanwhile.
    (async () => { await api.selectSource($('screen-select').value); return api.approve(m.name,m.fixedPassword===true,m.peer); })().then(async result => {
      if (!requestPending || role !== 'idle' || generation !== peerGeneration || serial !== requestSerial) { await api.revoke(); return; }
      if (result.accepted) {
        await api.capture();
        if (!requestPending || generation !== peerGeneration || serial !== requestSerial) { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; await api.revoke(); return; }
        role = 'host';
        updateControls();
      }
      requestPending = false;
      hostPrivacyAllowed=result.privacyAllowed===true; allowedControl = result.control; send({ type: result.accepted ? 'accept' : 'reject', control: result.control });
      if (!result.accepted) { stopSession(false); status('درخواست رد شد؛ میزبان آمادهٔ اتصال بعدی است.'); }
    }).catch(e => {
      requestPending = false; api.revokeControl();
      if (signalReady()) send({ type: 'reject' });
      stopSession(false); status(e.message, true);
    });
  } else if (m.type === 'accepted' && role === 'joining') {
    const generation=peerGeneration;remoteComputer=m.peer||{};if(connectionAttempt)remoteComputer=await api.computerCard('remember',{peer:remoteComputer,route:{address:connectionAttempt.address,endpoint:connectionAttempt.endpoint}});
    if(connectionAttempt)renderHistory(await api.connections('connected',connectionAttempt));
    if(generation!==peerGeneration||role!=='joining')return;
    allowedControl = m.control === true; role = 'viewer';
    if (allowedControl) await api.exchange('viewer-start');
    if(generation!==peerGeneration||role!=='viewer'){api.exchange('stop').catch(()=>{});return;}
    createPeer(); showSession(); status('در حال برقراری اتصال مستقیم…'); updateControls();
  } else if (m.type === 'peer-ready' && role === 'host') {
    createPeer(); showSession();
    sender = pc.addTrack(stream.getVideoTracks()[0], stream);
    preferCodec();
    controlChannel = pc.createDataChannel('control', { ordered: true }); bindChannel(controlChannel);
    pointerChannel = pc.createDataChannel('pointer', { ordered: false, maxRetransmits: 0,priority:'high' }); bindChannel(pointerChannel);
    if (allowedControl) bindExchange(pc.createDataChannel('exchange', { ordered: true, priority: 'very-low' }));
    await pc.setLocalDescription(await pc.createOffer()); send({ type: 'signal', data: { description: pc.localDescription } });
    await applyProfile(profileName);
  } else if (m.type === 'signal' && pc) {
    const active = pc;
    if (m.data.description) {
      await active.setRemoteDescription(m.data.description);
      for (const candidate of candidates.splice(0)) await active.addIceCandidate(candidate);
      if (m.data.description.type === 'offer') {
        preferCodec(); await active.setLocalDescription(await active.createAnswer());
        send({ type: 'signal', data: { description: active.localDescription } });
      }
    } else if (m.data.candidate) {
      if (active.remoteDescription) await active.addIceCandidate(m.data.candidate);
      else candidates.push(m.data.candidate);
    }
  } else if (m.type === 'peer-left') {
    stopSession(false); status('مهمان قطع شد؛ آمادهٔ پذیرش اتصال بعدی.');
  } else if (m.type === 'ended') {
    if(m.retryable===true&&(role==='viewer'||role==='joining'))interruptSession(m.reason||'Connection interrupted. Trying to recover…');else{remoteRetry?.cancel();stopSession(false);showRemoteLoading(m.reason||'The host ended the session.',true);status(m.reason||'اتصال پایان یافت.');}
  } else if (m.type === 'error') {
    if(role==='joining'){if(remoteRetry?.established&&(m.retryable===true||/شناسه یا رمز اتصال درست نیست|این میزبان در حال اتصال است|تلاش زیاد|busy|offline|unavailable/i.test(m.message||''))){interruptSession(m.message,m.retryAfter||(/تلاش زیاد/.test(m.message||'')?60000:0));return;}remoteRetry?.cancel();stopSession(false);showRemoteLoading(m.message,true);}
    status(m.message, true); toast(m.message);
  }
}
function preferCodec() {
  const capabilities = RTCRtpReceiver.getCapabilities('video');
  if (!capabilities) return;
  const preferred = 'video/H264';
  const codecs = [...capabilities.codecs].sort((a, b) => Number(b.mimeType === preferred) - Number(a.mimeType === preferred));
  for (const transceiver of pc.getTransceivers()) if (transceiver.receiver.track.kind === 'video') transceiver.setCodecPreferences(codecs);
}
function createPeer() {
  layoutSync = new window.LayoutSync(role === 'host');motionSend.reset();motionReceive.reset();peerMotionV2=false;
  const active = new RTCPeerConnection({ iceServers, iceTransportPolicy: forceRelay ? 'relay' : 'all', bundlePolicy: 'max-bundle' }); pc = active;
  const generation = peerGeneration;
  active.onicecandidate = event => { if (event.candidate && signalReady() && pc === active) send({ type: 'signal', data: { candidate: event.candidate.toJSON() } }); };
  active.onicecandidateerror = event => { iceErrors.push({ code: event.errorCode, text: event.errorText, url: event.url }); };
  active.ondatachannel = event => {
    if (event.channel.label === 'control') controlChannel = event.channel;
    else if (event.channel.label === 'pointer') pointerChannel = event.channel;
    else if (event.channel.label === 'exchange' && allowedControl) { bindExchange(event.channel); return; }
    else { event.channel.close(); return; }
    bindChannel(event.channel);
  };
  active.ontrack = event => {
    try { if ('jitterBufferTarget' in event.receiver) event.receiver.jitterBufferTarget = 0; if ('playoutDelayHint' in event.receiver) event.receiver.playoutDelayHint = 0; } catch {}
    $('remote-video').srcObject = event.streams[0] || new MediaStream([event.track]);
    $('remote-video').play().catch(() => {});
  };
  active.onconnectionstatechange = () => {
    if (pc !== active || generation !== peerGeneration) return;
    if (active.connectionState === 'connected') {
      clearTimeout(joinTimer);clearTimeout(disconnectTimer);remoteRetry?.connected();
      outgoingAttempt=null;updateControls();
      status(role === 'host' ? 'مهمان متصل است. برای قطع فوری Ctrl + Shift + F12 را بزنید.' : 'متصل شد؛ برای ارسال موس و کیبورد، روی تصویر کلیک کنید.');
      startStats();
    } else if (active.connectionState === 'failed') {
      if(role==='viewer')interruptSession('Connection interrupted. Trying to recover…');else stopSession(true,'transport-failed');
    } else if (active.connectionState === 'disconnected') {
      api.releaseKeys();status('مسیر ارتباط مختل شده؛ در حال تلاش برای بازیابی…',true);clearTimeout(disconnectTimer);disconnectTimer=setTimeout(()=>{if(pc===active&&active.connectionState==='disconnected'){if(role==='viewer')interruptSession('Connection interrupted. Trying to recover…');else stopSession(true,'transport-failed');}},3000);
    }
  };
}
function bindExchange(channel) { if (exchange) { channel.close(); return; } exchange = new window.SessionExchange(channel, (message,error,detail) => { const text=tr(message)+(detail?.percent!==undefined?' '+detail.percent+'%':'');status(text,error); delete $('file-transfer-status').dataset.statusError;$('file-transfer-status').hidden=false; $('file-transfer-status').textContent=text; if (detail?.received) { $('open-received').hidden = false; toast(message); } }); }
function bindChannel(channel) {
  const generation = peerGeneration;
  let opened = false;
  channel.onopen = () => {
    if (opened || generation !== peerGeneration) return; opened = true;
    if (channel.label === 'pointer' && role === 'host' && lastLocalCursor) channel.send(JSON.stringify({ ...lastLocalCursor, sequence:++cursorSequence, visible: config.showHostCursor && lastLocalCursor.visible }));
    if (channel.label === 'control') api.watchKeyboard(true).catch(e => status(e.message, true));
    if(role==='host'&&channel.label==='control')channel.send(JSON.stringify({type:'features',keyboardSync:true,bidirectionalLayout:true,motionV2:true,privacyScreen:hostPrivacyAllowed}));
    if(channel.label==='control'&&role==='host')channel.send(JSON.stringify(hostInputState));
    if (role === 'viewer' && channel.label === 'control') {
      channel.send(JSON.stringify({ type: 'features', keyboardSync: true, bidirectionalLayout: true,motionV2:true, privacyScreen:hostPrivacyAllowed }));
      channel.send(JSON.stringify({ type: 'profile', name: config.qualityProfile, auto:config.autoQuality!==false }));
      if (allowedControl) { api.exchange('viewer-start').catch(e => status(e.message, true)); api.watchKeyboard(true).catch(e => status(e.message, true));  }
    }
  };
  if (channel.readyState === 'open') queueMicrotask(() => channel.onopen());
  channel.onclose=()=>{if(generation===peerGeneration&&role==='viewer'&&channel.label==='control'){clearTimeout(disconnectTimer);disconnectTimer=setTimeout(()=>{if(generation===peerGeneration)interruptSession('Connection interrupted. Trying to recover…');},500);}};
  channel.onmessage = event => {
    if (generation !== peerGeneration) return;
    if (typeof event.data !== 'string' || event.data.length > 2048) return;
    let data; try { data = JSON.parse(event.data); } catch { return; }
    if (!data || typeof data !== 'object') return;
    if(channel.label==='control'&&data.type==='session-ending'&&role==='viewer'){remoteRetry?.cancel();stopSession(false);showRemoteLoading('The host ended the session.',true);return;}
    if(channel.label==='control'&&data.type==='privacy-screen-state'&&role==='viewer'){setRemotePrivacy(data);return;}
    if(channel.label==='control'&&data.type==='privacy-screen'&&role==='host'&&typeof data.active==='boolean'){api.privacyScreen(data.active).then(value=>channel.readyState==='open'&&channel.send(JSON.stringify({type:'privacy-screen-state',...value}))).catch(e=>{if(channel.readyState==='open')channel.send(JSON.stringify({type:'privacy-screen-state',active:false,allowed:false,error:e.message}));});return;}
    if(role==='viewer'&&channel.label==='control'&&data.type==='input-state'){setRemoteInputState(data);return;}
    if (data.type === 'features' && channel.label === 'control') {
      if (role === 'host' && data.keyboardSync === true) channel.send(JSON.stringify({ type: 'features', keyboardSync: true, bidirectionalLayout: true,motionV2:true, privacyScreen:hostPrivacyAllowed }));
      if(role==='viewer'){remotePrivacyAllowed=data.privacyScreen===true&&allowedControl;privacyButton();}
      if(role==='viewer')peerMotionV2=data.motionV2===true;
      if (role === 'viewer') { peerKeyboardSync = data.keyboardSync === true && data.bidirectionalLayout === true; layoutSync.ready = peerKeyboardSync; if (allowedControl) { layoutSync.observed = ''; const initial = layoutSync.observe(guestKeyboardLayout); if (initial) controlChannel.send(JSON.stringify(initial)); } } else layoutSync.ready = data.bidirectionalLayout === true;
      return;
    }
    if (role === 'viewer' && channel.label === 'control' && data.type === 'layout-status') {
      $('keyboard-status').textContent = tr(data.ok ? 'Keyboard synchronized' : 'Keyboard sync failed; typing paused');
      $('keyboard-status').dataset.state = data.ok ? 'ok' : 'error'; return;
    }
    if (data.type === 'guest-cursor' && role === 'host') { api.guestCursor(data); return; }
    if (data.type === 'host-cursor' && role === 'viewer') {
      if(!Number.isFinite(data.x)||!Number.isFinite(data.y)||!Number.isSafeInteger(data.sequence)||data.sequence<=lastHostCursorSequence)return;
      lastHostCursorSequence=data.sequence;hostCursor=data;clearTimeout(hostCursorTimer);
      if(data.visible)hostCursorTimer=setTimeout(()=>{hostCursor=null;renderHostCursor();},2000);
      renderHostCursor();return;
    }
    if (data.type === 'layout-sync' && channel.label === 'control' && allowedControl) { if (layoutSync.receive(data)) { guestKeyboardLayout = data.layout; api.applyKeyboard(data.layout).catch(e => status(e.message, true)); } return; }
    if (role !== 'host') return;
    if (data.type === 'profile' && channel.label === 'control' && config.profiles[data.name]) {
      applyProfile(data.name,data.auto===true).catch(e => status(tr('Quality change failed: ') + tr(e.message), true));
    } else if (allowedControl&&motionReceive.accept(data,channel.label==='pointer')) api.input(data);
  };
}
function sendKeyboardLayout() {
  if (!allowedControl || !layoutSync || controlChannel?.readyState !== 'open') return;
  const message = layoutSync.observe(guestKeyboardLayout); if (message) controlChannel.send(JSON.stringify(message));
}
api.onKeyboardLayout(layout => { if (layoutSync?.expected && layoutSync.expected !== layout && Date.now() < layoutSync.deadline) return; guestKeyboardLayout = layout; sendKeyboardLayout(); });
api.onHostCursor(data => { lastLocalCursor = data; if (role === 'host' && pointerChannel?.readyState === 'open' && pointerChannel.bufferedAmount < 4096) pointerChannel.send(JSON.stringify({ ...data, sequence:++cursorSequence, visible: config.showHostCursor && data.visible })); });
function renderHostCursor() {
  const marker = $('host-cursor'), video = $('remote-video'), stage = $('video-stage');
  if (!config?.showHostCursor || role !== 'viewer' || remoteInputReason!=='host' || hostCursor?.physical!==true || !hostCursor.visible || hostCursor.x < 0 || hostCursor.x > 1 || hostCursor.y < 0 || hostCursor.y > 1 || !video.videoWidth) { marker.hidden = true; return; }
  const width = stage.clientWidth, height = stage.clientHeight, scale = Math.min(width / video.videoWidth, height / video.videoHeight), w = video.videoWidth * scale, h = video.videoHeight * scale;
  marker.style.left = ((width-w)/2+hostCursor.x*w)+'px'; marker.style.top = ((height-h)/2+hostCursor.y*h)+'px'; marker.hidden = false;
}
function renderPointerPause(){
  const badge=$('pointer-pause'),stage=$('video-stage');
  badge.hidden=role!=='viewer'||!allowedControl||remoteInputReason!=='host'||!guestPointerPoint;
  if(badge.hidden)return;
  badge.lastElementChild.textContent=tr('Host active · resumes after 2 s of inactivity');
  badge.style.left=Math.max(0,Math.min(guestPointerPoint.x+18,stage.clientWidth-badge.offsetWidth-4))+'px';
  badge.style.top=Math.max(0,Math.min(guestPointerPoint.y+20,stage.clientHeight-badge.offsetHeight-4))+'px';
}
new ResizeObserver(()=>{renderHostCursor();renderPointerPause();}).observe($('video-stage'));
$('remote-video').addEventListener('resize',()=>{const video=$('remote-video');if(role==='viewer'&&video.videoWidth&&!document.fullscreenElement)requestAnimationFrame(()=>api.fitVideo({width:video.videoWidth,height:video.videoHeight,extraWidth:innerWidth-$('video-stage').clientWidth,extraHeight:innerHeight-$('video-stage').clientHeight}).catch(()=>{}));});
document.addEventListener('dragstart',event=>{if(!event.target.closest('input,textarea,[contenteditable=true],.pinned-draggable'))event.preventDefault();});
api.onKeyboardApplied(data => { if (role === 'host' && controlChannel?.readyState === 'open') controlChannel.send(JSON.stringify(data)); if (!data.ok && allowedControl) { input({ type: 'release' }); status(tr('Keyboard sync failed; typing paused'), true); if (layoutSync) layoutSync.expected = ''; api.currentKeyboard().then(layout => { guestKeyboardLayout = layout; sendKeyboardLayout(); }).catch(e => status(e.message, true)); } });
async function applyProfile(name,automatic=config.autoQuality!==false) {
  if (!config.profiles[name] || !stream) return;
  if(!sender){profileName=name;return;}
  if(!videoQuality){
    videoQuality=new window.StreamQuality({profiles:config.profiles,peer:pc,stream,sender,automatic,profile:name,onChange:value=>{profileName=value.name;currentStats.automaticQuality=value.automatic;currentStats.qualityProfile=value.name;currentStats.targetBitrate=value.bitrate;}});
    await videoQuality.start();
  }else await videoQuality.setMode(automatic,name);
}
function privacyButton(){
  const button=$('privacy-screen');button.hidden=role!=='viewer';button.disabled=!remotePrivacyAllowed||!allowedControl;
  const label=remotePrivacyActive?'Restore remote monitors':'Hide remote monitors';button.title=button.ariaLabel=tr(label);button.lastElementChild.textContent=tr(label);button.setAttribute('aria-pressed',String(remotePrivacyActive));
}
function setRemotePrivacy(value){
  remotePrivacyAllowed=value.allowed===true;remotePrivacyActive=value.active===true;clearInterval(privacyHeartbeat);
  if(remotePrivacyActive&&role==='viewer')privacyHeartbeat=setInterval(()=>{if(controlChannel?.readyState==='open')controlChannel.send(JSON.stringify({type:'privacy-screen',active:true}));},2000);
  privacyButton();if(value.error)toast(value.error);
}
api.onPrivacyScreenState(value=>{hostPrivacyAllowed=value.allowed===true;if(role==='host'&&controlChannel?.readyState==='open')controlChannel.send(JSON.stringify({type:'privacy-screen-state',...value}));});
$('privacy-screen').onclick=guarded(async()=>{if(role!=='viewer'||!remotePrivacyAllowed||controlChannel?.readyState!=='open')return;clearInterval(privacyHeartbeat);controlChannel.send(JSON.stringify({type:'privacy-screen',active:!remotePrivacyActive}));});

function showSession() {
  privacyButton();
  $('session-panel').hidden = false; $('open-received').hidden = true; $('file-transfer-status').hidden=true;
  $('session-title').textContent = role==='host'?'صفحهٔ شما در حال اشتراک‌گذاری است':remoteComputer.displayName||'میز کار از راه دور';
  inputLabel();
  $('live-quality').value = $('quality').value;
  $('live-quality').hidden = role !== 'viewer';
  $('video-stage').hidden = role === 'host';
  document.body.classList.toggle('viewing', role === 'viewer');
  $('fullscreen').hidden = role !== 'viewer'; $('send-files').hidden = !allowedControl;
}
async function exitVideoFullscreen() {
  try { if (document.fullscreenElement) await document.exitFullscreen(); }
  finally { await api.exitFullscreen().catch(() => {}); }
}
function closePeer() {
  captureRemotePreview();clearInterval(framePreviewTimer);clearTimeout(disconnectTimer);
  videoQuality?.stop();videoQuality=null;clearInterval(privacyHeartbeat);hostPrivacyAllowed=remotePrivacyAllowed=remotePrivacyActive=false;api.privacyScreen(false).catch(()=>{});
  remoteComputer={};
  const attempt=outgoingAttempt;outgoingAttempt=null;attempt?.cancel();
  if(!config?.viewerWindow)api.fitVideo(null).catch(()=>{});
  guestCursorPosition=null; keyboardGrabActive = false; api.keyboardGrab(false).catch(() => {}); exchange?.close(); exchange = null;
  keyboardEpoch++; guestShift.reset(); guestKeyboardLayout = ''; layoutSync = null; hostCursor = null; $('host-cursor').hidden = true;
  clearTimeout(hostCursorTimer);lastHostCursorSequence=-1;guestPointerPoint=null;$('pointer-pause').hidden=true;
  clearTimeout(pointerFrame);pointerFrame=0;latestPointer=null;
  peerKeyboardSync = false;peerMotionV2=false;motionSend.reset();motionReceive.reset();
  remoteInputReason='ready';hostInputState={type:'input-state',reason:'ready'};
  exitVideoFullscreen().catch(() => {});
  peerGeneration++; requestSerial++; requestPending = false; allowedControl = false;
  api.revokeControl().catch(() => {});
  clearInterval(keyboardTimer); api.watchKeyboard(false).catch(() => {}); $('keyboard-status').textContent = '';
  clearInterval(statsTimer); clearTimeout(joinTimer); statsTimer = null; previousStats = null;
  controlChannel?.close(); pointerChannel?.close(); pc?.close(); pc = null; sender = null;
  controlChannel = null; pointerChannel = null; candidates = [];
  $('remote-video').srcObject = null; $('video-placeholder').hidden = false;
  $('session-panel').hidden = true; document.body.classList.remove('viewing');
  for (const id of ['stat-rtt','stat-fps','stat-size','stat-bitrate','stat-codec','stat-route']) $(id).textContent = '—';
}
api.onRemoteWindowClose(async()=>{try{stopSession(true);await api.fitVideo(null);}finally{await api.remoteWindowClosed();}});
function stopSession(notify = true,reason='local') {
  if(notify&&reason==='local'){remoteRetry?.cancel();clearInterval(reconnectTextTimer);if(role==='host'&&controlChannel?.readyState==='open')try{controlChannel.send(JSON.stringify({type:'session-ending'}));}catch{}}

  if (notify && signalReady() && (role !== 'idle' || requestPending))try{send({ type: 'end-session',reason:reason==='transport-failed'?'transport-failed':'local' });}catch{}
  closePeer();
  if (stream) { for (const track of stream.getTracks()) { track.onended = null; track.stop(); } stream = null; }
  api.revoke().catch(() => {}); role = 'idle';
  const previousDirect = directSocket; directSocket = null; previousDirect?.close();
  sessionRoute = 'server'; iceServers = serverIce; forceRelay = serverRelay;
  updateControls();
}
function installRemoteLoading(){
 const box=document.createElement('section');box.id='remote-loading';box.className='remote-loading';const image=document.createElement('img');image.className='remote-loading-image';image.alt='';const saved=config.remotePreview;if(saved?.image)image.src=saved.image;else image.hidden=true;
 const shade=document.createElement('div');shade.className='remote-loading-shade';const content=document.createElement('div');content.className='remote-loading-content';const spinner=document.createElement('span');spinner.className='loading-spinner';spinner.setAttribute('aria-hidden','true');const title=document.createElement('h2');title.textContent=config.remoteTarget.address;const message=document.createElement('p');message.id='remote-loading-status';message.setAttribute('role','status');message.textContent=tr('Connecting to the remote computer…');const caption=document.createElement('small');caption.textContent=saved?.kind==='session'?tr('Last session preview'):saved?.image?tr('Saved desktop background'):'';
 const actions=document.createElement('div');actions.className='remote-loading-actions';const main=document.createElement('button');main.className='small-button';main.textContent=tr('Main window');main.onclick=()=>api.showMain();const retry=document.createElement('button');retry.className='small-button';retry.id='remote-retry-now';retry.textContent=tr('Retry now');retry.onclick=guarded(()=>remoteRetry?.state==='waiting'?remoteRetry.retryNow():joinTarget({address:$('remote-id').value,password:$('remote-password').value,endpoint:$('server-url').value,serverKey:$('server-key').value}));const cancel=document.createElement('button');cancel.className='small-button stop';cancel.id='remote-retry-cancel';cancel.textContent=tr('Cancel');cancel.onclick=()=>{remoteRetry?.cancel();stopSession(true);showRemoteLoading('Connection cancelled.',true);};actions.append(main,retry,cancel);
 const card=document.querySelector('.join-card');card.hidden=true;content.append(spinner,title,message,caption,actions,card);box.append(image,shade,content);document.body.append(box);loadingScreen={box,image,message,caption,card,spinner,cancel,retry};
}
function showRemoteLoading(message,manual=false){if(!config?.viewerWindow||!loadingScreen)return;loadingScreen.box.hidden=false;document.body.classList.add('remote-connecting');loadingScreen.message.textContent=tr(message);loadingScreen.card.hidden=!manual;loadingScreen.spinner.hidden=manual;loadingScreen.cancel.hidden=manual;loadingScreen.retry.hidden=!manual&&remoteRetry?.state!=='waiting';}
function captureRemotePreview(){if(!config?.viewerWindow||role!=='viewer'||!loadingScreen)return;const video=$('remote-video');if(!video.videoWidth||video.readyState<2)return;try{const canvas=document.createElement('canvas'),scale=Math.min(640/video.videoWidth,360/video.videoHeight,1);canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));canvas.getContext('2d',{alpha:false}).drawImage(video,0,0,canvas.width,canvas.height);const image=canvas.toDataURL('image/jpeg',.45);loadingScreen.image.src=image;loadingScreen.image.hidden=false;loadingScreen.caption.textContent=tr('Last session preview');api.saveRemotePreview({image,deviceId:remoteComputer.deviceId}).catch(()=>{});}catch{}}
function remoteFrameReady(){if(!config?.viewerWindow||!loadingScreen)return;loadingScreen.box.hidden=true;document.body.classList.remove('remote-connecting');remoteRetry?.connected();captureRemotePreview();clearInterval(framePreviewTimer);framePreviewTimer=setInterval(captureRemotePreview,15000);}
function interruptSession(message,minimum=0){const recover=!!remoteRetry?.wanted&&remoteRetry.established;stopSession(true,'transport-failed');if(recover){remoteRetry.interrupted(minimum);showRemoteLoading(message);}else showRemoteLoading(message,true);status(message,true);}
function startStats() {
  clearInterval(statsTimer);
  let polling = false;
  statsTimer = setInterval(async () => {
    if (!pc || polling) return;
    polling = true;
    try {
      const active = pc, report = await active.getStats();
      if (active !== pc) return;
      let video, transport, pair;
      for (const s of report.values()) {
        if (s.type === (role === 'host' ? 'outbound-rtp' : 'inbound-rtp') && s.kind === 'video' && !s.isRemote) video = s;
        if (s.type === 'transport' && s.selectedCandidatePairId) transport = s;
      }
      if (transport) pair = report.get(transport.selectedCandidatePairId);
      if (!video) return;
      const bytes = role === 'host' ? video.bytesSent : video.bytesReceived;
      const bitrate = previousStats && video.timestamp > previousStats.timestamp ? (bytes - previousStats.bytes) * 8 / (video.timestamp - previousStats.timestamp) / 1000 : 0;
      previousStats = { bytes, timestamp: video.timestamp };
      const codec = report.get(video.codecId)?.mimeType?.replace('video/', '') || '—';
      const relay = pair && [report.get(pair.localCandidateId), report.get(pair.remoteCandidateId)].some(c => c?.candidateType === 'relay');
      currentStats = { connection: active.connectionState, width: video.frameWidth || 0, height: video.frameHeight || 0,
        fps: video.framesPerSecond || 0, mbps: Number(bitrate.toFixed(2)), rttMs: pair?.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
        codec, route: pair ? relay ? 'TURN' : 'direct' : 'unknown', framesDecoded: video.framesDecoded || 0,
        framesDropped: video.framesDropped || 0, limitation: video.qualityLimitationReason || null };
      $('stat-rtt').textContent = currentStats.rttMs === null ? '—' : `${currentStats.rttMs} ms`;
      $('stat-fps').textContent = `${Math.round(currentStats.fps)} fps`;
      $('stat-size').textContent = `${currentStats.width} × ${currentStats.height}`;
      $('stat-bitrate').textContent = `${currentStats.mbps} Mbps`;
      $('stat-codec').textContent = codec; $('stat-route').textContent = pair ? relay ? 'مسیر TURN' : 'مسیر مستقیم' : 'در حال بررسی مسیر';
    } catch {} finally { polling = false; }
  }, 1000);
}

// Normalize against the displayed video, excluding the letterbox margins.
function position(event) {
  const video = $('remote-video'), r = video.getBoundingClientRect();
  if (!video.videoWidth || !r.width || !r.height) return null;
  const scale = Math.min(r.width / video.videoWidth, r.height / video.videoHeight);
  const w = video.videoWidth * scale, h = video.videoHeight * scale;
  const x = (event.clientX - r.left - (r.width - w) / 2) / w;
  const y = (event.clientY - r.top - (r.height - h) / 2) / h;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
function input(data, pointer = false) {
  if (data.type === 'release') { keyboardEpoch++; guestShift.reset(); }
  if (role !== 'viewer' || !allowedControl) return;
  if(remoteInputReason!=='ready'&&data.type!=='release')return;
  if(['button','wheel','release'].includes(data.type)){clearTimeout(pointerFrame);pointerFrame=0;latestPointer=null;}
  if(peerMotionV2&&['move','button','wheel','release'].includes(data.type))data=motionSend.packet(data);
  // Absolute button coordinates form reliable barriers; disposable motion uses
  // an epoch/sequence guard so older datagrams cannot cross a click/drag edge.
  // Legacy peers retain the existing ordered path.
  const channel=data.type==='move'?(peerMotionV2&&pointerChannel?.readyState==='open'?pointerChannel:controlChannel):pointer?pointerChannel:controlChannel;
  if (channel?.readyState === 'open' && channel.bufferedAmount < (data.type==='move'?1024:32768)) channel.send(JSON.stringify(data));
  else if (data.type!=='move'&&!pointer && channel?.readyState === 'open') stopSession(true); // Never silently lose a key-up.
}
const stage = $('video-stage');
const activeGuestPointers = new Set(); let guestCursorPosition;
function sendGuestCursor(position) { if (role === 'viewer' && pointerChannel?.readyState === 'open' && pointerChannel.bufferedAmount < 4096) pointerChannel.send(JSON.stringify({type:'guest-cursor', ...position, visible:position.visible&&remoteInputReason==='ready'})); }
setInterval(()=>{ if (guestCursorPosition && role === 'viewer') sendGuestCursor(guestCursorPosition); },1000);
stage.addEventListener('pointerleave',()=>{guestPointerPoint=null;renderPointerPause();guestCursorPosition=null;latestPointer=null;sendGuestCursor({visible:false});});
stage.addEventListener('pointermove', event => {
  const p = position(event),bounds=stage.getBoundingClientRect();guestPointerPoint=p?{x:event.clientX-bounds.left,y:event.clientY-bounds.top}:null;renderPointerPause();
  if (!p) {guestCursorPosition=null;latestPointer=null;sendGuestCursor({visible:false});return;}
  guestCursorPosition = { ...p, visible:true }; latestPointer = p; if (pointerFrame) return;
  pointerFrame = setTimeout(() => { pointerFrame = 0; if (guestCursorPosition) sendGuestCursor(guestCursorPosition); if (latestPointer) input({ type: 'move', ...latestPointer }, true); }, 8);
});
stage.addEventListener('pointerdown', event => {
  if (!allowedControl) return; const p = position(event); if (!p) return;
  event.preventDefault(); stage.focus(); stage.setPointerCapture(event.pointerId);
  activeGuestPointers.add(event.pointerId);
  if (role === 'viewer' && peerKeyboardSync) api.keyboardGrab(true).catch(e => status(e.message, true));
  latestPointer = p; guestCursorPosition={...p,visible:true};sendGuestCursor(guestCursorPosition);
  input({ type: 'button', button: event.button, down: true, ...p });
});
stage.addEventListener('pointerup', event => {
  activeGuestPointers.delete(event.pointerId);
  const p = position(event) || latestPointer;
  if (p) input({ type: 'button', button: event.button, down: false, ...p });
  if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
});
stage.addEventListener('pointercancel', () => { activeGuestPointers.clear(); input({ type: 'release' }); });
stage.addEventListener('lostpointercapture', event => { if (activeGuestPointers.delete(event.pointerId)) input({ type: 'release' }); });
stage.addEventListener('contextmenu', e => e.preventDefault());
stage.addEventListener('wheel', e => {
  if (!allowedControl) return; e.preventDefault();
  const factor = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
  input({ type: 'wheel', dx: Math.round(e.deltaX * factor), dy: Math.round(e.deltaY * factor), ...(position(e) || latestPointer || {}) });
}, { passive: false });
async function sendGuestKey(data, paste = false, shift) {
  const generation = peerGeneration, epoch = keyboardEpoch;
  keyboardQueue = keyboardQueue.then(async () => {
    if (generation !== peerGeneration || epoch !== keyboardEpoch || role !== 'viewer' || !allowedControl) return;
    if (paste && exchange) await exchange.flushClipboard();
    const layout = layoutSync?.expected || guestKeyboardLayout || await api.currentKeyboard();
    if (generation !== peerGeneration || epoch !== keyboardEpoch || role !== 'viewer' || !allowedControl) return;
    guestKeyboardLayout = layout;
    if (remoteInputReason !== 'ready') return;
    for (const packet of guestShift.packets(data, shift)) input({ ...packet, layout });
  }).catch(e => { if (generation === peerGeneration && epoch === keyboardEpoch) { input({ type: 'release' }); status(e.message, true); } });
}
api.onGrabbedKey(data => {
  if (data.ready) { keyboardGrabActive = true; return; }
  if (data.error || data.stopped) { keyboardGrabActive = false; input({ type: 'release' }); if (data.error) status(data.error, true); return; }
  if (role !== 'viewer' || !allowedControl || document.activeElement !== stage) return;
  if (data.release) { input({ type: 'release' }); if (data.layoutSwitch) {
    const generation=peerGeneration;
    keyboardQueue=keyboardQueue.then(async()=>{
      const layout=/^[0-9a-f]{8}$/i.test(data.layout)?data.layout:await api.currentKeyboard();
      if(generation!==peerGeneration||role!=='viewer')return;
      guestKeyboardLayout=layout;const packet=layoutSync?.local(layout);
      if(packet&&controlChannel?.readyState==='open')controlChannel.send(JSON.stringify(packet));
    }).catch(e=>status(e.message,true));
  } return; }
  if (!peerKeyboardSync) return;
  sendGuestKey({ type: 'physical-key', vk: data.vk, scan: data.scan, extended: data.extended, down: data.down }, data.down && ((data.ctrl && data.vk === 86) || (data.shift && data.vk === 45)), data.shift);
});
for (const type of ['keydown', 'keyup']) stage.addEventListener(type, e => {
  if (!allowedControl) return;
  if (e.code === 'F12' && e.ctrlKey && e.shiftKey) return;
  if (keyboardGrabActive) { e.preventDefault(); return; }
  if (!peerKeyboardSync) { e.preventDefault(); status(tr('Update both clients to synchronize the keyboard.'), true); return; }
  const layoutShortcut = ((e.altKey || e.ctrlKey) && /^Shift/.test(e.code)) || (e.shiftKey && /^(Alt|Control)/.test(e.code)) || (e.metaKey && e.code === 'Space');
  if (layoutShortcut) { input({ type: 'release' });if(layoutSync){layoutSync.expected='';layoutSync.initial=false;}return; }
  e.preventDefault();
  sendGuestKey({ type: 'key', code: e.code, down: type === 'keydown' }, type === 'keydown' && ((e.ctrlKey && e.code === 'KeyV') || (e.shiftKey && e.code === 'Insert')), e.shiftKey);
});
stage.addEventListener('focus', () => { if (role === 'viewer' && allowedControl && peerKeyboardSync) api.keyboardGrab(true).catch(e => status(e.message, true)); });
function releaseGuestKeyboard() { guestCursorPosition=null; sendGuestCursor({visible:false}); activeGuestPointers.clear(); keyboardGrabActive = false; api.keyboardGrab(false).catch(() => {}); input({ type: 'release' }); }
stage.addEventListener('blur', releaseGuestKeyboard);
window.addEventListener('blur', releaseGuestKeyboard);
window.addEventListener('focus', () => { if (document.activeElement === stage && role === 'viewer' && allowedControl && peerKeyboardSync) api.keyboardGrab(true).catch(e => status(e.message, true)); });
$('open-received').onclick = guarded(() => api.exchange('open-received'));
$('send-files').onclick = guarded(async () => { if (!allowedControl) throw new Error(tr('File transfer requires View, control and files permission.')); if(!exchange || exchange.channel.readyState!=='open')throw new Error(tr('File channel is not ready. Update both clients and reconnect.')); await exchange.sendFiles('pick'); });
stage.addEventListener('dragover', event => { if (allowedControl && event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
stage.addEventListener('drop', event => {
  event.preventDefault();
  if(!event.dataTransfer.files.length)return; if(!allowedControl){status('File transfer requires View, control and files permission.',true);return;} if(!exchange || exchange.channel.readyState!=='open'){status('File channel is not ready. Update both clients and reconnect.',true);return;}
  const files = [...event.dataTransfer.files], p = position(event), generation = peerGeneration;
  guarded(async () => {
    const result = await exchange.sendFiles('drop', files);
    if (result?.clipboardReady === false) { status('Files arrived in Downloads. Open received files on the other computer.', true); return; }
    if (generation !== peerGeneration || !p) return;
    input({ type: 'release' }); input({ type: 'button', button: 0, down: true, ...p }); input({ type: 'button', button: 0, down: false, ...p });
    const layout = await api.currentKeyboard();
    for (const [code, down] of [['ControlLeft', true], ['KeyV', true], ['KeyV', false], ['ControlLeft', false]]) input({ type: 'key', code, down, layout });
  })();
});
window.addEventListener('beforeunload', () => {remoteRetry?.cancel();if(role==='host'){try{if(controlChannel?.readyState==='open')controlChannel.send(JSON.stringify({type:'session-ending'}));if(signalReady())send({type:'end-session',reason:'local'});}catch{}} for (const track of stream?.getTracks() || []) { track.onended = null; track.stop(); } pc?.close(); socket?.close(); });
$('remote-video').addEventListener('loadeddata', () => { $('video-placeholder').hidden = true;remoteFrameReady(); });


$('connect-server').onclick = guarded(async () => {
  config.internetEnabled = await api.internetEnabled(true); $('internet-enabled').checked = true;
  clearTimeout(reconnectTimer); registrationWanted = true;
  stopSession(false); registered = false;
  $('host-id').textContent = '— — —'; $('host-password').textContent = '—';
  if (socket) { const old = socket; socket = null; old.close(); }
  if (connectPromise) await connectPromise.catch(() => {});
  await connect();
});
$('local-server').onclick = guarded(async () => {
  config.internetEnabled = await api.internetEnabled(true); $('internet-enabled').checked = true;
  const result = await api.localServer($('server-url').value.trim());
  $('server-url').value = `ws://127.0.0.1:${result.port}`;
  if (socket) { const old = socket; socket = null; old.close(); }
  registrationWanted = true; registered = false;
  if (connectPromise) await connectPromise.catch(() => {});
  await connect();
  $('server-help').textContent = window.i18n.language === 'fa' ? `سرور محلی فعال است. نشانی دستگاه دیگر: ${result.addresses.join('  یا  ')} — TCP ${result.port}` : `LAN server ready. On the other computer use: ${result.addresses.join(' or ')} — allow TCP ${result.port}.`;
});
$('host-start').onclick = guarded(async () => {
  if (role !== 'idle') return;
  incomingEnabled = true; registrationWanted = config.internetEnabled !== false; updateControls();
  if (!registrationWanted) { await api.directListener(); status(''); return; }
  if (socket?.readyState === WebSocket.OPEN) register(); else await connect();
});
$('host-stop').onclick = () => {
  api.stopHostSessions().catch(e => status(e.message,true));
  stopSession(true); incomingEnabled = false; registrationWanted = false; clearTimeout(reconnectTimer);
  if (socket?.readyState === WebSocket.OPEN) send({ type: 'unregister' });
  registered = false; internetId = ''; renderHostCredentials(); updateControls(); status('اتصال ورودی متوقف شد.');
};
async function joinTarget(record,retrying=false) {
  if(!config.viewerWindow&&!config.smoke)return api.openRemote(record?.address?record:{address:$('remote-id').value,password:$('remote-password').value,endpoint:$('server-url').value,serverKey:$('server-key').value});
  if(role!=='idle'||outgoingAttempt)return;
  if(record?.address){$('remote-id').value=record.address;$('remote-password').value=record.password||'';}
  showRemoteLoading('Connecting to the remote computer…');
  const attempt=new window.ConnectionAttempt();outgoingAttempt=attempt;role='joining';updateControls();
  joinTimer=setTimeout(()=>{if(outgoingAttempt!==attempt)return;if(remoteRetry?.established)interruptSession('Connection timed out. Check host approval and network settings.');else{stopSession(true);showRemoteLoading('Connection timed out. Check host approval and network settings.',true);status('Connection timed out. Check host approval and network settings.',true);}},60000);
  try{
    if(record?.endpoint){
      if(config.internetEnabled===false){config.internetEnabled=await attempt.wait(api.internetEnabled(true));$('internet-enabled').checked=true;}
      if(record.endpoint!==$('server-url').value||record.serverKey!==$('server-key').value){
        clearTimeout(reconnectTimer);serverAttempt?.cancel();serverAttempt=null;connectPromise=null;
        const previous=socket;socket=null;previous?.close();registered=false;
        $('server-url').value=record.endpoint;$('server-key').value=record.serverKey||'';registrationWanted=!config.viewerWindow;
      }
    }
    const id=$('remote-id').value.replace(/\s/g,'');let password=$('remote-password').value;
    if(!password&&config.rememberPasswords){password=await attempt.wait(api.connections('recall',{address:id,endpoint:$('server-url').value}));$('remote-password').value=password;}
    connectionAttempt={address:id,password,endpoint:$('server-url').value,serverKey:$('server-key').value};if(remoteRetry&&!retrying)remoteRetry.arm(connectionAttempt);
    await attempt.wait(api.connections('attempt',connectionAttempt));
    if(id.includes('.')||id.includes(':')){
      if(!password)throw new Error(tr('Enter the host LAN password.'));
      const endpoint=await attempt.wait(api.directEndpoint(id));$('quality').value='lan';profileName='lan';sessionRoute='lan-viewer';iceServers=[];forceRelay=false;
      await attempt.wait(new Promise((resolve,reject)=>{
        const ws=new window.LANSocket(endpoint);directSocket=ws;
        ws.onerror=()=>reject(new Error(tr('Cannot reach the LAN host. Check its IP and allow TCP 8788 in Windows firewall.')));
        ws.onclose=()=>{if(directSocket===ws&&!attempt.cancelled){reject(new Error(tr('LAN connection closed.')));interruptSession('Connection interrupted. Trying to recover…');}};
        ws.onmessage=event=>{
          if(directSocket!==ws||attempt.cancelled)return;let message;try{message=JSON.parse(event.data)}catch{return}
          if(message.type==='ready'){
            if(!message.direct||message.service!=='ShatootConnect'||message.protocol!==2){reject(new Error(tr('This address is not a direct LAN listener.')));ws.close();return;}
            ws.send(JSON.stringify({type:'join',id:'direct',password,name:config.name,deviceId:config.deviceId}));resolve();return;
          }
          messageQueue=messageQueue.then(()=>{if(!attempt.cancelled)return dispatch(message,'lan-viewer')}).catch(e=>{if(!attempt.cancelled){interruptSession(e.message)}});
        };
      }));status('درخواست ارسال شد؛ منتظر تأیید میزبان هستیم.');return;
    }
    if(!/^\d{9}$/.test(id)||!password)throw new Error('شناسهٔ ۹ رقمی و رمز میزبان را وارد کنید.');
    await attempt.wait(connect());attempt.check();send({type:'join',id,password,name:config.name,deviceId:config.deviceId});
    $('session-panel').hidden=false;$('video-stage').hidden=true;$('session-title').textContent='در انتظار تأیید میزبان';$('control-label').textContent='';
  }catch(error){if(attempt.cancelled||outgoingAttempt!==attempt)return;stopSession(false);showRemoteLoading(error.message,!retrying);throw error;}
}
$('cancel-connection').onclick=()=>{if(!outgoingAttempt)return;stopSession(true);status('Connection cancelled.');};
$('join').onclick = guarded(joinTarget);
let computersRevision=0;
window.installPinnedReorder($('favorites-list'),async order=>{await api.computerCard('reorder-pins',{order});});
$('favorites-list').addEventListener('pinned-reorder-end',()=>renderComputers());
function renderFavorites(records){config.favorites=records;return renderComputers();}
async function renderComputers(){
  if($('favorites-list').dataset.reordering==='true')return;
  const revision=++computersRevision,records=await api.connections('computers');if(revision!==computersRevision)return;
  if($('favorites-list').dataset.reordering==='true')return;
  const list=$('favorites-list');list.replaceChildren();$('favorites-empty').hidden=records.length>0;
  window.closeComputerMenu?.();
  for(const record of records){
    const row=document.createElement('div');row.className=record.saved?'favorite-row':'history-row';row.dataset.address=record.address;row.dataset.saved=String(record.saved);row.dataset.connectedAt=String(record.at||0);applyComputerPreview(row,record);
    row.draggable=record.pinned;row.classList.toggle('pinned-draggable',record.pinned);row.dataset.pinKey=record.pinKey;row.title=tr('App version')+': '+(record.appVersion||tr('Version unknown'));
    const connectButton=document.createElement('button');connectButton.className=record.saved?'favorite-connect':'history-connect';connectButton.title=tr('Connect to a computer');
    const wrap=document.createElement('span');wrap.className='avatar-wrap';const avatar=document.createElement('img');avatar.className='profile-avatar';avatar.src=record.avatar||'assets/person.svg';avatar.alt='';const dot=document.createElement('span');const live=window.collaboration?.peer(record.deviceId)||window.collaboration?.nearby?.find(p=>p.deviceId===record.deviceId);dot.className='presence-dot presence-'+(live?record.status||'available':'offline');wrap.append(avatar,dot);
    const name=document.createElement('b');name.textContent=record.displayName||record.name;name.dir='auto';const address=document.createElement('small');address.textContent=record.address;address.dir='ltr';connectButton.append(wrap,name,address);
    const resolve=()=>record.saved?api.favoriteGet(record.id):api.connections('get',record.id);
    connectButton.onclick=guarded(async()=>connectRecord(await resolve()));
    const actions=document.createElement('div');actions.className='favorite-actions';
    const button=(icon,title,action,cls)=>{const control=document.createElement('button');control.className='icon-button '+cls;control.title=tr(title);control.setAttribute('aria-label',control.title);control.innerHTML='<span class="mi '+icon+'" aria-hidden="true"></span>';control.onclick=guarded(action);actions.append(control);return control;};
    button('chat','Start chat',async()=>{const session=await window.messenger.start({type:record.endpoint?'id':'lan',address:record.address,endpoint:record.endpoint,deviceId:record.deviceId,name:record.displayName||record.name});if(session?.peer)await api.openChat(session.peer.deviceId);},'computer-chat');
    button('screen_share','Connect to a computer',async()=>connectRecord(await resolve()),'computer-connect');
    const more=button('more_horiz','More actions',()=>openComputerMenu(more,record,resolve),'computer-more');
    more.setAttribute('aria-haspopup','menu');more.setAttribute('aria-expanded','false');more.onclick=()=>openComputerMenu(more,record,resolve);
    row.append(connectButton,actions);list.append(row);
  }
}
function openComputerMenu(anchor,record,resolve){
  window.closeComputerMenu?.();const menu=document.createElement('div');menu.className='computer-menu';menu.setAttribute('role','menu');const label=document.createElement('small');label.textContent=tr('App version')+': '+(record.appVersion||tr('Version unknown'));menu.append(label);
  const entries=[['info','System details',()=>window.showComputerInfo(record)],['pin',record.pinned?'Unpin connection':'Pin connection',async()=>{await api.computerCard('pin',{peer:record,pinned:!record.pinned});await renderComputers();}]];
  if(record.saved)entries.push(['edit','Rename saved computer',async()=>saveComputer(await resolve())],['shortcut','Create desktop shortcut',async()=>{await api.favoriteShortcut(record.id);toast('Desktop shortcut created.');}],['close','Delete saved connection',async()=>renderFavorites(await api.favoriteDelete(record.id))]);else entries.push(['person','Save computer',async()=>saveComputer(await resolve())]);
  for(const [icon,title,action]of entries){const item=document.createElement('button');item.type='button';item.setAttribute('role','menuitem');item.className='computer-menu-item';item.innerHTML='<span class="mi '+icon+'" aria-hidden="true"></span>';const text=document.createElement('span');text.textContent=tr(title);item.append(text);item.onclick=guarded(async()=>{close();await action();});menu.append(item);}
  document.body.append(menu);const point=anchor.getBoundingClientRect(),bounds=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(point.right-bounds.width,innerWidth-bounds.width-8))+'px';menu.style.top=Math.max(8,Math.min(point.bottom+4,innerHeight-bounds.height-8))+'px';anchor.setAttribute('aria-expanded','true');
  const outside=event=>{if(!menu.contains(event.target)&&!anchor.contains(event.target))close();};const key=event=>{const items=[...menu.querySelectorAll('button')],i=items.indexOf(document.activeElement);if(event.key==='Escape'){event.preventDefault();close();anchor.focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(i+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();}};
  function close(){menu.remove();anchor.setAttribute('aria-expanded','false');document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key);if(window.closeComputerMenu===close)window.closeComputerMenu=null;}
  window.closeComputerMenu=close;document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key);menu.querySelector('button')?.focus();
}
async function connectFavorite(id) {
  if (role !== 'idle' || requestPending) throw new Error(tr('End the current session first.'));
  const record = await api.favoriteGet(id);
  return connectRecord(record);
}
async function connectRecord(record) {
  if(!config.viewerWindow&&!config.smoke)return api.openRemote({password:'',...record});
  if(role!=='idle')throw new Error('End the current session first.');
  $('remote-id').value=record.address;$('remote-password').value=record.password||'';
  if(record.password)return joinTarget(record);
  if(record.endpoint){
    if(config.internetEnabled===false){config.internetEnabled=await api.internetEnabled(true);$('internet-enabled').checked=true;}
    if(record.endpoint!==$('server-url').value||record.serverKey!==$('server-key').value){
      clearTimeout(reconnectTimer);serverAttempt?.cancel();serverAttempt=null;connectPromise=null;
      const previous=socket;socket=null;previous?.close();registered=false;
      $('server-url').value=record.endpoint;$('server-key').value=record.serverKey||'';registrationWanted=!config.viewerWindow;updateControls();
    }
  }
  showRemoteLoading('Enter the password to connect.',true);$('remote-password').focus();toast('Enter the password to connect.');
}
async function saveComputer(value){
  let modal=$('save-computer-dialog');
  if(!modal){modal=document.createElement('dialog');modal.id='save-computer-dialog';modal.innerHTML='<form id="save-computer-form"><h2>Save computer</h2><label for="saved-computer-name">Computer nickname</label><input id="saved-computer-name" maxlength="60" required autocomplete="off"><p id="save-computer-error" class="status-line error"></p><div class="inline-setting"><button type="submit" class="small-button">Save</button><button type="button" id="cancel-save-computer" class="small-button">Cancel</button></div></form>';document.body.append(modal);}
  if(modal.open)return;
  $('saved-computer-name').value=value.name||config.favorites?.find(r=>r.address===value.address)?.name||value.address||'';$('save-computer-error').textContent='';
  modal.showModal();$('saved-computer-name').focus();$('saved-computer-name').select();
  return new Promise(resolve=>{
    modal.onclose=()=>resolve(false);$('cancel-save-computer').onclick=()=>modal.close();
    $('save-computer-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter||event.target.querySelector('button[type="submit"]');button.disabled=true;try{renderFavorites(await api.favoriteSave({...value,name:$('saved-computer-name').value}));modal.close();toast('Connection saved securely.');resolve(true);}catch(error){$('save-computer-error').textContent=(error.message||String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');}finally{button.disabled=false;}};
  });
}
$('quick-save').onclick=guarded(()=>saveComputer({address:$('remote-id').value,password:$('remote-password').value,endpoint:$('server-url').value,serverKey:$('server-key').value}));
function renderHistory(){return renderComputers();}
let recallTimer;
$('remote-id').addEventListener('input',()=>{const revision=++recallRevision;clearTimeout(recallTimer);$('remote-password').value='';const address=$('remote-id').value,endpoint=$('server-url').value;if(!config?.rememberPasswords)return;recallTimer=setTimeout(async()=>{try{const password=await api.connections('recall',{address,endpoint});if(revision===recallRevision && role==='idle' && $('remote-id').value===address && $('server-url').value===endpoint && !$('remote-password').value)$('remote-password').value=password;}catch{}},180);});
$('server-url').addEventListener('input',()=>{$('remote-id').dispatchEvent(new Event('input'));});
$('remote-password').addEventListener('input',()=>{recallRevision++;});
$('save-fixed-password').onclick = guarded(async () => {
  if (role !== 'idle' || requestPending) return;
  config.fixedPassword = await api.fixedPassword($('fixed-password').value); if (!config.fixedPassword) { config.unattended = false; $('unattended').checked = false; } updateControls();
  $('password-label').textContent = tr(config.fixedPassword ? 'Host password' : 'رمز موقت');
  if (socket?.readyState === WebSocket.OPEN && registered) register();
  status('Host password settings saved.'); toast('Host password settings saved.');
});
function renderHostCredentials() {
  if (!config) return; const direct = window.shatootconnectDirect;
  $('host-id').classList.toggle('lan-address',!registered); $('host-id-label').textContent = tr(registered ? 'شناسهٔ شما' : 'LAN address');
  $('host-id').textContent = registered ? internetId || '— — —' : direct?.addresses[0] || '— — —';
  if (!registered) hostPasswordValue = config.fixedPassword || direct?.password || '';
  $('host-password').textContent = hostPasswordValue ? (hostPasswordShown ? hostPasswordValue : '••••••••') : '—';
}
function renderDirectInfo(info) { window.shatootconnectDirect = info; $('direct-password').textContent = '••••••••'; $('direct-addresses').textContent = info.addresses.join(' / ') || `127.0.0.1:${info.port}`; updateControls(); if(role==='idle'&&!registered)status(''); }
api.onDirectInfo(renderDirectInfo);
api.onConnectFavorite(id => guarded(() => connectFavorite(id))());
function selectSettingsTab(name, focus = false) {
  for (const button of document.querySelectorAll('[data-settings-tab]')) {
    const selected = button.dataset.settingsTab === name;
    button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    $(button.getAttribute('aria-controls')).hidden = !selected; if (selected && focus) button.focus();
  }
}
document.querySelector('.settings-tabs').setAttribute('aria-orientation','vertical');
document.querySelector('.settings-tabs').addEventListener('click',event=>{const tab=event.target.closest('[data-settings-tab]');if(tab)selectSettingsTab(tab.dataset.settingsTab);});
document.querySelector('.settings-tabs').addEventListener('keydown',event=>{
  const button=event.target.closest('[data-settings-tab]');if(!button)return;
  const tabs=[...document.querySelectorAll('[data-settings-tab]')],index=tabs.indexOf(button);let next;
  if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else if(['ArrowUp','ArrowDown'].includes(event.key))next=(index+(event.key==='ArrowDown'?1:tabs.length-1))%tabs.length;
  if(next!==undefined){event.preventDefault();selectSettingsTab(tabs[next].dataset.settingsTab,true);}
});
$('internet-enabled').onchange = guarded(async () => {
  config.internetEnabled = await api.internetEnabled($('internet-enabled').checked); registrationWanted = config.internetEnabled;
  clearTimeout(reconnectTimer);
  if (!config.internetEnabled) { const previous=socket; socket=null; previous?.close(); registered=false; internetId=''; serverState(false,'Internet server disabled; LAN ready'); if (sessionRoute==='server' && role!=='idle') stopSession(false); updateControls(); status(''); }
  else connect().catch(e=>{status(e.message,true);scheduleReconnect();});
});
$('show-guest-cursor').onchange = guarded(async () => { config.showGuestCursor = await api.showGuestCursor($('show-guest-cursor').checked); });
for (const id of ['open-settings','session-settings']) $(id).onclick = () => {if(config.workspace&&config.viewerWindow){api.workspace('select',{id:'settings'});return;}$('settings-dialog').showModal();};
$('show-host-cursor').onchange = guarded(async () => { config.showHostCursor = await api.showHostCursor($('show-host-cursor').checked); renderHostCursor(); if (role === 'host' && lastLocalCursor && pointerChannel?.readyState === 'open') pointerChannel.send(JSON.stringify({ ...lastLocalCursor, sequence:++cursorSequence, visible: config.showHostCursor && lastLocalCursor.visible })); });
for (const button of document.querySelectorAll('[data-password]')) button.onclick = () => { const field = $(button.dataset.password), reveal = field.type === 'password'; field.type = reveal ? 'text' : 'password'; button.setAttribute('aria-pressed', String(reveal)); };
$('show-lan-password').onclick = () => { const field = $('direct-password'), reveal = field.textContent === '••••••••'; field.textContent = reveal ? window.shatootconnectDirect?.password || '' : '••••••••'; };
$('show-host-password').onclick = () => { hostPasswordShown = !hostPasswordShown; $('host-password').textContent = hostPasswordShown ? hostPasswordValue : '••••••••'; $('show-host-password').setAttribute('aria-pressed', String(hostPasswordShown)); };
$('disconnect').onclick = () => { stopSession(true); status('اتصال قطع شد.'); };
$('fullscreen').onclick = guarded(async () => {
  if (document.fullscreenElement) { await exitVideoFullscreen(); return; }
  if (role !== 'viewer' || !pc) return;
  await $('session-panel').requestFullscreen();
  if (role !== 'viewer' || !pc) await exitVideoFullscreen();
});
document.addEventListener('fullscreenchange', () => {
  const full = !!document.fullscreenElement;
  $('fullscreen-icon').className = `mi ${full ? 'fullscreen_exit' : 'fullscreen'}`;
  $('fullscreen-label').textContent = tr(full ? 'Exit full screen' : 'Full screen');
  $('fullscreen').title = $('fullscreen-label').textContent; $('fullscreen').setAttribute('aria-label', $('fullscreen-label').textContent);
});
document.addEventListener('keydown', e => {
  if (e.code === 'Escape' && document.fullscreenElement && document.activeElement !== stage) { e.preventDefault(); e.stopImmediatePropagation(); exitVideoFullscreen().catch(() => {}); }
}, true);
$('unattended').onchange = guarded(async () => { try { config.unattended = await api.unattended($('unattended').checked); } finally { $('unattended').checked = config.unattended === true; } });
$('shared-cursor').onchange = guarded(async () => { $('shared-cursor').checked = await api.sharedCursor($('shared-cursor').checked); });
$('quality').onchange = guarded(async () => {
  const name=$('quality').value,automatic=name==='auto';
  Object.assign(config,await api.videoPreferences({autoQuality:automatic}));
  if(!automatic){config.qualityProfile=await api.qualityProfile(name);profileName=name;}
  $('live-quality').value=name;
  if(role==='viewer'&&controlChannel?.readyState==='open')controlChannel.send(JSON.stringify({type:'profile',name:config.qualityProfile,auto:automatic}));
});
$('allow-privacy-screen').onchange=guarded(async()=>{try{Object.assign(config,await api.videoPreferences({allowPrivacyScreen:$('allow-privacy-screen').checked}));}finally{$('allow-privacy-screen').checked=config.allowPrivacyScreen===true;}});

$('live-quality').onchange = () => { $('quality').value = $('live-quality').value; $('quality').onchange(); };
for (const [button, field] of [['copy-id','host-id'], ['copy-password','host-password']]) $(button).onclick = guarded(async () => {
  await api.copyText(field === 'host-id' ? $(field).textContent.replace(/\s/g, '') : hostPasswordValue || config.fixedPassword || $(field).textContent); toast('کپی شد.');
});
api.onEmergency(() => { stopSession(true); status('اتصال با میان‌بر اضطراری قطع شد.'); toast('اشتراک‌گذاری و کنترل متوقف شدند.'); });
api.onHostDisconnect(() => { stopSession(true); status('اتصال قطع شد.'); });
api.onInputError(() => status(tr('Windows blocked input. Some apps require shared cursor mode; elevated windows and UAC are unsupported.'), true));
window.shatootconnectDiagnostics = () => ({ ...currentStats, automaticQuality:videoQuality?.automatic,qualityProfile:videoQuality?.name,targetBitrate:videoQuality?.bitrate, sessionRoute, videoWidth: $('remote-video').videoWidth, videoHeight: $('remote-video').videoHeight, registered, role, language: window.i18n.language, capturing: !!stream?.getVideoTracks().some(t => t.readyState === 'live'), iceConnectionState: pc?.iceConnectionState, iceGatheringState: pc?.iceGatheringState, iceErrors, networkProbe: $('network-status').textContent, forceRelay, iceUrls: iceServers.map(s => s.urls), localCandidates: pc?.localDescription?.sdp.split('\r\n').filter(l => l.startsWith('a=candidate')) });
let networkBusy = false;
async function verifyNetwork() {
  if (networkBusy) return;
  if (!serverIce.some(s => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(u => /^turns?:/.test(u)))) {
    $('network-status').dataset.result = 'direct'; $('network-status').textContent = tr('Direct P2P mode. Video bypasses the server. Some internet networks require TURN.'); return;
  }
  networkBusy = true; $('network-test').disabled = true; $('network-status').textContent = tr('Testing the TURN relay…');
  try {
    const result = await window.testTurnRelay(iceServers);
    $('network-status').dataset.result = 'pass';
    $('network-status').textContent = window.i18n.language === 'fa' ? `تست واقعی TURN موفق بود: ${result.rttMs} ms. تست دو شبکهٔ مجزا هنوز لازم است.` : `TURN probe passed: ${result.rttMs} ms. Two-network acceptance is still required.`;
  } catch (e) { $('network-status').dataset.result = 'fail'; $('network-status').textContent = tr(e.message); }
  finally { networkBusy = false; $('network-test').disabled = false; }
}
$('network-test').onclick = verifyNetwork;
window.shatootconnectCapture = async () => {
  const p = config.profiles[profileName] || config.profiles.speed;
  stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'never', frameRate: { ideal: p.fps, max: p.fps }, width: { max: p.width }, height: { max: p.height } }, audio: false });
  stream.getVideoTracks()[0].contentHint = profileName === 'quality' ? 'detail' : 'motion';
  stream.getVideoTracks()[0].onended = () => { stopSession(true); status('اتصال پایان یافت.'); };
};
$('language').onchange = guarded(async () => { window.i18n.setLanguage(await api.language($('language').value)); renderFavorites(config.favorites || []); });
(async () => {
  config = await api.config(); registrationWanted = config.internetEnabled !== false; $('internet-enabled').checked = registrationWanted; $('show-guest-cursor').checked = config.showGuestCursor; $('quality').value = config.autoQuality!==false?'auto':config.qualityProfile;profileName=config.autoQuality!==false?'balanced':config.qualityProfile;$('allow-privacy-screen').checked=config.allowPrivacyScreen===true;$('allow-privacy-screen').disabled=!config.privacyScreenSupported; window.i18n.setLanguage(config.language); $('language').value = config.language;
  if(config.viewerWindow){
    registrationWanted=false;incomingEnabled=false;document.body.classList.add('remote-window');if(config.workspace)document.body.classList.add('connection-tab');
    $('server-url').value=config.remoteTarget.endpoint||config.endpoint;$('server-key').value=config.remoteTarget.serverKey||'';$('app-version').textContent='Shatoot Connect '+config.version;
    installRemoteLoading();
    remoteRetry=new window.SessionReconnect({connect:target=>joinTarget(target,true),changed:()=>{clearInterval(reconnectTextTimer);const render=()=>{if(remoteRetry.state==='waiting')showRemoteLoading(tr('Reconnecting in: ')+Math.max(0,Math.ceil((remoteRetry.nextAt-Date.now())/1000))+' '+tr('seconds'));};render();if(remoteRetry.state==='waiting')reconnectTextTimer=setInterval(render,1000);}});
    updateControls();await api.appReady();window.shatootconnectReady=true;await connectRecord(config.remoteTarget);return;
  }
  if(config.workspace)window.installWorkspace();
  renderHistory(await api.connections('history'));
  window.shatootconnectSmoke = config.smoke;
  api.onComputerCards(()=>{api.config().then(c=>renderFavorites(c.favorites));api.connections('history').then(renderHistory);window.collaboration?.refresh();api.discovery().then(v=>window.messenger?.renderDiscovery(v));});
  api.onEditProfile(()=>{$('settings-dialog').showModal();selectSettingsTab('profile');$('profile-name').focus();});
  window.messenger = window.installMessenger({ api, self: { deviceId: config.deviceId, name: config.name, avatar: config.avatar, status: config.status,appVersion:config.version,bio:config.bio,photos:config.photos }, internet: () => ({ registered, supported: window.collaborationServerReady, endpoint: config.endpoint, send: data => { if (socket?.readyState !== WebSocket.OPEN) throw new Error('Not connected to the server.'); socket.send(JSON.stringify(data)); } }), ensureInternet: connect, remote: address => { $('remote-id').value = address; $('remote-password').focus(); } });
  const own=document.createElement('button');own.id='own-profile';own.className='small-button';own.onclick=()=>{$('settings-dialog').showModal();selectSettingsTab('profile');};document.querySelector('main>header').prepend(own);const ownProfile=()=>window.renderChatPerson(own,config);ownProfile();
  api.onProfileChanged(next=>{Object.assign(config,next);if($('profile-status'))$('profile-status').value=next.status;ownProfile();Object.assign(window.collaboration.self,next);if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'profile',name:next.name,status:next.status,avatar:next.avatar}));for(const s of window.collaboration.sessions.values())if(s.channel?.readyState==='open')window.collaboration.rpc(s,'profile',window.collaboration.self).catch(()=>{});window.collaboration.notify();});
  window.installClientSettings(config, async next => {ownProfile(); Object.assign(window.collaboration.self, next); if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({type:'profile',name:next.name,status:next.status,avatar:next.avatar})); for (const s of window.collaboration.sessions.values()) if (s.channel?.readyState === 'open') window.collaboration.rpc(s, 'profile', window.collaboration.self).catch(e => status(e.message,true)); window.collaboration.notify(); });
  $('shared-cursor').checked = config.sharedCursor === true; $('show-host-cursor').checked = config.showHostCursor;
  $('unattended').checked = config.unattended === true; $('fixed-password').value = config.fixedPassword || ''; $('password-label').textContent = tr(config.fixedPassword ? 'Host password' : 'رمز موقت'); renderFavorites(config.favorites || []);
  $('host-stop').innerHTML='<span class="mi pause" aria-hidden="true"></span>';$('host-stop').title=tr('Pause incoming connections');$('host-stop').setAttribute('aria-label',tr('Pause incoming connections'));
  $('server-url').value = config.endpoint; $('server-key').value = config.serverKey || ''; $('app-version').textContent = `Shatoot Connect ${config.version} · Windows x64`;
  const sources = await api.sources(); $('screen-select').replaceChildren();
  for (const source of sources) { const option = document.createElement('option'); option.value = source.id; option.textContent = source.name; $('screen-select').append(option); }
  if (!sources.length) status('نمایشگری شناسایی نشد.', true);
  updateControls(); await api.appReady(); window.shatootconnectReady = true;
  api.directListener().then(info => {
    renderDirectInfo(info);
  }).catch(e => { $('direct-addresses').textContent = tr('LAN listener unavailable: ') + e.message; });
  if (config.pendingFavorite) {
    const record = await api.favoriteGet(config.pendingFavorite);
    if (!record.endpoint && config.internetEnabled !== false) connect().catch(e => { if (!window.shatootconnectDirect && role === 'idle') status(e.message, true); scheduleReconnect(); });
    await connectFavorite(config.pendingFavorite);
  } else if (config.internetEnabled !== false) connect().catch(e => { if (!window.shatootconnectDirect && role === 'idle') status(e.message, true); scheduleReconnect(); });
})().catch(e => status(e.message, true));

api.onConnectComputer(record=>guarded(()=>connectRecord(record))());
api.onSettingsOpen(tab=>{if(!$('settings-dialog').open)$('settings-dialog').showModal();selectSettingsTab(tab);});
