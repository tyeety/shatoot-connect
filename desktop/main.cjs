const { app, BrowserWindow, ipcMain, desktopCapturer, session, screen, dialog, globalShortcut, clipboard, safeStorage, shell, Tray, Menu, powerMonitor, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { createSignalingServer } = require('../server/index.cjs');
const { PROFILES } = require('../shared/protocol.cjs');
const crypto = require('node:crypto');
const network = require('../shared/network.cjs');

// Peers on routed LAN/VPN subnets cannot resolve link-local mDNS ICE names.
// This app loads only its bundled UI; publish usable host candidates to consented peers.
app.commandLine.appendSwitch('disable-features',[app.commandLine.getSwitchValue('disable-features'),'WebRtcHideLocalIpsWithMdns'].filter(Boolean).join(','));

const smoke = !app.isPackaged && process.argv.includes('--smoke-test');
if(smoke&&process.argv.includes('--chat-notification-smoke'))app.commandLine.appendSwitch('use-fake-device-for-media-stream');
if (smoke) { app.setPath('userData', path.join(__dirname, process.argv.includes('--media-smoke')?'../artifacts/media-profile':'../artifacts/smoke-profile')); const desktop = path.join(__dirname, '../artifacts/test-desktop'); fs.mkdirSync(desktop, { recursive: true }); app.setPath('desktop', desktop); const downloads = path.join(__dirname, '../artifacts/test-downloads'); fs.mkdirSync(downloads, { recursive: true }); app.setPath('downloads', downloads); }
const smokeLog = text => {
  if (smoke) { fs.mkdirSync(path.join(__dirname, '../artifacts'), { recursive: true }); fs.appendFileSync(path.join(__dirname, '../artifacts/smoke.log'), `${new Date().toISOString()} ${text}\n`); }
};
if (smoke) {
  process.on('uncaughtException', error => { smokeLog(`uncaught: ${error.stack}`); app.exit(1); });
  process.on('unhandledRejection', error => { smokeLog(`unhandled: ${error?.stack || error}`); app.exit(1); });
}
const crashProbe=smoke&&process.argv.includes('--crash-recorder-smoke');
const diagnostic=smoke&&!crashProbe?()=>{}:require('./diagnostics.cjs').installProcessDiagnostics({app,process,crashReporter:require('electron').crashReporter});
const states = new Map();
const privacySupported=()=>process.platform==='win32'&&Number(require('node:os').release().split('.')[2])>=19041;
function publishPrivacy(s){if(!s.win.isDestroyed())s.win.webContents.send('privacy-screen-state',{active:displayPrivacy.status(s).active,allowed:s.privacyPermitted===true&&settings().allowPrivacyScreen===true});}
let displayPrivacy;
let hostInputHelper;
const inputControl=new (require('./input-control.cjs').InputControl)({
  release:s=>{if(s.helper?.stdin.writable)s.helper.stdin.write('{"type":"release"}\n{"type":"layout-stop"}\n');},
  changed:()=>publishInputControl()
});
let configuredController;
function publishInputControl(){
  const owner=inputControl.owner;
  if(owner&&owner!==configuredController&&owner.helper?.stdin.writable&&owner.inputBounds){owner.helper.stdin.write(JSON.stringify({type:'bounds',...owner.inputBounds,sharedCursor:owner.sharedCursor!==false})+'\n');syncCursorExclusions(owner);}
  configuredController=owner;
  for(const s of states.values())if(s.control&&s.hostInput&&!s.win.isDestroyed()){
    const reason=inputControl.reason(s);if(s.inputReason!==reason){s.inputReason=reason;s.win.webContents.send('input-state',{type:'input-state',reason});}
  }
}
setInterval(()=>{inputControl.tick();publishInputControl();},150).unref();
let localServer, tray, quitting = false;
let settingsCache;
const profile = () => ({ ...require('../shared/profile.cjs').profile(settings().profile),appVersion:app.getVersion(), name: settings().profile?.name || require('node:os').hostname() });
const sessionPreviews=new (require('./session-preview.cjs').SessionPreviews)({file:path.join(app.getPath('userData'),'session-previews.json'),encrypt:text=>safeStorage.encryptString(text),decrypt:bytes=>safeStorage.decryptString(bytes)});
const update = new (require('./updater.cjs').Updater)({ version: app.getVersion(), directory: path.join(app.getPath('userData'), 'updates'), portable: !!process.env.PORTABLE_EXECUTABLE_FILE, request: require('./updater.cjs').electronResponse,
  changed: value => { for (const s of states.values()) { if (!s.win.isDestroyed()) s.win.webContents.send('update-status', value); } } });
function settings() {
  if(settingsCache)return settingsCache;
  try { return settingsCache=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'connection.json'), 'utf8')); }
  catch {
    if (!smoke) try { return settingsCache=JSON.parse(fs.readFileSync(path.join(app.getPath('appData'), 'farwatch', 'connection.json'), 'utf8')); } catch {}
    return settingsCache={};
  }
}
function saveSettings(patch) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const file = path.join(app.getPath('userData'), 'connection.json');
  const next={...settings(),...patch};fs.writeFileSync(file+'.tmp',JSON.stringify(next));fs.renameSync(file+'.tmp',file);settingsCache=next;
}
function validateEndpoint(endpoint) {
  const u = new URL(endpoint);
  if (!['ws:', 'wss:'].includes(u.protocol) || u.username || u.password) throw new Error('Enter a valid WebSocket server address.');
  if (u.protocol === 'ws:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) &&
      !network.localAddress(u.hostname)) throw new Error('Public internet servers require wss:// and a valid TLS certificate.');
  return u.href;
}
function validateDirect(address) {
  if (typeof address !== 'string' || !/^[\d.]+(?::\d{1,5})?$/.test(address)) throw new Error('Enter a LAN IPv4 address, optionally followed by :8788.');
  return validateEndpoint(`ws://${address.includes(':') ? address : address + ':8788'}`);
}
const preferences = new (require('./preferences.cjs').ClientPreferences)({ read: settings, write: saveSettings, validateEndpoint, validateDirect,
  encrypt: text => { if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable.'); return safeStorage.encryptString(text).toString('base64'); },
  decrypt: text => safeStorage.decryptString(Buffer.from(text, 'base64')) });
function computerChanged(){for(const s of states.values())for(const win of [s.win,s.chatWindow])if(win&&!win.isDestroyed())win.webContents.send('computer-cards-changed');}
function rememberComputer(peer,route,preview=false){return preferences.rememberComputer({...peer,preview:preview?peer.preview:undefined},route);}
function decorateDiscovery(value){return {...value,peers:value.peers.map(peer=>preferences.decorate(peer))};}
const wallpaperPreview=require('./wallpaper.cjs').wallpaperReader({nativeImage:require('electron').nativeImage,executable:nativeExecutable});
ipcMain.handle('desktop-card-preview',async e=>{
  state(e);
  return wallpaperPreview();
});
ipcMain.handle('computer-card',(e,operation,value={})=>{
  state(e);
  if(operation==='resolve')return preferences.decorate(value.peer,value.route);
  if(operation==='remember'){rememberComputer(value.peer||{},value.route||{});computerChanged();return preferences.decorate(value.peer,value.route);}
  if(operation==='rename'){const result=preferences.renameComputer(value.peer,value.name);computerChanged();return result;}
  if(operation==='pin'){const result=preferences.pinComputer(value.peer,value.pinned);computerChanged();return result;}
  if(operation==='reorder-pins'){preferences.reorderComputers(value.order);computerChanged();return;}
  throw new Error('Invalid computer card operation.');
});
ipcMain.on('desktop-viewing',(e,value)=>{const s=state(e,false);if(s)s.outgoingDesktop=value===true;});
let launchFavorite = process.argv.find(value => /^--connect-saved=[a-f0-9-]{36}$/.test(value))?.split('=')[1];
let stableLauncher;
function getLauncher(){
  if(!stableLauncher){stableLauncher=new(require('./launcher.cjs').Launcher)({directory:path.join(app.getPath('userData'),'launcher'),icon:path.join(process.resourcesPath,'app-icon.ico'),powershell:path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe')});stableLauncher.register(process.env.PORTABLE_EXECUTABLE_FILE||app.getPath('exe'),app.getVersion());}
  return stableLauncher;
}
function createFavoriteShortcut(id) {
  const record = preferences.get(id);
  const executable = process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
  const target = path.join(app.getPath('desktop'), preferences.shortcutName(id));
  const args = `${app.isPackaged ? '' : `"${path.resolve(__dirname, '..')}" `}--connect-saved=${id}`;
  const link=app.isPackaged?getLauncher().link({favorite:id}):{target:executable,cwd:path.dirname(executable),args,icon:executable,iconIndex:0};
  if (!shell.writeShortcutLink(target, fs.existsSync(target) ? 'update' : 'create', { ...link,description: `Shatoot Connect: ${record.name}` })) throw new Error('Desktop shortcut could not be created.');
  preferences.markShortcut(id); return target;
}
function identity() {
  const saved = settings();
  if (saved.deviceId && saved.deviceSecret && safeStorage.isEncryptionAvailable()) {
    try { return { deviceId: saved.deviceId, deviceSecret: safeStorage.decryptString(Buffer.from(saved.deviceSecret, 'base64')) }; } catch {}
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable.');
  const result = { deviceId: crypto.randomUUID(), deviceSecret: crypto.randomBytes(32).toString('base64url') };
  saveSettings({ deviceId: result.deviceId, deviceSecret: safeStorage.encryptString(result.deviceSecret).toString('base64') });
  return result;
}
if(!smoke){const locked=app.requestSingleInstanceLock();if(!locked||process.argv.includes('--quit-if-background')||process.argv.includes('--quit-for-update'))app.quit();}

function release(s) {
  displayPrivacy.release(s);s.privacyPermitted=false;
  inputControl.drop(s);
  hideGuestCursor(s);
  s.control = false;
  s.exchangeAllowed = false; s.grab?.stdin.end(); s.grab = null;
  s.transfers?.reset().catch(() => {}); s.clipboardProc?.stdin.end(); s.clipboardProc = null;
  if (!s.hostInput&&s.helper?.stdin.writable) s.helper.stdin.write('{"type":"release"}\n{"type":"layout-stop"}\n');
  if(s.hostInput){s.helper=null;s.hostInput=false;if(![...states.values()].some(other=>other!==s&&other.hostInput&&other.control)){hostInputHelper?.stdin.end();hostInputHelper=null;inputControl.host(false);}}
}
function syncCursorExclusions(s) {
  if (!s.helper?.stdin.writable) return;
  const handles = [...[...states.values()].flatMap(other=>[other.overlay,other.guestCursor,...(settings().showChatInRemote?[]:[other.chatWindow])]),...[...notices.entries.values()].map(record=>record.win)].filter(win=>win && !win.isDestroyed()).map(win=>{const h=win.getNativeWindowHandle();return (h.length===8?h.readBigUInt64LE():BigInt(h.readUInt32LE())).toString(16);});
  s.helper.stdin.write(JSON.stringify({type:'exclude-windows',handles})+'\n');
}
function hideGuestCursor(s) {
  clearTimeout(s.guestCursorTimer); s.guestPointerData=null;
  const win=s.guestCursor; s.guestCursor=null; s.guestCursorReady=false;
  if(win && !win.isDestroyed())win.destroy(); syncCursorExclusions(s);
}
ipcMain.on('guest-cursor',(e,data)=>{
  const s=state(e,false);if(!s)return;
  if(!s.captureAllowed || !s.source || s.showGuestCursor===false || !data || typeof data.visible!=='boolean')return;
  // Shared input already moves the Windows pointer; a second overlay duplicates it.
  if(s.sharedCursor!==false){if(s.guestCursor)hideGuestCursor(s);return;}
  if(!data.visible){s.guestPointerData=null;s.guestCursor?.hide();return;}
  if(!Number.isFinite(data.x)||!Number.isFinite(data.y)||data.x<0||data.x>1||data.y<0||data.y>1)return;
  const display=screen.getAllDisplays().find(d=>String(d.id)===s.source.display_id)||screen.getPrimaryDisplay();
  s.guestPointerData={x:data.x,y:data.y,visible:true,name:s.viewerName||'Guest'};
  if(!s.guestCursor || s.guestCursor.isDestroyed()){
    const win=new BrowserWindow({...display.bounds,frame:false,transparent:true,backgroundColor:'#00000000',alwaysOnTop:true,focusable:false,skipTaskbar:true,show:false,resizable:false,movable:false,fullscreenable:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
    s.guestCursor=win; s.guestCursorReady=false; win.on('closed',()=>{if(s.guestCursor===win){s.guestCursor=null;s.guestCursorReady=false;syncCursorExclusions(s);}}); win.setIgnoreMouseEvents(true,{forward:true}); if(Number(require('node:os').release().split('.')[2])>=19041)win.setContentProtection(true);
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
    syncCursorExclusions(s);
    win.once('ready-to-show',()=>{if(s.guestCursor===win && s.captureAllowed && s.guestPointerData){s.guestCursorReady=true;win.webContents.send('guest-cursor',s.guestPointerData);win.showInactive();win.setAlwaysOnTop(true,'screen-saver');}});
    win.loadFile(path.join(__dirname,'ui/guest-cursor.html'));
  } else if(s.guestCursorReady){s.guestCursor.webContents.send('guest-cursor',s.guestPointerData);if(!s.guestCursor.isVisible()){s.guestCursor.showInactive();s.guestCursor.setAlwaysOnTop(true,'screen-saver');}}
  clearTimeout(s.guestCursorTimer);s.guestCursorTimer=setTimeout(()=>{s.guestCursor?.hide();s.guestPointerData=null;},3500);
});
function hideHostOverlay(s) {
  const overlay = s.overlay;
  s.overlay = null;
  syncCursorExclusions(s);
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
}
function disconnectHost(s) {
  release(s); s.captureAllowed = false; s.source = null; hideHostOverlay(s);
  if (!s.win.isDestroyed()) s.win.webContents.send('host-disconnect');
}
function showHostOverlay(s) {
  if (!s.captureAllowed || s.win.isDestroyed() || s.overlayHidden) return;
  hideHostOverlay(s);
  const display = screen.getAllDisplays().find(d => String(d.id) === s.source?.display_id) || screen.getPrimaryDisplay();
  const area = display.workArea;
  const ordinal = [...states.values()].filter(other => other !== s && other.overlay && !other.overlay.isDestroyed()).length;
  const overlay = new BrowserWindow({ width: 320, height: 76, x: area.x + area.width - 332, y: area.y + area.height - 88 - ordinal * 84,
    frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  s.overlay = overlay;
  notices.reserve(overlay);
  syncCursorExclusions(s);
  overlay.on('closed', () => { if (s.overlay === overlay && s.captureAllowed) disconnectHost(s); });
  overlay.setContentProtection(true);
  overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlay.webContents.on('will-navigate', event => event.preventDefault());
  overlay.once('ready-to-show', () => { if (s.captureAllowed && !overlay.isDestroyed()) { overlay.showInactive(); overlay.setAlwaysOnTop(true, 'screen-saver'); } });
  overlay.loadFile(path.join(__dirname, 'ui/host-overlay.html'));
}
function helper(s,hosting=false) {
  if(hosting&&hostInputHelper&&!hostInputHelper.killed){s.hostInput=true;s.helper=hostInputHelper;return s.helper;}
  if(hosting&&s.helper){s.helper.stdin.end();s.helper=null;}
  if (s.helper && !s.helper.killed) return s.helper;
  const exe = app.isPackaged ? path.join(process.resourcesPath, 'input', 'ShatootConnect.Input.exe') : path.join(__dirname, '../native/publish/ShatootConnect.Input.exe');
  if (!fs.existsSync(exe)) throw new Error('ابتدا npm run build:native را اجرا کنید.');
  s.helper = spawn(exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const proc=s.helper;if(hosting){s.hostInput=true;hostInputHelper=proc;}
  let output = '';
  proc.stdout.on('data', chunk => { output += chunk; if (output.length > 16000) output = ''; let end; while ((end = output.indexOf('\n')) >= 0) { const line = output.slice(0, end); output = output.slice(end + 1); try { const data = JSON.parse(line);if(hosting&&data.type==='host-activity'){if(hostInputHelper===proc)inputControl.host(data.active===true);continue;}const target=hosting?inputControl.owner:s;if (data.type === 'layout-status' && target&&!target.win.isDestroyed()) target.win.webContents.send('keyboard-applied', data); } catch {} } });
  const failed=()=>{for(const target of states.values())if(target.helper===proc){target.helper=null;inputControl.drop(target);target.control=false;if(!target.win.isDestroyed()){target.win.webContents.send('input-state',{type:'input-state',reason:'unavailable'});target.win.webContents.send('input-error');}}if(hostInputHelper===proc){hostInputHelper=null;inputControl.host(false);}};
  proc.stdin.on('error',failed);proc.on('error',failed);proc.on('exit',failed);
  proc.stderr.on('data', () => { const target=hosting?inputControl.owner:s;if(target&&!target.win.isDestroyed())target.win.webContents.send('input-error'); });
  return s.helper;
}
function state(event,required=true) {
  const s = !event.sender.isDestroyed()&&(states.get(event.sender.id) || [...states.values()].find(s => s.chatWindow&&!s.chatWindow.isDestroyed()&&s.chatWindow.webContents === event.sender));
  if (!s || event.senderFrame !== event.sender.mainFrame) {if(required)throw new Error('Unauthorized IPC');return null;}
  return s;
}
const notices=require('./notifications.cjs').createNotifications({BrowserWindow,ipcMain,screen,language:()=>settings().language==='fa'?'fa':'en',windowsChanged:()=>{for(const s of states.values())syncCursorExclusions(s);},activity:()=>!app.isReady()||smoke||powerMonitor.getSystemIdleTime()<30});
function chatFilesReceived(s,record,files){
  let reading=false;
  for(const win of [s.win,s.chatWindow])if(win&&!win.isDestroyed()){
    const view=s.chatViews?.get(win.webContents.id);
    if(win.isVisible()&&!win.isMinimized()&&win.isFocused()&&view?.active&&view.conversation===record.conversation){reading=true;}
    win.webContents.send('chat-files-received',{conversation:record.conversation,id:record.id});
  }
  publishUnread(s);
  if(!reading&&!s.chatStore?.isMuted(record.conversation)){record={...record,name:preferences.decorate({deviceId:record.sender,name:record.name}).displayName};const fa=s.language==='fa',voice=files?.length===1&&/^Voice-[a-f0-9-]{36}\.webm$/i.test(record.text);notices.toast(s.win,voice?(fa?`پیام صوتی از ${record.name}`:`Voice message from ${record.name}`):files?(fa?`فایل‌ها از ${record.name} دریافت شدند.`:`Files received from ${record.name}.`):record.name,{kind:'message',detail:voice?'':files?files.map(file=>path.basename(file)).slice(0,8).join('\n')+'\nDownloads':record.text.slice(0,500),onActivate:()=>openChat(s,{conversation:record.conversation,message:record.id})});}
}
const systemInfo=require('./system-info.cjs').createSystemInfo({app,screen});
const collaborationHost = require('./collaboration-host.cjs').installCollaboration({systemInfo, ipcMain, state, app, safeStorage, dialog: {showOpenDialog:(...args)=>dialog.showOpenDialog(...args),showMessageBox:(owner,options)=>notices.showMessageBox(owner,options),cancelFor:(owner,priority)=>notices.cancelFor(owner,priority)}, shell, smoke, settings, clipboardRead:s=>nativeClipboard(s,{op:'read'}), decorateComputer:(peer,route)=>preferences.decorate(peer,route), rememberComputer:(peer,route,preview)=>{rememberComputer(peer,route,preview);computerChanged();}, previewImage:file=>readProfilePhoto(file,true),catalogChanged:publishUnread,received:chatFilesReceived, messageReceived:(s,record)=>chatFilesReceived(s,record) });
ipcMain.handle('voice-recording',(event,enabled)=>{
  const s=state(event);if(s.owner||typeof enabled!=='boolean')throw new Error('Invalid microphone request.');
  s.voicePermissions||=new Map();if(enabled)s.voicePermissions.set(event.sender.id,Date.now()+15000);else s.voicePermissions.delete(event.sender.id);
});
function unreadIcon(total){
  const pixels=Buffer.alloc(32*32*4),digits=['111101101101111','010110010010111','111001111100111','111001111001111','101101111001001','111100111001111','111100111101111','111001001001001','111101111101111','111101111001111'],label=String(Math.min(99,total));
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)if((x-15.5)**2+(y-15.5)**2<=250){const i=(y*32+x)*4;pixels[i]=69;pixels[i+1]=47;pixels[i+2]=211;pixels[i+3]=255;}
  const scale=3,left=Math.floor((32-(label.length*4-1)*scale)/2);for(let n=0;n<label.length;n++)for(let y=0;y<5;y++)for(let x=0;x<3;x++)if(digits[Number(label[n])][y*3+x]==='1')for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){const i=((8+y*scale+dy)*32+left+(n*4+x)*scale+dx)*4;pixels.fill(255,i,i+4);}
  return require('electron').nativeImage.createFromBitmap(pixels,{width:32,height:32});
}
function publishUnread(s){const unread=s.chatStore?.unread()||{},total=Object.values(unread).reduce((a,b)=>a+b,0);for(const win of [s.win,s.chatWindow])if(win&&!win.isDestroyed()){win.webContents.send('chat-unread',{unread,total});if(process.platform==='win32')win.setOverlayIcon(total?unreadIcon(total):null,total?`${total} unread messages`:'');}}
ipcMain.handle('chat-view',(e,value)=>{const s=state(e);if(!value||typeof value.active!=='boolean'||typeof value.conversation!=='string'||(value.conversation&&!/^[pg]:[a-f0-9-]{36}$/i.test(value.conversation)))throw new Error('Invalid chat view.');s.chatViews||=new Map();if(value.atBottom!==undefined&&typeof value.atBottom!=='boolean'||value.readThrough!==undefined&&(!Number.isSafeInteger(value.readThrough)||value.readThrough<0))throw new Error('Invalid chat position.');s.chatViews.set(e.sender.id,{conversation:value.conversation,active:value.active,atBottom:value.atBottom});const viewWindow=BrowserWindow.fromWebContents(e.sender);if(value.active&&value.readThrough>0&&s.chatStore&&viewWindow?.isFocused()&&viewWindow.isVisible()&&!viewWindow.isMinimized()){s.chatStore.conversationState(value.conversation,{read:true,readThrough:value.readThrough});s.chatStore.seenMessages(value.conversation,value.seen||[]);if(!s.win.isDestroyed())s.win.webContents.send('chat-receipts');}publishUnread(s);});
ipcMain.handle('notify',(e,message)=>{const s=state(e);if(typeof message!=='string'||message.length>1000)throw new Error('Invalid notification.');if(smoke)return;notices.toast(s.win,message,{onActivate:()=>showMain(s)});});
function configureStartup(enabled){
  if(!smoke && app.isPackaged)app.setLoginItemSettings({name:'Shatoot Connect',openAtLogin:enabled,path:process.env.PORTABLE_EXECUTABLE_FILE||app.getPath('exe'),args:['--start-in-tray']});
  saveSettings({startupEnabled:enabled});return enabled;
}
function refreshTray(s){s=s?.viewerOwner||s;if(!tray||!s)return;const fa=s.language==='fa';tray.setContextMenu(Menu.buildFromTemplate([{label:'Shatoot Connect',click:()=>showMain(s)},{label:fa?'چت و فایل‌ها':'Chats and files',click:()=>openChat(s)},{label:fa?'نمایش پنل اتصال‌ها':'Show connection panels',click:()=>{for(const state of states.values())if(state.captureAllowed){state.overlayHidden=false;showHostOverlay(state);}}},{type:'separator'},{label:fa?'خروج کامل':'Quit completely',click:()=>{quitting=true;app.quit();}}]));}
ipcMain.handle('lifecycle',(e,operation,value)=>{const s=state(e);if(operation==='startup'){if(typeof value!=='boolean')throw new Error('Invalid startup setting.');return configureStartup(value);}if(operation==='quit'){quitting=true;setTimeout(()=>app.quit(),50);return;}if(operation==='panels'){for(const state of states.values())if(state.captureAllowed){state.overlayHidden=false;showHostOverlay(state);}return;}throw new Error('Invalid application setting.');});
ipcMain.handle('remote-window-closed',e=>{const s=state(e);if(e.sender!==s.win.webContents)throw new Error('Invalid remote window.');s.outgoingDesktop=false;if(s.viewerOwner)s.win.destroy();else s.win.hide();});
ipcMain.handle('fit-video',(e,size)=>{
  const s=state(e);if(s.owner)return;
  if(!size){if(s.videoSizing&&!s.win.isMaximized()&&!s.win.isFullScreen())saveSettings({remoteWindowSize:{width:s.win.getContentBounds().width,height:s.win.getContentBounds().height}});s.videoSizing=null;s.win.setAspectRatio(0);if(s.normalBounds){s.win.setMinimumSize(Math.min(1000,s.normalBounds.width),Math.min(720,s.normalBounds.height));s.win.setBounds(s.normalBounds);s.normalBounds=null;if(s.normalMaximized)s.win.maximize();s.normalMaximized=false;}return;}
  if(!Number.isFinite(size.width)||!Number.isFinite(size.height)||size.width<1||size.height<1||size.width>32768||size.height>32768)return;
  if(s.videoSizing?.sourceWidth!==size.width||s.videoSizing?.sourceHeight!==size.height)diagnostic('viewer-video',{width:size.width,height:size.height});
  const work=screen.getDisplayMatching(s.win.getBounds()).workArea,ratio=size.width/size.height;
  if(!s.normalBounds){s.normalMaximized=s.win.isMaximized();s.normalBounds=s.win.getNormalBounds();if(s.normalMaximized)s.win.unmaximize();}
  const frameHeight=s.win.getBounds().height-s.win.getContentBounds().height,frameWidth=s.win.getBounds().width-s.win.getContentBounds().width;
  const extraHeight=Number.isFinite(size.extraHeight)?Math.max(0,Math.min(250,size.extraHeight)):82,extraWidth=Number.isFinite(size.extraWidth)?Math.max(0,Math.min(80,size.extraWidth)):16;
  const previous=settings().remoteWindowSize;let width=Math.min(size.width+extraWidth,previous?.width||Infinity,work.width-frameWidth-24),height=Math.round((width-extraWidth)/ratio+extraHeight);
  const maxHeight=Math.min(work.height-frameHeight-24,previous?.height||Infinity,size.height+extraHeight);if(height>maxHeight){height=maxHeight;width=Math.round((height-extraHeight)*ratio+extraWidth);}
  s.videoSizing={ratio,extraHeight,extraWidth,sourceWidth:size.width,sourceHeight:size.height};s.win.setMinimumSize(Math.max(1,Math.round(Math.min(640,width))),Math.max(1,Math.round(Math.min(360,height))));if(!s.win.isFullScreen()&&!s.win.isMaximized()){s.win.setContentSize(Math.max(1,Math.round(width)),Math.max(1,Math.round(height)));const bounds=s.win.getBounds();s.win.setPosition(Math.round(Math.max(work.x+12,Math.min(bounds.x,work.x+work.width-bounds.width-12))),Math.round(Math.max(work.y+12,Math.min(bounds.y,work.y+work.height-bounds.height-12))));}
});
function hostReply(s, message) {
  if (!s.owner || s.owner.win.isDestroyed()) return;
  const data = { ...message, session: s.invitation.session };
  if (s.hostRoute === 'lan-host') { if (s.owner.directSocket?.readyState === 1) s.owner.directSocket.send(JSON.stringify(data)); }
  else s.owner.win.webContents.send('host-signal-out', data);
}
function closeExtraHost(s) { if (!s.owner || s.win.isDestroyed()) return; hostReply(s, { type: 'desktop-end' }); s.win.destroy(); }
ipcMain.handle('host-session', async (e, message, route, sourceId) => {
  const owner = state(e); if (owner.owner || !require('./discovery.cjs').UUID.test(message?.session) || !['server','lan-host'].includes(route)) throw new Error('Invalid desktop session.');
  let s = [...states.values()].find(s => s.owner === owner && s.invitation.session === message.session && s.hostRoute === route);
  if (message.type === 'desktop-invite') {
    message={...message,name:preferences.decorate({...message.peer,name:message.name}).displayName};
    if (s) return;
    if ([...states.values()].filter(s => s.owner === owner).length >= 7) { hostReply({ owner, hostRoute: route, invitation: message },{type:'desktop-reject'}); return; }
    const win = new BrowserWindow({ show: false, width: 320, height: 180, skipTaskbar: true, webPreferences: { preload: path.join(__dirname,'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
    s = { win, owner, invitation: message, sourceId, hostRoute: route, language: owner.language, sharedCursor: owner.sharedCursor, showGuestCursor: owner.showGuestCursor, identity: owner.identity, captureAllowed: false, control: false };
    const workerContentsId = win.webContents.id; states.set(workerContentsId,s); win.webContents.setWebRTCIPHandlingPolicy('default'); win.webContents.setWindowOpenHandler(() => ({action:'deny'})); win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('closed', () => { hostReply(s,{type:'desktop-end'}); hideHostOverlay(s); release(s); s.keyboardMonitor?.stdin.end(); s.helper?.stdin.end(); states.delete(workerContentsId); });
    win.loadFile(path.join(__dirname,'ui/extra-host.html')); return;
  }
  if (!s) return;
  if (message.type === 'desktop-ended') { closeExtraHost(s); return; }
  if (['desktop-ready','desktop-signal'].includes(message.type)) s.win.webContents.send('host-signal', message);
});
ipcMain.handle('host-init', e => { const s = state(e); if (!s.owner) throw new Error('Invalid desktop worker.'); return { invitation: s.invitation, source: s.sourceId, lan: s.hostRoute === 'lan-host', profiles: PROFILES, showHostCursor:settings().showHostCursor!==false, autoQuality:settings().autoQuality!==false, profile: settings().qualityProfile || 'speed' }; });
ipcMain.on('host-send', (e, message) => { const s = state(e,false); if (!s?.owner || !message || !['desktop-accept','desktop-reject','desktop-signal','desktop-end'].includes(message.type) || JSON.stringify(message).length > 110000) return; if (['desktop-accept','desktop-signal'].includes(message.type) && !s.captureAllowed) return; hostReply(s,message); if (['desktop-reject','desktop-end'].includes(message.type)) closeExtraHost(s); });
ipcMain.handle('host-sessions-stop', e => { const owner = state(e); for (const s of states.values()) if (s.owner === owner) closeExtraHost(s); });
const chatPending = new Map();
ipcMain.handle('app-ready',e=>{
  const s=state(e);if(s.viewerOwner){s.win.show();s.win.focus();return;}if(!smoke&&!s.owner&&!s.chatLaunchHandled&&process.argv.includes('--open-chat')){s.chatLaunchHandled=true;openChat(s);}if(smoke||!app.isPackaged||s.owner||s.readyAnnounced)return;s.readyAnnounced=true;
  const launcher=getLauncher();launcher.repair(app.getPath('desktop'),shell);
  try{const resultFile=path.join(update.directory,'last-update.json'),result=JSON.parse(fs.readFileSync(resultFile,'utf8'));if(result.state==='error'&&!result.reported){update.emit({state:'error',version:result.version,error:result.error});notices.toast(s.win,result.error,{onActivate:()=>openUpdateSettings(s)});fs.writeFileSync(resultFile,JSON.stringify({...result,reported:true}));}}catch{}
  for(const record of preferences.list())if(record.shortcut&&fs.existsSync(path.join(app.getPath('desktop'),preferences.shortcutName(record.id))))createFavoriteShortcut(record.id);
  const token=process.argv.find(arg=>/^--update-token=[a-f0-9-]{36}$/.test(arg))?.split('=')[1];
  if(token){fs.mkdirSync(update.directory,{recursive:true});const file=path.join(update.directory,token+'.ready.json');fs.writeFileSync(file+'.tmp',JSON.stringify({token,version:app.getVersion(),executable:process.env.PORTABLE_EXECUTABLE_FILE||app.getPath('exe'),pid:process.pid}));fs.renameSync(file+'.tmp',file);}
  else{fs.mkdirSync(update.directory,{recursive:true});const worker=path.join(update.directory,'update-worker.ps1');fs.copyFileSync(path.join(__dirname,'update-worker.ps1'),worker);const child=spawn(launcher.powershell,['-NoProfile','-ExecutionPolicy','Bypass','-File',worker,'-CleanupOnly','-Target',process.env.PORTABLE_EXECUTABLE_FILE||app.getPath('exe'),'-Version',app.getVersion(),'-CacheDirectory',update.directory],{windowsHide:true,detached:false,stdio:'ignore'});child.on('error',()=>{});child.unref();}
});
function showMain(s) { if (s.win.isDestroyed()) return; s.win.show(); if (s.win.isMinimized()) s.win.restore(); s.win.focus(); }
function chatWindowTitle(s){return s.language==='fa'?'گفتگوها · Shatoot Connect':'Chats · Shatoot Connect';}
function openChat(s,target) {
  if(target){s.chatTarget=target;s.win.webContents.send('chat-target',target);}
  if (s.chatWindow && !s.chatWindow.isDestroyed()) { s.chatWindow.show();if(s.chatWindow.isMinimized())s.chatWindow.restore();s.chatWindow.focus();if(target)s.chatWindow.webContents.send('chat-target',target);return; }
  const win = new BrowserWindow({ width: 1000, height: 720, minWidth: 720, minHeight: 540, backgroundColor:settings().theme==='light'?'#faf6ff':'#160d20', title:chatWindowTitle(s), icon:path.join(__dirname,'ui/assets/chat-icon.png'), autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.on('page-title-updated',event=>event.preventDefault());
  s.chatWindow = win; win.setContentProtection(settings().showChatInRemote!==true);
  require('./chat-window.cjs').configureChatWindow({win,Menu,icon:app.isPackaged?path.join(process.resourcesPath,'chat-icon.ico'):path.join(__dirname,'../build/chat-icon.ico'),executable:process.env.PORTABLE_EXECUTABLE_FILE||process.execPath,appPath:app.getAppPath(),packaged:app.isPackaged});
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', event => event.preventDefault());
  for(const host of states.values())syncCursorExclusions(host);
  const chatContentsId=win.webContents.id;win.on('closed', () => { s.chatViews?.delete(chatContentsId);s.voicePermissions?.delete(chatContentsId);s.chatWindow = null;for(const host of states.values())syncCursorExclusions(host); });
  win.loadFile(path.join(__dirname, 'ui/index.html'), { query: { chat: '1' } });
}
ipcMain.handle('chat-target',e=>{const s=state(e);if(s.chatWindow?.webContents!==e.sender)throw new Error('Invalid chat target request.');const target=s.chatTarget;s.chatTarget=null;return target;});
function openUpdateSettings(s){showMain(s);s.win.webContents.send('settings-open','updates');}
ipcMain.handle('chat-open', (e,deviceId) => {const s=state(e),owner=s.viewerOwner||s;if(deviceId!==undefined){if(!require('./discovery.cjs').UUID.test(deviceId)||!owner.chatStore?.load().contacts[deviceId])throw Error('Invalid computer.');return openChat(owner,{conversation:'p:'+deviceId});}return openChat(owner);});
ipcMain.handle('remote-open',(e,value)=>{
  const caller=state(e),owner=caller.viewerOwner||caller;
  if(!value||typeof value!=='object'||typeof value.address!=='string'||value.address.length>300||typeof value.password!=='string'||value.password.length>128||value.serverKey!==undefined&&(typeof value.serverKey!=='string'||value.serverKey.length>500))throw Error('Invalid remote destination.');
  const known=preferences.decorate(value),target={...preferences.destination(value),password:value.password,serverKey:value.serverKey||'',deviceId:known.deviceId||'',preview:known.preview||''};delete target.key;
  if([...states.values()].filter(s=>s.viewerOwner===owner).length>=8)throw Error('Close a remote window before opening another.');
  createWindow({viewerOwner:owner,target});return true;
});
ipcMain.handle('remote-preview',(e,value)=>{const s=state(e);if(!s.viewerOwner||!s.outgoingDesktop||!s.remoteTarget||!value||typeof value.image!=='string')throw Error('No active remote session.');if(value.image.length>200000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value.image))throw Error('Invalid session preview.');const image=require('electron').nativeImage.createFromDataURL(value.image),size=image.getSize();if(image.isEmpty()||size.width>640||size.height>400)throw Error('Invalid session preview.');return sessionPreviews.put(preferences.destination(s.remoteTarget),{image:value.image,deviceId:require('./discovery.cjs').UUID.test(value.deviceId||'')?value.deviceId:s.remoteTarget.deviceId||''});});
ipcMain.handle('profile-edit',e=>{const s=state(e);showMain(s);s.win.webContents.send('profile-edit');});
ipcMain.handle('show-main', e => {const s=state(e);showMain(s.viewerOwner||s);});
ipcMain.handle('chat-connect-computer',(e,deviceId)=>{
  const s=state(e);if(!require('./discovery.cjs').UUID.test(deviceId))throw new Error('Invalid computer.');
  const contact=s.chatStore?.load().contacts[deviceId],peer=contact&&preferences.decorate(contact,contact.route||{});if(!peer?.route)throw new Error('This computer has no saved connection address.');
  const target=preferences.destination({address:peer.route.address,endpoint:peer.route.endpoint});
  const saved=preferences.list().find(record=>record.deviceId===deviceId||record.address===target.address&&record.endpoint===target.endpoint);
  showMain(s);if(saved)s.win.webContents.send('connect-favorite',saved.id);else s.win.webContents.send('connect-computer',{address:target.address,endpoint:target.endpoint,password:preferences.recall(target)});
});
ipcMain.handle('chat-close', e => state(e).chatWindow?.close());
ipcMain.handle('chat-call', (e, operation, args = []) => {
  const s = state(e);
  if (s.chatWindow?.webContents !== e.sender || !['snapshot','refresh','connect','computerInfo','cancelPending','send','forwardMessage','sendFiles','close','createGroup','changeMessage','schedule','cancelScheduled','react'].includes(operation) || !Array.isArray(args) || chatPending.size >= 32) throw new Error('Invalid chat window request.');
  const id = crypto.randomUUID();
  return new Promise((resolve,reject) => { const timer = setTimeout(() => { chatPending.delete(id); reject(new Error('Chat operation timed out.')); }, ['sendFiles','forwardMessage'].includes(operation) ? 1800000 : 75000); chatPending.set(id, { s, resolve, reject, timer }); s.win.webContents.send('chat-command', { id, operation, args }); });
});
ipcMain.on('chat-result', (e, data) => { const pending = chatPending.get(data?.id); if (!pending || pending.s.win.webContents !== e.sender || e.senderFrame !== e.sender.mainFrame) return; clearTimeout(pending.timer); chatPending.delete(data.id); data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.value); });
ipcMain.on('chat-publish', (e, value) => { const s = state(e,false); if (!s||s.win.webContents !== e.sender) return; if(s.chatStore)value={...value,catalog:{...value.catalog,unread:s.chatStore.unread(),muted:{...s.chatStore.load().muted},pins:{...s.chatStore.load().pins},pinOrder:[...(s.chatStore.load().pinOrder||[])],lastSelected:s.chatStore.load().lastSelected||''}};if (s.chatWindow && !s.chatWindow.isDestroyed()) s.chatWindow.webContents.send('chat-snapshot', value); });
let installingUpdate=false;
ipcMain.handle('update', async (e, operation) => {
  state(e);
  if (operation === 'status') return update.status;
  if (operation === 'check') return update.check();
  if (operation !== 'install' || !app.isPackaged) throw new Error('Updates can only be installed in a packaged application.');
  if(installingUpdate)throw new Error('An update is already in progress.');installingUpdate=true;
  try{
  await update.prepare();
  const token=crypto.randomUUID(),worker=path.join(update.directory,token+'.worker.ps1');
  fs.writeFileSync(worker, fs.readFileSync(path.join(__dirname, 'update-worker.ps1')));
  const executable = process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
  if (process.env.PORTABLE_EXECUTABLE_FILE) fs.accessSync(path.dirname(executable), fs.constants.W_OK);
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  await require('./update-launch.cjs').startUpdateWorker({powershell,worker,directory:update.directory,parameters:{ParentId:process.pid,Package:update.file,Target:executable,Digest:update.asset.digest,Version:update.asset.version,ReadyToken:token,CacheDirectory:update.directory,Portable:!!process.env.PORTABLE_EXECUTABLE_FILE}});
  update.emit({state:'installing'});quitting = true; setTimeout(() => app.quit(), 300); return { state: 'installing' };
  }catch(error){update.emit({state:'error',error:error.message});throw error;}finally{installingUpdate=false;}
});
let firewallCheck,firewallCheckedAt=0;
ipcMain.handle('firewall-status',async(e,force=false)=>{const s=state(e);if(smoke)return s.firewallStatus||{needsRepair:false};if(!firewallCheck||force===true||Date.now()-firewallCheckedAt>30000){firewallCheckedAt=Date.now();firewallCheck=require('./firewall.cjs').firewallStatus(app.getPath('exe'));}return firewallCheck;});
ipcMain.handle('firewall-repair',async e=>{const s=state(e);if(smoke){s.firewallStatus={needsRepair:false};return true;}try{return await require('./firewall.cjs').repairFirewall(app.getPath('exe'));}finally{firewallCheck=null;}});
ipcMain.handle('chat-preferences', (e, value) => { state(e); if (!value || typeof value.autoAcceptFiles !== 'boolean' || typeof value.requireChatApproval !== 'boolean') throw new Error('Invalid chat settings.'); saveSettings({ autoAcceptFiles: value.autoAcceptFiles, requireChatApproval: value.requireChatApproval }); return value; });
ipcMain.handle('chat-remote-visible',(e,value)=>{state(e);if(typeof value!=='boolean')throw new Error('Invalid chat settings.');saveSettings({showChatInRemote:value});for(const s of states.values()){if(s.chatWindow&&!s.chatWindow.isDestroyed())s.chatWindow.setContentProtection(!value);syncCursorExclusions(s);}return value;});
function announceProfile(next){for(const s of states.values()){if(!s.owner&&!s.win.isDestroyed())s.win.webContents.send('profile-changed',next);if(s.discovery){s.discovery.name=next.name;s.discovery.status=next.status;s.discovery.refresh();}if(s.directSocket?.readyState===1)s.directSocket.send(JSON.stringify({type:'profile',...next}));}}
ipcMain.handle('profile-status',(e,status)=>{state(e);if(!require('../shared/profile.cjs').STATUSES.includes(status))throw Error('Invalid profile status.');const next={...profile(),status};saveSettings({profile:next});announceProfile(next);return next;});
ipcMain.handle('profile-save', (e, value) => { const s = state(e); if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 60 || !require('../shared/profile.cjs').STATUSES.includes(value.status)) throw new Error('Enter a profile name and status.'); const next = { ...profile(), name: value.name.trim(), status: value.status }; saveSettings({ profile: next }); if (s.discovery) { s.discovery.name = next.name; s.discovery.status = next.status; s.discovery.refresh(); } if(s.directSocket?.readyState===1)s.directSocket.send(JSON.stringify({type:'profile',...next})); return next; });
async function readProfilePhoto(file,background=false) {
  const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif'}[path.extname(file).toLowerCase()];
  if(!mime)throw new Error('This photo could not be opened.');
  if((await fs.promises.stat(file)).size>10*1024**2)throw new Error('Choose a profile photo smaller than 10 MB.');
  const bytes=await fs.promises.readFile(file);
  if(bytes.length>10*1024**2)throw new Error('Choose a profile photo smaller than 10 MB.');
  // Chromium decodes AVIF/WebP/GIF; keep the existing small, static PNG wire format.
  const decoder=new BrowserWindow({show:false,skipTaskbar:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true}});
  decoder.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  decoder.webContents.on('will-navigate',event=>event.preventDefault());
  let timer;
  try {
    return await Promise.race([(async()=>{
      await decoder.loadURL('data:text/html,'+encodeURIComponent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; object-src \'none\'; base-uri \'none\'">'));
      return decoder.webContents.executeJavaScript(`(async()=>{
        const bytes=Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),c=>c.charCodeAt(0));
        const image=await createImageBitmap(new Blob([bytes],{type:${JSON.stringify(mime)}}));
        try{
          const background=${JSON.stringify(background)},side=Math.min(image.width,image.height),canvas=document.createElement('canvas');
          if(background){canvas.width=960;canvas.height=Math.max(1,Math.round(image.height*960/image.width));if(canvas.height>540){canvas.width=Math.max(1,Math.round(image.width*540/image.height));canvas.height=540;}canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',.8);if(data.length>300000)throw new Error('Choose a smaller background.');return data;}
          for(const size of [64,48]){
            canvas.width=canvas.height=size;const context=canvas.getContext('2d');context.imageSmoothingQuality='high';
            context.drawImage(image,(image.width-side)/2,(image.height-side)/2,side,side,0,0,size,size);
            const avatar=canvas.toDataURL('image/png');if(avatar.length<=24000)return avatar;
          }
          throw new Error('Choose a smaller profile photo.');
        }finally{image.close();}
      })()`);
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Photo decoding timed out.')),15000)})]);
  }catch{throw new Error('This photo could not be opened.');}
  finally{clearTimeout(timer);if(!decoder.isDestroyed())decoder.destroy();}
}
ipcMain.handle('group-photo',async(e,id,background=false)=>{const s=state(e);if(id&&s.chatStore?.load().groups[id]?.owner!==s.identity.deviceId)throw new Error('Only the group owner can edit the group.');const chosen=await dialog.showOpenDialog(s.chatWindow||s.win,{properties:['openFile'],filters:[{name:'Images',extensions:['png','jpg','jpeg','webp','gif','avif']}]});return chosen.canceled?undefined:readProfilePhoto(chosen.filePaths[0],background===true);});
ipcMain.handle('profile-photo', async (e, remove) => {
  const s=state(e);let avatar='';
  if(!remove){
    const chosen=await dialog.showOpenDialog(s.win,{filters:[{name:'Profile photo',extensions:['png','jpg','jpeg','avif','webp','gif']}],properties:['openFile']});
    if(chosen.canceled)return profile();avatar=await readProfilePhoto(chosen.filePaths[0]);
  }
  const next={...profile(),avatar};saveSettings({profile:next});announceProfile(next);return next;
});
ipcMain.handle('lan-open', (event, id, endpoint) => {
  const s = state(event);
  if (!require('./discovery.cjs').UUID.test(id) || typeof endpoint !== 'string') throw new Error('Invalid LAN transport.');
  const url = new URL(validateEndpoint(endpoint));
  if (url.protocol !== 'ws:' || !network.localAddress(url.hostname) || url.pathname !== '/' || url.search || url.hash) throw new Error('A local IP address is required.');
  s.lanSockets ||= new Map(); if (s.lanSockets.has(id) || s.lanSockets.size >= 20) throw new Error('LAN connection limit reached.');
  const ws = new (require('ws').WebSocket)(url.href, { localAddress: network.sourceAddress(url.hostname), handshakeTimeout: 10000, maxPayload: 110000, perMessageDeflate: false });
  s.lanSockets.set(id, ws);
  const emit = value => { if (!s.win.isDestroyed()) s.win.webContents.send('lan-socket', { id, ...value }); };
  ws.on('open', () => emit({ type: 'open' }));
  ws.on('message', raw => { try { emit({ type: 'message', data: JSON.parse(raw) }); } catch {} });
  ws.on('error', () => emit({ type: 'error', message: 'LAN connection failed. Check the address, firewall and VPN LAN access.' }));
  ws.on('close', () => { s.lanSockets.delete(id); emit({ type: 'close' }); });
});
ipcMain.on('lan-send', (event, id, value) => { const ws = state(event,false)?.lanSockets?.get(id); if (ws?.readyState === 1 && typeof value === 'string' && Buffer.byteLength(value) <= 110000) ws.send(value); });
ipcMain.on('lan-close', (event, id) => state(event,false)?.lanSockets?.get(id)?.close());
ipcMain.handle('discovery', event => { const s = state(event); s.discovery?.refresh(); return decorateDiscovery(s.discovery?.snapshot() || { peers: [], interfaces: [], errors: ['LAN listener is not ready.'] }); });
function createWindow({viewerOwner,target}={}) {
  const work = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({ width: Math.min(1100, work.width - 16), height: Math.min(720, work.height - 16), minWidth: Math.min(1000, work.width - 16), minHeight: Math.min(720, work.height - 16),
    backgroundColor: settings().theme==='light'?'#faf6ff':'#160d20', title: 'Shatoot Connect', icon:path.join(__dirname,'ui/assets/app-icon.png'), show:!viewerOwner&&(smoke || !process.argv.includes('--start-in-tray')), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  const s = { win,viewerOwner,remoteTarget:target,identity:viewerOwner?.identity, source: null, control: false, helper: null, captureAllowed: false, language: 'en' };
  if(viewerOwner){win.setTitle('Shatoot Connect · '+target.address);win.on('page-title-updated',event=>event.preventDefault());}
  const contentsId = win.webContents.id;
  if (smoke) {
    win.webContents.on('console-message', (_event, details) => smokeLog(`renderer: ${details.message}`));
    win.webContents.on('did-fail-load', (_event, code, description) => smokeLog(`load error ${code}: ${description}`));
    win.webContents.on('did-finish-load', () => smokeLog('did-finish-load'));
    win.webContents.on('render-process-gone', (_event, details) => smokeLog(`renderer gone: ${details.reason}`));
  }
  states.set(win.webContents.id, s);
  win.on('blur', () => { s.grab?.stdin.end(); s.grab = null; });
  win.on('will-resize',(event,bounds,details)=>{if(!s.videoSizing||s.win.isMaximized()||s.win.isFullScreen())return;const {ratio,extraWidth,extraHeight}=s.videoSizing,outer=s.win.getBounds(),content=s.win.getContentBounds(),horizontal=outer.width-content.width+extraWidth,vertical=outer.height-content.height+extraHeight;const [minWidth,minHeight]=s.win.getMinimumSize();if(['top','bottom'].includes(details?.edge)){bounds.height=Math.max(minHeight,bounds.height);bounds.width=Math.round((bounds.height-vertical)*ratio+horizontal);if(bounds.width<minWidth){bounds.width=minWidth;bounds.height=Math.round((minWidth-horizontal)/ratio+vertical);}}else{bounds.width=Math.max(minWidth,bounds.width);bounds.height=Math.round((bounds.width-horizontal)/ratio+vertical);if(bounds.height<minHeight){bounds.height=minHeight;bounds.width=Math.round((minHeight-vertical)*ratio+horizontal);}}event.preventDefault();s.win.setBounds(bounds);});
  win.removeMenu();
  win.webContents.setWebRTCIPHandlingPolicy('default');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('close', event => { diagnostic('window-close-request',{type:s.outgoingDesktop?'viewer':'main'});if (!quitting) { event.preventDefault(); if(s.viewerOwner||s.outgoingDesktop){win.webContents.send('remote-window-close');return;} win.hide(); } });
  win.on('hide',()=>diagnostic('window-hidden',{type:s.outgoingDesktop?'viewer':'main'}));
  win.on('unresponsive',()=>diagnostic('window-unresponsive',{type:s.outgoingDesktop?'viewer':'main'}));
  win.on('closed', () => { for (const child of states.values()) {if (child.owner === s) closeExtraHost(child);else if(child.viewerOwner===s)child.win.destroy();} s.chatWindow?.destroy(); collaborationHost.close(s); s.discovery?.close(); for (const ws of s.lanSockets?.values() || []) ws.terminate(); hideHostOverlay(s); release(s); s.keyboardMonitor?.stdin.end(); s.helper?.stdin.end(); s.directSocket?.close(); s.directService?.close(); states.delete(contentsId); });
  win.loadFile(path.join(__dirname, 'ui/index.html'),viewerOwner?{query:{viewer:'1'}}:{});
  return win;
}
ipcMain.handle('config', e => {
  const s = state(e), saved = settings();
  let bootstrap = {};
  try { bootstrap = JSON.parse(fs.readFileSync(path.join(process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe')), 'shatootconnect.connection.json'), 'utf8')); } catch {}
  s.language = saved.language === 'fa' ? 'fa' : 'en';
  refreshTray(s);
  if (!s.identity) s.identity = smoke ? { deviceId: crypto.randomUUID(), deviceSecret: crypto.randomBytes(32).toString('base64url') } : identity();
  const endpoint = saved.endpoint || bootstrap.endpoint || (smoke ? 'ws://127.0.0.1:8787' : 'wss://connect.shatootsoft.com');
  let serverKey = bootstrap.endpoint === endpoint ? bootstrap.serverKey || '' : '';
  try { if (saved.serverKeys?.[endpoint]) serverKey = safeStorage.decryptString(Buffer.from(saved.serverKeys[endpoint], 'base64')); } catch {}
  s.sharedCursor = saved.inputModeVersion===1?saved.sharedCursor!==false:true; s.showGuestCursor = saved.showGuestCursor !== false;
  if(saved.inputModeVersion!==1)saveSettings({inputModeVersion:1,sharedCursor:true});
  const pendingFavorite = s.viewerOwner?null:launchFavorite;if(!s.viewerOwner)launchFavorite=null;
  return { viewerWindow:!!s.viewerOwner,remoteTarget:s.remoteTarget,remotePreview:s.remoteTarget?(sessionPreviews.get(preferences.destination(s.remoteTarget),s.remoteTarget.deviceId)||{image:s.remoteTarget.preview||'',kind:'wallpaper'}):null,autoQuality:saved.autoQuality!==false,allowPrivacyScreen:saved.allowPrivacyScreen===true,privacyScreenSupported:privacySupported(),showChatInRemote:saved.showChatInRemote===true,theme:saved.theme==='light'?'light':'dark',rememberPasswords: saved.rememberPasswords !== false, startupEnabled: saved.startupEnabled !== false, smoke, endpoint, serverKey, fixedPassword: preferences.fixedPassword(), unattended: preferences.unattended(), internetEnabled: saved.internetEnabled !== false, showGuestCursor: saved.showGuestCursor !== false, showHostCursor: saved.showHostCursor !== false, autoAcceptFiles: saved.autoAcceptFiles !== false, requireChatApproval: saved.requireChatApproval === true, qualityProfile: PROFILES[saved.qualityProfile] ? saved.qualityProfile : 'speed', favorites: preferences.list(), pendingFavorite, sharedCursor: s.sharedCursor, language: s.language, ...s.identity, ...profile(), profiles: PROFILES, version: app.getVersion() };
});
ipcMain.handle('internet-enabled', (e,value)=>{state(e);if(typeof value!=='boolean')throw new Error('Invalid connection mode.');saveSettings({internetEnabled:value});return value;});
ipcMain.handle('show-guest-cursor', (e,value)=>{const s=state(e);if(typeof value!=='boolean')throw new Error('Invalid cursor setting.');saveSettings({showGuestCursor:value});s.showGuestCursor=value;if(!value)hideGuestCursor(s);return value;});
ipcMain.handle('quality-profile', (e, name) => { state(e); if (!PROFILES[name]) throw new Error('Invalid quality profile.'); saveSettings({ qualityProfile: name }); return name; });
ipcMain.handle('video-preferences',(e,value)=>{
  const s=state(e);if(s.owner||!value||typeof value!=='object'||Object.keys(value).some(k=>!['autoQuality','allowPrivacyScreen'].includes(k))||Object.values(value).some(v=>typeof v!=='boolean'))throw new Error('Invalid video preferences.');
  saveSettings(value);
  if(value.allowPrivacyScreen===false)for(const peer of states.values()){peer.privacyPermitted=false;displayPrivacy.release(peer);publishPrivacy(peer);}
  return {autoQuality:settings().autoQuality!==false,allowPrivacyScreen:settings().allowPrivacyScreen===true};
});
ipcMain.handle('privacy-screen',(e,active)=>{
  const s=state(e);if(typeof active!=='boolean')throw new Error('Invalid privacy screen request.');
  if(active&&(!s.captureAllowed||!s.control||!s.privacyPermitted||settings().allowPrivacyScreen!==true))throw new Error('Privacy screen requires prior permission on the remote computer.');
  const result=displayPrivacy.request(s,active);return {...result,allowed:s.privacyPermitted===true&&settings().allowPrivacyScreen===true};
});
ipcMain.handle('show-host-cursor', (e, value) => { state(e); if (typeof value !== 'boolean') throw new Error('Invalid cursor setting.'); saveSettings({ showHostCursor: value }); return value; });
ipcMain.handle('keyboard-apply', (e, layout) => { const s = state(e); if ((!s.control && !s.exchangeAllowed) || !/^[0-9a-f]{8}$/i.test(layout)) throw new Error('Keyboard synchronization requires control.'); if (smoke) { s.testAppliedLayout = layout; s.win.webContents.send('keyboard-layout', layout); return; }if(s.hostInput&&!inputControl.accept(s,{type:'layout',layout}))return; helper(s).stdin.write(JSON.stringify({ type: 'layout', layout }) + '\n'); });
ipcMain.handle('unattended', (e, enabled) => { const s = state(e); if (s.captureAllowed) throw new Error('End the session before changing access settings.'); return preferences.setUnattended(enabled); });
ipcMain.handle('fixed-password', (e, value) => {
  const s = state(e); if (s.captureAllowed) throw new Error('End the current session before changing the password.');
  const password = preferences.setFixedPassword(value);
  if (s.directSocket?.readyState === 1) s.directSocket.send(JSON.stringify({ type: 'register', hostToken: s.directHostToken, ...s.identity, ...profile(), multiDesktop: true, password }));
  return password;
});
ipcMain.handle('favorite-save', (e, value) => { state(e); preferences.save(value);computerChanged(); return preferences.list(); });
ipcMain.handle('favorite-get', (e, id) => { state(e); const record=preferences.get(id);record.password=preferences.recall(record)||record.password;if(!record.serverKey && settings().serverKeys?.[record.endpoint]) record.serverKey=safeStorage.decryptString(Buffer.from(settings().serverKeys[record.endpoint],'base64')); return record; });
ipcMain.handle('connections', (e, operation, value) => {
  state(e);
  if(operation==='history')return preferences.history();
  if(operation==='computers')return preferences.computers();
  if(operation==='recall')return preferences.recall(value);
  if(operation==='attempt')return preferences.attempt(value);
  if(operation==='connected')return preferences.connected(value);
  if(operation==='resolve')return preferences.decorate(value.peer,value.route);
  if(operation==='remember')return preferences.remember(value);
  if(operation==='clear')return preferences.clearHistory();
  if(operation==='save'){preferences.saveHistory(value);return preferences.list();}
  if(operation==='get'){const h=preferences.history().find(h=>h.id===value);if(!h)throw new Error('Connection history entry not found.');return {...h,password:preferences.recall(h),serverKey:settings().serverKeys?.[h.endpoint]?safeStorage.decryptString(Buffer.from(settings().serverKeys[h.endpoint],'base64')):''};}
  throw new Error('Invalid connection history operation.');
});
ipcMain.handle('favorite-delete', async (e, id) => {
  state(e); preferences.get(id);
  const shortcut = path.join(app.getPath('desktop'), preferences.shortcutName(id));
  if (fs.existsSync(shortcut)) { const link = shell.readShortcutLink(shortcut); if (link.args.includes(`--connect-saved=${id}`)||link.args.includes(`-Favorite ${id}`)) await shell.trashItem(shortcut); }
  preferences.remove(id); return preferences.list();
});
ipcMain.handle('favorite-shortcut', (e, id) => { state(e); return createFavoriteShortcut(id); });
function watchKeyboard(s, enabled) {
  if (!enabled) { s.keyboardMonitor?.stdin.end(); s.keyboardMonitor = null; return; }
  if (s.keyboardMonitor) return;
  const exe = app.isPackaged ? path.join(process.resourcesPath, 'input', 'ShatootConnect.Input.exe') : path.join(__dirname, '../native/publish/ShatootConnect.Input.exe');
  const proc = spawn(exe, ['--keyboard-monitor'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }); s.keyboardMonitor = proc;
  let buffer = '';
  proc.on('error', () => { if (s.keyboardMonitor === proc) s.keyboardMonitor = null; });
  proc.stdin.on('error', () => {});
  proc.stdout.on('data', chunk => { buffer += chunk; if (buffer.length > 16000) buffer = ''; let end; while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); try { const data = JSON.parse(line); if (data.type === 'host-cursor' && s.captureAllowed && s.source && s.keyboardMonitor === proc && !s.win.isDestroyed()) { const display = screen.getAllDisplays().find(d => String(d.id) === s.source.display_id); if (display) { const b = screen.dipToScreenRect(null, display.bounds); s.win.webContents.send('host-cursor', { type: 'host-cursor', x: (data.x-b.x)/Math.max(1,b.width-1), y: (data.y-b.y)/Math.max(1,b.height-1), visible: data.visible, physical:data.physical===true }); } } if (/^[0-9a-f]{8}$/i.test(data.layout) && s.keyboardMonitor === proc && !s.win.isDestroyed()) { s.win.webContents.send('keyboard-layout', data.layout); const waiting = s.keyboardRequests?.get(data.request); if (waiting) { clearTimeout(waiting.timer); s.keyboardRequests.delete(data.request); waiting.resolve(data.layout); } } } catch {} } });
  proc.on('exit', () => { if (s.keyboardMonitor === proc) s.keyboardMonitor = null; });
}
ipcMain.handle('keyboard-watch', (e, enabled) => watchKeyboard(state(e), enabled));
ipcMain.handle('keyboard-current', (e) => {
  const s = state(e); watchKeyboard(s, true); s.keyboardRequests ||= new Map();
  if (smoke) s.keyboardQueryCount = (s.keyboardQueryCount || 0) + 1;
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID(); const timer = setTimeout(() => { s.keyboardRequests.delete(id); reject(new Error('Keyboard layout could not be read.')); }, 2000);
    s.keyboardRequests.set(id, { resolve, reject, timer }); s.keyboardMonitor.stdin.write(id + '\n');
  });
});
ipcMain.handle('shared-cursor', (e, enabled) => {
  const s = state(e);
  if (s.captureAllowed) throw new Error('End the current session before changing pointer mode.');
  s.sharedCursor = enabled === true; saveSettings({ sharedCursor: s.sharedCursor,inputModeVersion:1 }); return s.sharedCursor;
});
ipcMain.handle('overlay-info', e => {
  const s = [...states.values()].find(value => value.overlay?.webContents === e.sender);
  if (!s || e.senderFrame !== e.sender.mainFrame) throw new Error('Unauthorized overlay IPC');
  return { name: s.viewerName, language: s.language, control: s.control };
});
ipcMain.on('overlay-disconnect', e => {
  const s = [...states.values()].find(value => value.overlay?.webContents === e.sender);
  if (s && e.senderFrame === e.sender.mainFrame) disconnectHost(s);
});
ipcMain.on('overlay-hide',e=>{const s=[...states.values()].find(value=>value.overlay?.webContents===e.sender);if(s&&e.senderFrame===e.sender.mainFrame){s.overlayHidden=true;s.overlay.hide();}});
ipcMain.handle('validate-endpoint', (e, endpoint) => { state(e); return validateEndpoint(endpoint); });
ipcMain.handle('direct-endpoint', (e, address) => {
  state(e);
  return validateDirect(address);
});
ipcMain.handle('direct-listener', async e => {
  const s = state(e);
  if (s.directInfo) return s.directInfo;
  if (s.directStarting) return s.directStarting;
  s.directStarting = (async () => {
    const hostToken = crypto.randomBytes(32).toString('hex');
    s.directHostToken = hostToken;
    const presence = () => ({ service: 'ShatootConnect', version: 1,appVersion:app.getVersion(),kind: 'presence', deviceId: s.identity.deviceId, name: profile().name, status: profile().status, port: service.server.address()?.port, capabilities: ['desktop', 'chat', 'files', 'groups'] });
    const service = createSignalingServer({ port: smoke ? 0 : 8788, directHostToken: hostToken, presence, deviceProfile: async () => ({ ...profile(), deviceId: s.identity.deviceId,preview:await wallpaperPreview().catch(()=>''),previewKind:'wallpaper' }) });
    try {
      await service.listen(); s.directService = service;
      const port = service.server.address().port;
      const { WebSocket } = require('ws');
      const ws = new WebSocket(`ws://127.0.0.1:${port}`); s.directSocket = ws;
      const credentials = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { ws.close(); reject(new Error('LAN listener timed out.')); }, 10000);
        ws.on('error', error => { clearTimeout(timer); reject(error); });
        ws.on('message', raw => {
          const message = JSON.parse(raw);
          smokeLog(`direct host received ${message.type}`);
          if (message.type === 'ready') ws.send(JSON.stringify({ type: 'register', hostToken, deviceId: s.identity.deviceId, deviceSecret: s.identity.deviceSecret, ...profile(), multiDesktop: true, password: preferences.fixedPassword() }));
          else if (message.type === 'registered') { clearTimeout(timer); if (s.directInfo) { s.directInfo.password = message.password; s.directInfo.fixedPassword = message.fixedPassword; if (!s.win.isDestroyed()) s.win.webContents.send('direct-info', s.directInfo); } resolve(message); }
          else if (!s.win.isDestroyed()) s.win.webContents.send('direct-message', message);
        });
        ws.on('close', () => { clearTimeout(timer); reject(new Error('LAN listener closed.')); if (!s.win.isDestroyed()) s.win.webContents.send('direct-message', { type: 'ended', reason: 'LAN listener closed.' }); });
      });
      const addresses = Object.values(require('node:os').networkInterfaces()).flat().filter(n => n.family === 'IPv4' && !n.internal).map(n => `${n.address}:${port}`);
      s.discovery = new (require('./discovery.cjs').Discovery)({ identity: s.identity,appVersion:app.getVersion(),name: profile().name, port,knownEndpoints:()=>preferences.computers().filter(r=>!r.endpoint).map(r=>r.address), ...(smoke ? { discoveryPort: 0, networkInterfaces: () => ({}), neighbors: false } : {}) }); s.discovery.status = profile().status;
      s.discovery.on('change',value=>{let changed=false;for(const peer of value.peers)changed=rememberComputer(peer,{address:peer.endpoints[0]},peer.previewKind==='wallpaper')||changed;if(changed)computerChanged();if(!s.win.isDestroyed())s.win.webContents.send('discovery',decorateDiscovery(value));});
      s.discovery.start().catch(() => {});
      return s.directInfo = { addresses, port, password: credentials.password, fixedPassword: credentials.fixedPassword };
    } catch (error) { s.directSocket?.close(); await service.close(); s.directService = null; s.directInfo = null; throw error; }
  })();
  try { return await s.directStarting; } finally { s.directStarting = null; }
});
ipcMain.on('direct-send', (e, message) => {
  const s = state(e,false);if(!s)return;
  smokeLog(`direct host sending ${message?.type}`);
  if (!message || !['accept', 'reject', 'signal', 'end-session', 'hosting-busy', 'desktop-reject', 'collab-accept', 'collab-reject', 'collab-signal', 'collab-leave'].includes(message.type) || JSON.stringify(message).length > 110000) return;
  if (message.type === 'accept' && !s.captureAllowed) return;
  if (s.directSocket?.readyState === 1) s.directSocket.send(JSON.stringify(message));
});
ipcMain.handle('save-endpoint', (e, endpoint, serverKey = '') => {
  state(e); const result = validateEndpoint(endpoint);
  if (typeof serverKey !== 'string' || serverKey.length > 256) throw new Error('Invalid server connection key.');
  const serverKeys = settings().serverKeys || {};
  if (serverKey) serverKeys[result] = safeStorage.encryptString(serverKey).toString('base64'); else delete serverKeys[result];
  saveSettings({ endpoint: result, serverKeys }); return result;
});
ipcMain.handle('appearance',(event,value)=>{
  if(event.senderFrame!==event.sender.mainFrame||!BrowserWindow.fromWebContents(event.sender))throw new Error('Unauthorized appearance request.');
  if(value===undefined)return settings().theme==='light'?'light':'dark';
  state(event);if(!['light','dark'].includes(value))throw new Error('Invalid theme.');saveSettings({theme:value});nativeTheme.themeSource=value;
  for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed())win.webContents.send('appearance-changed',value);
  for(const s of states.values())for(const win of [s.win,s.chatWindow])if(win&&!win.isDestroyed())win.setBackgroundColor(value==='light'?'#faf6ff':'#160d20');
  return value;
});
ipcMain.handle('language', (e, language) => {
  const s = state(e); s.language = language === 'fa' ? 'fa' : 'en'; saveSettings({ language: s.language });if(s.chatWindow&&!s.chatWindow.isDestroyed())s.chatWindow.setTitle(chatWindowTitle(s)); refreshTray(s); return s.language;
});
ipcMain.handle('local-server', async (e, endpoint) => {
  smokeLog('local-server IPC');
  state(e);
  const port = smoke ? 0 : Number(new URL(endpoint).port || 8787);
  if (!localServer) {
    const service = createSignalingServer({ port, ...(smoke && process.env.SHATOOTCONNECT_SMOKE_ICE ? { iceServers: JSON.parse(process.env.SHATOOTCONNECT_SMOKE_ICE), forceRelay: true } : {}) });
    try { await service.listen(); localServer = service; smokeLog('local server listening'); }
    catch (error) { await service.close(); throw new Error(error.code === 'EADDRINUSE' ? `پورت ${port} اشغال است. پورت دیگری در نشانی سرور وارد کنید.` : error.message); }
  }
  const activePort = localServer.server.address().port;
  const addresses = Object.values(require('node:os').networkInterfaces()).flat()
    .filter(n => n.family === 'IPv4' && !n.internal).map(n => `ws://${n.address}:${activePort}`);
  return { port: activePort, addresses };
});
ipcMain.handle('sources', async e => {
  state(e);
  return (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 360, height: 202 } }))
    .map(s => ({ id: s.id, displayId: s.display_id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
});
ipcMain.handle('select-source', async (e, id) => {
  const s = state(e); release(s);
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  const source = sources.find(source => source.id === id);
  if (!source) throw new Error('نمایشگر پیدا نشد.');
  s.source = source;
  s.captureAllowed = false;
  return true;
});
ipcMain.handle('approve', async (e, name, fixedPassword, peer) => {
  const s = state(e);
  s.privacyPermitted=settings().allowPrivacyScreen===true&&privacySupported();
  s.viewerName=preferences.decorate({...peer,name:String(name).slice(0,60)}).displayName;name=s.viewerName;
  s.overlayHidden=false;
  if (smoke) { s.captureAllowed = true; s.control = true; return { accepted: true, control: true, privacyAllowed:s.privacyPermitted }; }
  const fa = s.language === 'fa';
  const result = preferences.canAutoApprove(fixedPassword) ? { response: 2 } : await notices.showMessageBox(s.win, { priority:'critical', type: 'question', title: fa ? 'درخواست اتصال ShatootConnect' : 'ShatootConnect connection request',
    message: fa ? `${String(name).slice(0, 60)} درخواست مشاهدهٔ صفحهٔ شما را دارد.` : `${String(name).slice(0, 60)} wants to view your screen.`,
    detail: fa ? 'فقط به فرد مورد اعتماد اجازه دهید. برای قطع فوری: Ctrl + Shift + F12' : 'Only allow someone you trust. Emergency disconnect: Ctrl + Shift + F12',
    buttons: fa ? ['رد درخواست', 'فقط مشاهده', 'مشاهده، کنترل و فایل'] : ['Reject', 'View only', 'View, control and files'], defaultId: 0, cancelId: 0, noLink: true });
  if (s.win.isDestroyed() || !s.source) return { accepted: false, control: false };
  if (result.response === 2) {
    const display = screen.getAllDisplays().find(d => String(d.id) === s.source.display_id);
    if (!display) throw new Error('نمایشگر انتخاب‌شده در دسترس نیست.');
    const bounds = screen.dipToScreenRect(null, display.bounds);
    s.inputBounds=bounds;helper(s,true);
    s.control = true;
    s.inputReason=null;publishInputControl();
  }
  s.captureAllowed = result.response > 0;
  return { accepted: s.captureAllowed, control: s.control, privacyAllowed:s.captureAllowed&&s.control&&s.privacyPermitted };
});
ipcMain.handle('capture-approved', async e => {
  const s = state(e); if (!s.captureAllowed || !s.source) throw new Error('Screen capture requires host consent.');
  await s.win.webContents.executeJavaScript('window.shatootconnectCapture()', true);
  showHostOverlay(s);
});
ipcMain.handle('revoke', e => { const s = state(e);notices.cancelFor(s.win,'critical'); release(s); s.source = null; s.captureAllowed = false; hideHostOverlay(s); if (s.win.isFullScreen()) s.win.setFullScreen(false); });
ipcMain.handle('revoke-control', e => release(state(e)));
ipcMain.handle('release-keys', e => {
  const s = state(e);if(s.hostInput)inputControl.drop(s);else if (s.helper?.stdin.writable) s.helper.stdin.write('{"type":"release"}\n');
});
ipcMain.on('input', (e, data) => {
  const s = state(e,false);if(!s)return;
  if (smoke && ['key', 'physical-key'].includes(data?.type)) s.testInputPackets = (s.testInputPackets || 0) + 1;
  if (smoke || !s.control || !s.helper?.stdin.writable || !data || typeof data !== 'object') return;
  if (!['move', 'button', 'wheel', 'key', 'physical-key', 'release', 'layout'].includes(data.type)) return;
  const json = JSON.stringify(data);
  if(json.length>=2048)return;
  if(!inputControl.accept(s,data)){publishInputControl();return;}
  if(s.helper.stdin.writableLength>=32768){inputControl.drop(s);return;}
  s.helper.stdin.write(json + '\n');
});
ipcMain.handle('exit-fullscreen', e => { const s = state(e); if (s.win.isFullScreen()) s.win.setFullScreen(false); });
ipcMain.handle('copy-text', (e, text) => {
  const s=state(e);
  if (typeof text !== 'string' || text.length > 1000000) throw new Error('Invalid clipboard text');
  if(smoke){s.copiedText=text;s.testClipboard={seq:(s.testClipboard?.seq||0)+1,text,files:[],supported:true};return;}
  return clipboard.writeText(text);
});

function nativeExecutable() { return app.isPackaged ? path.join(process.resourcesPath, 'input', 'ShatootConnect.Input.exe') : path.join(__dirname, '../native/publish/ShatootConnect.Input.exe'); }
ipcMain.handle('keyboard-grab', (e, enabled) => {
  const s = state(e); if (!enabled) { s.grab?.stdin.end(); s.grab = null; return false; }
  if (smoke || !s.exchangeAllowed || !s.win.isFocused()) return false;
  if (s.grab) return true;
  const handle = s.win.getNativeWindowHandle(); const value = (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString(16);
  const proc = spawn(nativeExecutable(), ['--keyboard-grab', value], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }); s.grab = proc; let buffer = '';
  proc.stdin.on('error', () => {});
  proc.on('error', () => { if (s.grab === proc) { s.grab = null; if (!s.win.isDestroyed()) s.win.webContents.send('grabbed-key', { error: 'Keyboard capture could not start.' }); } });
  proc.on('exit', () => { if (s.grab === proc) { s.grab = null; if (!s.win.isDestroyed()) s.win.webContents.send('grabbed-key', { stopped: true }); } });
  proc.stdout.on('data', chunk => { buffer += chunk; if (buffer.length > 32000) { proc.kill(); return; } let end; while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); try { const data = JSON.parse(line); if (s.grab === proc && s.exchangeAllowed && !s.win.isDestroyed()) { if (data.emergency) { release(s); s.win.webContents.send('emergency-stop'); } else s.win.webContents.send('grabbed-key', data); } } catch {} } });
  return true;
});
function nativeClipboard(s, value) {
  // Smoke peers have independent simulated clipboards; tests must not overwrite
  // the interactive user's clipboard. The production bridge is a native pipe.
  if (smoke) { s.testClipboard ||= { seq: 1, text: '', files: [], supported: true };if(value.op==='offer'&&value.expectedSeq!=null&&value.expectedSeq!==s.testClipboard.seq)return Promise.resolve({seq:s.testClipboard.seq,skipped:true});if(value.op==='offer')s.testClipboard={seq:s.testClipboard.seq+1,text:'',files:[],remote:true,supported:true};if(value.op==='write'&&value.expectedSeq!=null&&value.expectedSeq!==s.testClipboard.seq)return Promise.resolve({seq:s.testClipboard.seq,skipped:true}); if (value.op === 'write') s.testClipboard = { seq: s.testClipboard.seq + 1, text: value.text || '', files: value.files || [], supported: true }; return Promise.resolve({ ...s.testClipboard }); }
  if (!s.clipboardProc) {
    const proc = spawn(nativeExecutable(), ['--clipboard'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }); s.clipboardProc = proc; s.clipboardRequests = new Map(); let buffer = '';
    const fail = () => { if (s.clipboardProc === proc) s.clipboardProc = null; for (const pending of requests.values()) { clearTimeout(pending.timer); pending.reject(new Error('Clipboard helper stopped.')); } requests.clear(); };
    const requests = s.clipboardRequests;
    proc.on('error', fail); proc.on('exit', fail); proc.stdin.on('error', fail);
    proc.stdout.on('data', chunk => { buffer += chunk; if (buffer.length > 13000000) { proc.kill(); return; } let end; while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); try { const data = JSON.parse(line);if(data.type==='clipboard-fetch'){s.win.webContents.send('exchange-paste',{token:data.token});continue;}const pending = requests.get(data.id); if (pending) { requests.delete(data.id); clearTimeout(pending.timer); data.error ? pending.reject(new Error(data.error)) : pending.resolve(data); } } catch {} } });
  }
  return new Promise((resolve, reject) => { const id = crypto.randomUUID(), requests = s.clipboardRequests; const timer = setTimeout(() => { requests.delete(id); reject(new Error('Clipboard timed out.')); }, 5000); requests.set(id, { resolve, reject, timer }); s.clipboardProc.stdin.write(JSON.stringify({ ...value, id }) + '\n'); });
}
ipcMain.handle('chat-clipboard',async(e,operation,token)=>{
  const s=state(e);
  if(operation==='copy'){
    if(typeof token!=='string'||!s.chatStore)throw new Error('This attachment is unavailable.');
    const files=s.chatStore.files(token);if(files.some(file=>!fs.existsSync(file)))throw new Error('The file was moved or deleted.');
    const written=await nativeClipboard(s,{op:'write',files}),check=await nativeClipboard(s,{op:'read'});if(check.files.length!==files.length||check.files.some((file,index)=>path.resolve(file).toLowerCase()!==path.resolve(files[index]).toLowerCase()))throw new Error('Clipboard changed. Copy the file again.');return {copied:true,count:files.length,sequence:written.seq};
  }
  if(operation==='read'){
    const data=await nativeClipboard(s,{op:'read'});if(data.files.length)return {files:true};
    return {files:false,text:data.text||'',image:smoke||data.text?'':await require('./clipboard-image.cjs').clipboardImage(clipboard).catch(()=> '')};
  }
  throw new Error('Invalid clipboard operation.');
});
ipcMain.handle('exchange', async (e, operation, value) => {
  const s = state(e);
  if (operation === 'viewer-start') { s.exchangeAllowed = true; return; }
  if (operation === 'stop') { s.exchangeAllowed = false;await s.clipboardTransfers?.reset();s.clipboardReceiving=false;s.virtualOffer=null; await s.transfers?.reset(); s.clipboardProc?.stdin.end(); s.clipboardProc = null; return; }
  if (!s.control && !s.exchangeAllowed) throw new Error('Clipboard and files require an active control session.');
  s.transfers ||= new (require('./transfers.cjs').Transfers)(app.getPath('downloads'));
  const transfers = s.transfers;
  switch (operation) {
    case 'clipboard-read': { const data = await nativeClipboard(s, { op: 'read' }); return { seq: data.seq, text: data.text, files: !!data.files.length, remote:data.remote, supported: data.supported }; }
    case 'clipboard-write': {const text=typeof value==='string'?value:value?.text;if(typeof text!=='string'||text.length>1000000)throw new Error('Invalid clipboard text.');return nativeClipboard(s,{op:'write',text,expectedSeq:value?.expectedSeq});}
    case 'clipboard-offer': {const {safeRelative}=require('./transfers.cjs');if(!value||!require('./discovery.cjs').UUID.test(value.token)||!Array.isArray(value.entries)||value.entries.length<1||value.entries.length>1000)throw new Error('Invalid clipboard offer.');let total=0;for(const entry of value.entries){safeRelative(entry.name);if(entry.name.length>259||!Number.isSafeInteger(entry.size)||entry.size<0)throw new Error('Invalid clipboard entry.');total+=entry.size;}if(total>10*1024**3)throw new Error('Clipboard files are too large.');const result=await nativeClipboard(s,{op:'offer',...value});if(!result.skipped)s.virtualOffer=value;return result;}
    case 'clipboard-materialized': {if(!s.virtualOffer||value?.token!==s.virtualOffer.token)throw new Error('Clipboard offer expired.');const files=s.clipboardTransfers?.completedEntries||[];s.clipboardProc?.stdin.write(JSON.stringify({op:'materialized',token:value.token,...(value.error?{error:String(value.error).slice(0,200)}:{files})})+'\n');return;}

    case 'clipboard-sources': { const data = await nativeClipboard(s, { op: 'read' }); return transfers.offer(data.files); }
    case 'pick': { const result = await dialog.showOpenDialog(s.win, { properties: ['openFile', 'multiSelections'] }); return result.canceled ? [] : transfers.offer(result.filePaths); }
    case 'sources': return transfers.offer(value);
    case 'read': return transfers.read(value);
    case 'begin': {
      if(settings().autoAcceptFiles===false&&!smoke){
        if(s.filePrompt)throw new Error('Another incoming file offer is awaiting approval.');s.filePrompt=true;
        try{const fa=s.language==='fa',answer=await notices.showMessageBox(s.win,{type:'question',message:fa?'دریافت فایل‌های این اتصال؟':'Receive files from this connection?',detail:'Downloads',buttons:fa?['رد','دریافت فایل‌ها']:['Decline','Receive files'],cancelId:0});if(answer.response!==1)throw new Error('File offer declined.');}finally{s.filePrompt=false;}
      }
      if(!s.control&&!s.exchangeAllowed)throw new Error('Clipboard and files require an active control session.');
      if(value?.clipboard){if(!s.virtualOffer||value.clipboard!==s.virtualOffer.token||JSON.stringify(value.entries)!==JSON.stringify(s.virtualOffer.entries))throw new Error('Clipboard offer expired.');s.clipboardTransfers||=new (require('./transfers.cjs').Transfers)(path.join(app.getPath('temp'),'ShatootConnect-Clipboard',String(process.pid)));s.clipboardReceiving=true;return s.clipboardTransfers.begin(value.entries);}
      s.clipboardReceiving=false;return transfers.begin(value);
    }
    case 'write': return (s.clipboardReceiving?s.clipboardTransfers:transfers).write(value);
    case 'end-file': return (s.clipboardReceiving?s.clipboardTransfers:transfers).endFile(value);
    case 'finish': { if(s.clipboardReceiving){const receiver=s.clipboardTransfers;receiver.completedEntries=receiver.incoming.entries.map(entry=>path.join(receiver.incoming.folder,...entry.name.split('/')));await receiver.finish();s.clipboardReceiving=false;return {clipboardVirtual:true,count:receiver.completedEntries.length};}const files = await transfers.finish(); try { const result = await nativeClipboard(s, { op: 'write', files }); return { seq: result.seq, count: files.length, clipboardReady:true }; } catch { return { count:files.length, clipboardReady:false }; } }
    case 'open-received': { const file=transfers.completed[0]; if(!file || !fs.existsSync(file)) throw new Error('No received files in this session.'); shell.showItemInFolder(file); return; }
    case 'cancel': await transfers.abort();await s.clipboardTransfers?.abort();s.clipboardReceiving=false;return;
    default: throw new Error('Invalid exchange operation.');
  }
});

app.whenReady().then(async () => {
  displayPrivacy=new(require('./display-privacy.cjs').DisplayPrivacy)({BrowserWindow,screen,supported:privacySupported,escapeAvailable:()=>globalShortcut.isRegistered('CommandOrControl+Shift+F12'),changed:(s,reason)=>{if(!['active','released'].includes(reason))s.privacyPermitted=false;publishPrivacy(s);}});
  smokeLog('app ready');
  if(crashProbe){await require('../tests/crash-recorder-smoke.cjs')({app,BrowserWindow,crashReporter:require('electron').crashReporter});return;}
  if (smoke) saveSettings({ theme:'dark',favorites: [], connectionHistory:[], connectionPasswords:{},computerCards:{}, rememberPasswords:true, fixedPassword: null, language: 'en' });
  if(smoke&&(process.argv.includes('--chat-notification-smoke')||process.argv.includes('--connection-ui-smoke')))saveSettings({internetEnabled:false,autoAcceptFiles:true});
  nativeTheme.themeSource=settings().theme==='light'?'light':'dark';
  // Microphone access is a short, window-specific grant after pressing Record.
  // Desktop capture keeps its independent source/approval checks and denies audio.
  const capturePermission = (wc, permission, details={}) => {
    const s=states.get(wc?.id)||[...states.values()].find(s=>s.chatWindow?.webContents===wc);
    if(!s)return false;
    const audioOnly=details.mediaType==='audio'||(details.mediaTypes?.length===1&&details.mediaTypes[0]==='audio');
    if(permission==='media'&&audioOnly&&Date.now()<(s.voicePermissions?.get(wc.id)||0))return true;
    return states.has(wc.id)&&(permission==='fullscreen'||(!!s.source&&['display-capture','media'].includes(permission)&&!audioOnly));
  };
  session.defaultSession.setPermissionCheckHandler((wc,permission,_origin,details)=>capturePermission(wc,permission,details));
  session.defaultSession.setPermissionRequestHandler((wc,permission,callback,details)=>callback(capturePermission(wc,permission,details)));
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const s = [...states.values()].find(s => s.win.webContents.mainFrame === request.frame);
    callback(s?.source && s.captureAllowed && !request.audioRequested ? { video: s.source } : null);
  });
  globalShortcut.register('CommandOrControl+Shift+F12', () => {
    displayPrivacy.clear('emergency');
    for (const s of states.values()) { release(s); s.source = null; s.captureAllowed = false; hideHostOverlay(s); s.win.webContents.send('emergency-stop'); }
  });
  const win = createWindow();
  if (!smoke) {
    tray = new Tray(path.join(__dirname, 'ui/assets/app-icon.png')); tray.setToolTip('Shatoot Connect');
    refreshTray(states.get(win.webContents.id));tray.on('double-click', () => showMain(states.get(win.webContents.id)));
    if(app.isPackaged)try{configureStartup(settings().startupEnabled!==false);}catch(error){notices.toast(win,error.message,{onActivate:()=>showMain(states.get(win.webContents.id))});}
    setTimeout(() => update.check(), 10000).unref(); setInterval(() => update.check(), 6 * 3600000).unref();
  }
  if (!smoke) for (const record of preferences.list()) if (record.shortcut && fs.existsSync(path.join(app.getPath('desktop'), preferences.shortcutName(record.id)))) { try { createFavoriteShortcut(record.id); } catch {} }
  if (smoke) {
    setTimeout(() => { smokeLog('Watchdog timeout');try{console.error(fs.readFileSync(path.join(__dirname,'../artifacts/smoke.log'),'utf8').split('\n').slice(-25).join('\n'));}catch{}app.exit(1); }, 240000).unref();
    const run=process.argv.includes('--media-smoke')?host=>require('../tests/media-smoke.cjs')({host,createWindow,states,privacy:displayPrivacy,app,log:smokeLog}):process.argv.includes('--ice-smoke')?host=>require('../tests/ice-smoke.cjs')({host,app,log:smokeLog}):process.argv.includes('--connection-ui-smoke')?host=>require('../tests/connection-ui-smoke.cjs')({host,createWindow,states,app,dialog,update,log:smokeLog,artifacts:path.join(__dirname,'../artifacts')}):process.argv.includes('--chat-notification-smoke')?host=>require('../tests/chat-notification-smoke.cjs')({host,createWindow,states,notices,screen,app,log:smokeLog,artifacts:path.join(__dirname,'../artifacts')}):runSmoke;
    run(win).catch(error => { smokeLog(error.stack); console.error(error); app.exit(1); });
  }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  displayPrivacy?.close();
  notices.close();
  globalShortcut.unregisterAll();
  for (const s of states.values()) { release(s); s.helper?.stdin.end(); }
  localServer?.close();
  const clipboardCache=path.join(app.getPath('temp'),'ShatootConnect-Clipboard',String(process.pid));try{fs.rmSync(clipboardCache,{recursive:true,force:true});}catch{}
});
app.on('second-instance', (_event,args)=>{
  if(args.includes('--quit-for-update')){quitting=true;app.quit();return;}
  if(args.includes('--quit-if-background')){if(!BrowserWindow.getAllWindows().some(win=>win.isVisible())){quitting=true;app.quit();}return;}
  const s = [...states.values()][0];
  const id = args.find(value => /^--connect-saved=[a-f0-9-]{36}$/.test(value))?.split('=')[1];
  if (s) { if(args.includes('--open-chat')){openChat(s);return;}showMain(s); if (id) s.win.webContents.send('connect-favorite', id); }
  else if (id) launchFavorite = id;
});

async function runSmoke(host) {
  smokeLog('start smoke');
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const wait = async (win, expr, timeout = 30000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await win.webContents.executeJavaScript(expr)) return; await delay(200); }
    smokeLog(await win.webContents.executeJavaScript("document.querySelector('#session-status')?.textContent || document.body.textContent"));
    smokeLog(await win.webContents.executeJavaScript('JSON.stringify(window.shatootconnectDiagnostics?.())'));
    for (const other of states.values()) if (other.win !== win && !other.win.isDestroyed()) smokeLog('other window: ' + await other.win.webContents.executeJavaScript('JSON.stringify(window.shatootconnectDiagnostics?.())'));
    fs.writeFileSync(path.join(__dirname, '../artifacts/failure.png'), (await win.webContents.capturePage()).toPNG());
    throw new Error(`Smoke timeout: ${expr}`);
  };
  await wait(host, '!!window.shatootconnectReady');
  host.setSize(1000, 720);
  await host.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
  const fullFormFit = "[...document.querySelectorAll('input,select,button,footer,#network-status,#app-version,.favorites-heading,#favorites-empty')].filter(e=>e.getClientRects().length && !e.closest('#favorites-list,#connection-history')).every(e=>{const r=e.getBoundingClientRect();return r.bottom<=innerHeight && r.top>=0 && r.left>=0 && r.right<=innerWidth}) && document.documentElement.scrollHeight<=innerHeight";
  const compactFit = await host.webContents.executeJavaScript(fullFormFit);
  if (await host.webContents.executeJavaScript("document.querySelector('#fixed-password').getClientRects().length > 0 || document.querySelector('#server-url').getClientRects().length > 0")) throw new Error('Advanced settings leaked onto main form');
  await host.webContents.executeJavaScript("document.querySelector('#open-settings').click(); true");
  if (!await host.webContents.executeJavaScript("document.querySelector('#settings-dialog').open && !document.querySelector('#settings-general').hidden && document.querySelector('#server-url').getClientRects().length === 0")) throw new Error('Settings did not open on the Application page');
  await host.webContents.executeJavaScript("selectSettingsTab('host');true");
  if(!await host.webContents.executeJavaScript("document.querySelector('#fixed-password').getClientRects().length > 0 && document.querySelector('#show-host-cursor').checked"))throw new Error('Host settings or default cursor preference failed');
  await host.webContents.executeJavaScript("document.querySelector('#settings-dialog').close(); true");
  await delay(150);
  if (!compactFit) throw new Error('Inputs do not fit at 1000x720');
  await require('../tests/workspace-ux-smoke.cjs')({host,states,notices,screen,wait,log:smokeLog,artifacts:path.join(__dirname,'../artifacts')});
  fs.writeFileSync(path.join(__dirname, '../artifacts/compact-en.png'), (await host.webContents.capturePage()).toPNG());
  smokeLog('host renderer ready');
  const keyboard = await host.webContents.executeJavaScript('window.shatootconnect.currentKeyboard()');
  if (!/^[A-F0-9]{8}$/.test(keyboard)) throw new Error('Actual Windows keyboard layout was not read');
  await host.webContents.executeJavaScript('window.shatootconnect.watchKeyboard(false)');
  await wait(host, '!!window.shatootconnectDirect');
  await host.webContents.executeJavaScript("document.querySelector('#internet-enabled').checked=false;document.querySelector('#internet-enabled').dispatchEvent(new Event('change'));true");
  await wait(host, 'config.internetEnabled === false && !registered');
  const offlinePassword=crypto.randomBytes(12).toString('hex');
  await host.webContents.executeJavaScript(`document.querySelector('#fixed-password').value=${JSON.stringify(offlinePassword)};document.querySelector('#save-fixed-password').click();true`);
  await wait(host, `config.fixedPassword===${JSON.stringify(offlinePassword)} && window.shatootconnectDirect.password===${JSON.stringify(offlinePassword)}`);
  if(await host.webContents.executeJavaScript("document.querySelector('#save-fixed-password').disabled || document.querySelector('#copy-password').disabled"))throw new Error('LAN-only password controls depend on Internet registration');
  await host.webContents.executeJavaScript("document.querySelector('#open-settings').click();true");
  for(const tab of ['host','lan','display','general','internet']){await host.webContents.executeJavaScript(`selectSettingsTab('${tab}');true`);if(!await host.webContents.executeJavaScript(`document.querySelector('#settings-${tab}').getClientRects().length>0 && document.querySelectorAll('[role=tabpanel]:not([hidden])').length===1`))throw new Error('Settings tabs overlap');}
  await host.webContents.executeJavaScript("selectSettingsTab('host');document.querySelector('#settings-dialog').close();true");
  smokeLog('Offline fixed-password save, LAN credentials, and five settings tabs passed');
  await host.webContents.executeJavaScript("document.querySelector('#local-server').click(); true", true);
  smokeLog('clicked local server');
  await wait(host, "document.querySelector('#server-status').dataset.state === 'online'");
  smokeLog('server online');
  await wait(host, "document.querySelector('#host-id').textContent.replace(/\\s/g,'').length === 9");
  if (await host.webContents.executeJavaScript('window.shatootconnectDiagnostics().capturing')) throw new Error('Captured screen before consent');
  smokeLog('host capture ready');
  const hostId = await host.webContents.executeJavaScript("document.querySelector('#host-id').textContent");
  const fixedPassword = crypto.randomBytes(16).toString('hex');
  await host.webContents.executeJavaScript(`document.querySelector('#fixed-password').value=${JSON.stringify(fixedPassword)}; document.querySelector('#save-fixed-password').click(); true`, true);
  await wait(host, `document.querySelector('#host-password').textContent === '••••••••' && window.shatootconnectDirect?.password === ${JSON.stringify(fixedPassword)}`);
  if (JSON.stringify(settings()).includes(fixedPassword)) throw new Error('Fixed password was stored in plaintext');
  await host.webContents.executeJavaScript("document.querySelector('#show-host-password').click(); true");
  if (await host.webContents.executeJavaScript("document.querySelector('#host-password').textContent") !== fixedPassword) throw new Error('Password reveal failed');
  await host.webContents.executeJavaScript("document.querySelector('#show-host-password').click(); true");
  await host.webContents.executeJavaScript("document.querySelector('#language').value='fa'; document.querySelector('#language').dispatchEvent(new Event('change')); true");
  await wait(host, "document.documentElement.dir === 'rtl'");
  await host.webContents.executeJavaScript("document.fonts.load('12px Vazirmatn').then(()=>true)");
  if (!await host.webContents.executeJavaScript("document.fonts.check('12px Vazirmatn') && getComputedStyle(document.documentElement).fontFamily.includes('Vazirmatn')")) throw new Error('Persian font not loaded');
  if (!await host.webContents.executeJavaScript(fullFormFit)) throw new Error('Persian form does not fit');
  await delay(200);
  fs.writeFileSync(path.join(__dirname, '../artifacts/compact-fa.png'), (await host.webContents.capturePage()).toPNG());
  await host.webContents.executeJavaScript("document.querySelector('#language').value='en'; document.querySelector('#language').dispatchEvent(new Event('change')); true");
  await wait(host, "document.documentElement.lang === 'en'");
  const credentials = await host.webContents.executeJavaScript("({id:document.querySelector('#host-id').textContent.replace(/\\s/g,''),password:config.fixedPassword || document.querySelector('#host-password').textContent,endpoint:document.querySelector('#server-url').value})");
  const viewer = createWindow();
  await wait(viewer, '!!window.shatootconnectReady');
  smokeLog('viewer ready');
  if(process.argv.includes('--quality-smoke'))for(const win of [host,viewer])await win.webContents.executeJavaScript("document.querySelector('#quality').value='quality';document.querySelector('#quality').dispatchEvent(new Event('change'));true");
  await viewer.webContents.executeJavaScript(`document.querySelector('#server-url').value=${JSON.stringify(credentials.endpoint)};document.querySelector('#remote-id').value=${JSON.stringify(credentials.id)};document.querySelector('#remote-password').value=${JSON.stringify(credentials.password)};document.querySelector('#quick-save').click(); true`, true);
  await wait(viewer, "!!document.querySelector('#save-computer-form')");
  await viewer.webContents.executeJavaScript("document.querySelector('#save-computer-form').requestSubmit();true");
  await wait(viewer, "document.querySelectorAll('.favorite-connect').length > 0");
  const favorite = preferences.list().find(record => record.address === credentials.id.replace(/\s/g,''));
  const shortcut = await viewer.webContents.executeJavaScript(`window.shatootconnect.favoriteShortcut(${JSON.stringify(favorite.id)})`);
  const link = shell.readShortcutLink(shortcut);
  if (!link.args.includes(`--connect-saved=${favorite.id}`) || link.args.includes(fixedPassword) || JSON.stringify(settings()).includes(fixedPassword)) throw new Error('Shortcut or saved connection leaked a password');
  await viewer.webContents.executeJavaScript("document.querySelector('.favorite-connect').click(); true", true);
  await wait(viewer, "document.querySelector('#remote-video').videoWidth > 0", 45000);
  await wait(viewer,"(()=>{const stage=document.querySelector('#video-stage'),video=document.querySelector('#remote-video');return Math.abs(stage.clientWidth/stage.clientHeight-video.videoWidth/video.videoHeight)<0.04})()");
  {smokeLog('Before manual resize '+JSON.stringify({bounds:viewer.getBounds(),sizing:states.get(viewer.webContents.id).videoSizing,ui:await viewer.webContents.executeJavaScript("({width:innerWidth,height:innerHeight,stage:[document.querySelector('#video-stage').clientWidth,document.querySelector('#video-stage').clientHeight]})")}));const bounds=viewer.getBounds();viewer.emit('will-resize',{preventDefault(){}},{...bounds,width:bounds.width-80},{edge:'right'});await delay(100);smokeLog('After manual resize '+JSON.stringify({bounds:viewer.getBounds(),sizing:states.get(viewer.webContents.id).videoSizing,ui:await viewer.webContents.executeJavaScript("({width:innerWidth,height:innerHeight,stage:[document.querySelector('#video-stage').clientWidth,document.querySelector('#video-stage').clientHeight]})")}));await wait(viewer,"(()=>{const s=document.querySelector('#video-stage'),v=document.querySelector('#remote-video');return Math.abs(s.clientWidth/s.clientHeight-v.videoWidth/v.videoHeight)<0.04})()");}
  const historyEntries=await viewer.webContents.executeJavaScript("api.connections('history')");if(!historyEntries.some(h=>h.address===credentials.id.replace(/\s/g,'')))throw new Error('Accepted connection was not added to history');
  await viewer.webContents.executeJavaScript(`api.connections('save',${JSON.stringify(historyEntries[0].id)}).then(renderFavorites)`);
  const hostState = states.get(host.webContents.id);
  await wait(host, "window.shatootconnectDiagnostics().role === 'host'");
  const overlayDeadline = Date.now() + 5000;
  while (hostState.overlay && !hostState.overlay.isVisible() && Date.now() < overlayDeadline) await delay(50);
  if (!hostState.overlay?.isAlwaysOnTop()) throw new Error(`Host overlay is not always on top: ${JSON.stringify({ exists: !!hostState.overlay, captureAllowed: hostState.captureAllowed, viewer: await viewer.webContents.executeJavaScript("document.querySelector('#remote-id').value"), hostId })}`);
  await delay(200);
  const overlayImage = await hostState.overlay.webContents.capturePage();
  const overlaySize = overlayImage.getSize(), overlayPixels = overlayImage.toBitmap();
  if (overlayPixels[(Math.floor(overlaySize.height / 2) * overlaySize.width + 6) * 4 + 3] >= 255) throw new Error('Host glass panel is opaque');
  fs.writeFileSync(path.join(__dirname, '../artifacts/glass-overlay.png'), overlayImage.toPNG());
  host.minimize(); await delay(200);
  if (!hostState.overlay.isVisible()) throw new Error('Host overlay disappeared when the app minimized');
  host.restore();
  await hostState.overlay.webContents.executeJavaScript("document.querySelector('#overlay-hide').click();true");await delay(100);
  if(hostState.overlay.isVisible()||!hostState.captureAllowed)throw new Error('Hiding the host panel disconnected the guest');
  await host.webContents.executeJavaScript("api.lifecycle('panels')");await delay(200);
  if(!hostState.overlay?.isVisible())throw new Error('Hidden host panel cannot be restored');
  await viewer.webContents.executeJavaScript("document.querySelector('#fullscreen').click(); true", true);
  await wait(viewer, "document.fullscreenElement?.id === 'session-panel'");
  await delay(300);
  fs.writeFileSync(path.join(__dirname, '../artifacts/video-fullscreen.png'), (await viewer.webContents.capturePage()).toPNG());
  viewer.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  viewer.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait(viewer, '!document.fullscreenElement');
  if (viewer.isFullScreen()) throw new Error('Native fullscreen remained after Escape');
  await delay(5000);
  const result = await viewer.webContents.executeJavaScript("window.shatootconnectDiagnostics()");
  if (result.connection !== 'connected' || result.framesDecoded <= 0 || result.width < 1) throw new Error('No decoded video frames');
  smokeLog(`baseline ${JSON.stringify(result)}`);
  smokeLog('Capture settings ' + JSON.stringify(await host.webContents.executeJavaScript('stream.getVideoTracks()[0].getSettings()')));
  await host.webContents.executeJavaScript("api.watchKeyboard(false)");
  await viewer.webContents.executeJavaScript("api.watchKeyboard(false)");
  await wait(host, "exchange?.channel.readyState === 'open'"); await wait(viewer, "exchange?.channel.readyState === 'open'");
  host.webContents.send('keyboard-layout', '00000409'); viewer.webContents.send('keyboard-layout', '00000409');
  await wait(host, "guestKeyboardLayout === '00000409' && layoutSync.clock > 0");
  host.webContents.send('keyboard-layout', '00000429');
  await wait(viewer, "guestKeyboardLayout === '00000429'");
  if (states.get(viewer.webContents.id).testAppliedLayout !== '00000429') throw new Error('Host keyboard did not synchronize to guest');
  viewer.webContents.send('keyboard-layout', '00000409');
  await wait(host, "guestKeyboardLayout === '00000409'");
  if (hostState.testAppliedLayout !== '00000409') throw new Error('Guest keyboard did not synchronize to host');
  smokeLog('Bidirectional layout protocol passed over actual RTC with isolated layout application');
  await require('../tests/collaboration-smoke.cjs')({ phase: 'id', host, viewer, states, wait, createWindow, log: smokeLog, artifacts: path.join(__dirname, '../artifacts') });
  {
    const previousDialog = dialog.showOpenDialog;
    try {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(__dirname,'ui/assets/app-icon.png')] });
      await host.webContents.executeJavaScript("document.querySelector('#open-settings').click();selectSettingsTab('profile');document.querySelector('#profile-photo').click();true");
      await wait(host,"config.avatar?.startsWith('data:image/png;base64,')");
      await host.webContents.executeJavaScript("document.querySelector('#profile-name').value='Smoke Host';document.querySelector('#profile-status').value='busy';document.querySelector('#profile-save').click();true");
      await wait(host,"config.name==='Smoke Host' && config.status==='busy'");
      if (!await host.webContents.executeJavaScript("[...document.querySelectorAll('#settings-dialog input,#settings-dialog button,#settings-dialog select')].filter(e=>e.getClientRects().length).every(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})")) throw new Error('New settings controls do not fit');
      fs.writeFileSync(path.join(__dirname,'../artifacts/profile-settings.png'),(await host.webContents.capturePage()).toPNG());
      await host.webContents.executeJavaScript("document.querySelector('#settings-dialog').close();true");
      smokeLog('Native profile photo normalization, persisted name/status and compact new settings tabs passed');
    } finally { dialog.showOpenDialog = previousDialog; }
  }
  await require('../tests/new-features-smoke.cjs')({ host, viewer, states, wait, createWindow, log: smokeLog, artifacts: path.join(__dirname, '../artifacts') });
  const queriesBeforeKeys = states.get(viewer.webContents.id).keyboardQueryCount || 0, inputsBeforeKeys = hostState.testInputPackets || 0;
  await viewer.webContents.executeJavaScript("(()=>{ for(let i=0;i<20;i++){sendGuestKey({type:'key',code:'KeyA',down:true});sendGuestKey({type:'key',code:'KeyA',down:false});} return keyboardQueue; })()");
  for (let i = 0; i < 30 && (hostState.testInputPackets || 0) < inputsBeforeKeys + 40; i++) await delay(50);
  if ((hostState.testInputPackets || 0) !== inputsBeforeKeys + 40 || (states.get(viewer.webContents.id).keyboardQueryCount || 0) !== queriesBeforeKeys) throw new Error('Cached keyboard fast path regressed');
  host.webContents.send('input-state',{type:'input-state',reason:'host'});
  host.webContents.send('host-cursor', { type: 'host-cursor', x: 0.3, y: 0.4, visible: true, physical:true });
  await wait(viewer, "!document.querySelector('#host-cursor').hidden");
  await viewer.webContents.executeJavaScript("config.showHostCursor=false; renderHostCursor(); true");
  if (!await viewer.webContents.executeJavaScript("document.querySelector('#host-cursor').hidden")) throw new Error('Cursor indicator setting failed');
  await viewer.webContents.executeJavaScript("config.showHostCursor=true; renderHostCursor(); true");
  host.webContents.send('input-state',{type:'input-state',reason:'ready'});
  await wait(viewer,"remoteInputReason==='ready'");
  smokeLog('40 RTC keyboard packets used zero layout-query IPC calls; cursor indicator toggled without moving the guest cursor');
  await host.webContents.executeJavaScript("api.exchange('clipboard-write','متن فارسی — WebRTC').then(()=>exchange.flushClipboard())");
  if (await viewer.webContents.executeJavaScript("api.exchange('clipboard-read').then(c=>c.text)") !== 'متن فارسی — WebRTC') throw new Error('RTC text clipboard did not arrive');
  const transferFixture = path.join(__dirname, '../artifacts/clipboard-فایل.bin'), transferBytes = crypto.randomBytes(250123); fs.writeFileSync(transferFixture, transferBytes);
  await nativeClipboard(hostState,{op:'write',files:[transferFixture]});
  await host.webContents.executeJavaScript('exchange.flushClipboard()');
  const virtualReceiver=states.get(viewer.webContents.id);
  if(!virtualReceiver.virtualOffer||virtualReceiver.clipboardTransfers?.completedEntries?.length)throw new Error('Copy eagerly downloaded files instead of advertising a virtual clipboard.');
  viewer.webContents.send('exchange-paste',{token:virtualReceiver.virtualOffer.token});
  for(let n=0;n<200&&!virtualReceiver.clipboardTransfers?.completedEntries?.length;n++)await delay(50);
  const pasted=virtualReceiver.clipboardTransfers?.completedEntries?.[0];if(!pasted||!fs.readFileSync(pasted).equals(transferBytes)||pasted.startsWith(app.getPath('downloads')+path.sep))throw new Error('Deferred RTC paste did not materialize intact bytes outside Downloads.');
  smokeLog('Copy advertised metadata only; native Paste event pulled exact RTC bytes into the private temporary cache.');
  await host.webContents.executeJavaScript(`exchange.sendFiles('sources', [${JSON.stringify(transferFixture)}])`);
  const receivedByViewer = states.get(viewer.webContents.id).testClipboard.files[0];
  if (!fs.readFileSync(receivedByViewer).equals(transferBytes)) throw new Error('RTC file contents did not match');
  await viewer.webContents.executeJavaScript("exchange.sendFiles('clipboard-sources')");
  if (!fs.readFileSync(hostState.testClipboard.files[0]).equals(transferBytes)) throw new Error('RTC reverse clipboard file did not match');
  smokeLog('Bidirectional real RTC text/file exchange passed (isolated simulated clipboard)');
  await host.webContents.executeJavaScript("exchange.close(); exchange=null; allowedControl=false; true");
  await viewer.webContents.executeJavaScript("exchange?.close(); exchange=null; allowedControl=false; true");
  await viewer.webContents.executeJavaScript("document.querySelector('#live-quality').value='economy'; document.querySelector('#live-quality').dispatchEvent(new Event('change')); true");
  await wait(viewer, "document.querySelector('#remote-video').videoWidth <= 1280 && document.querySelector('#remote-video').videoWidth > 0");
  await delay(2500);
  const economy = await viewer.webContents.executeJavaScript('window.shatootconnectDiagnostics()');
  smokeLog(`economy ${JSON.stringify(economy)}`);
  await viewer.webContents.executeJavaScript("document.querySelector('#live-quality').value='balanced'; document.querySelector('#live-quality').dispatchEvent(new Event('change')); true");
  await wait(host,"stream.getVideoTracks()[0].getConstraints().width.max===config.profiles.balanced.width");
  await wait(viewer, `document.querySelector('#remote-video').videoWidth >= ${Math.min(1281,result.videoWidth)}`);
  await delay(2000);
  fs.mkdirSync(path.join(__dirname, '../artifacts'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../artifacts/smoke-result.json'), JSON.stringify({ baseline: result, economy, restored: await viewer.webContents.executeJavaScript('window.shatootconnectDiagnostics()') }, null, 2));
  fs.writeFileSync(path.join(__dirname, '../artifacts/viewer.png'), (await viewer.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(__dirname, '../artifacts/host.png'), (await host.webContents.capturePage()).toPNG());
  console.log('SHATOOTCONNECT_SMOKE', JSON.stringify(result));
  await viewer.webContents.executeJavaScript("document.querySelector('#fullscreen').click(); true", true);
  await wait(viewer, "document.fullscreenElement?.id === 'session-panel'");
  await viewer.webContents.executeJavaScript("document.querySelector('#disconnect').click()");
  await wait(host, "window.shatootconnectDiagnostics().role === 'idle' && !window.shatootconnectDiagnostics().capturing");
  await wait(viewer, '!document.fullscreenElement');
  if (viewer.isFullScreen() || !viewer.isClosable()) throw new Error('Window stuck after disconnect');
  if (hostState.overlay && !hostState.overlay.isDestroyed()) throw new Error('Host overlay leaked after disconnect');
  if (await host.webContents.executeJavaScript("document.querySelector('#host-id').textContent") !== hostId) throw new Error('Session ended the host registration');
  host.webContents.reload();
  await wait(host, "!!window.shatootconnectReady && window.shatootconnectDiagnostics().registered");
  if (await host.webContents.executeJavaScript("document.querySelector('#host-id').textContent") !== hostId) throw new Error('Auto reconnect changed the device ID');
  smokeLog('Startup auto-registration, ID continuity, consent gate and language switching passed');
  viewer.webContents.send('connect-favorite', favorite.id);
  await wait(viewer, "document.querySelector('#remote-video').videoWidth > 0", 45000);
  await viewer.webContents.executeJavaScript("document.querySelector('#disconnect').click(); true");
  await wait(host, "window.shatootconnectDiagnostics().role === 'idle' && !window.shatootconnectDiagnostics().capturing");
  await wait(host, '!!window.shatootconnectDirect');
  const direct = await host.webContents.executeJavaScript('window.shatootconnectDirect');
  await localServer.close(); localServer = null;
  await wait(host, '!window.shatootconnectDiagnostics().registered');
  await wait(viewer, '!window.shatootconnectDiagnostics().registered');
  await viewer.webContents.executeJavaScript(`document.querySelector('#remote-id').value=${JSON.stringify('127.0.0.1:' + direct.port)};document.querySelector('#remote-password').value=${JSON.stringify(direct.password)};document.querySelector('#join').click(); true`, true);
  await wait(viewer, "document.querySelector('#remote-video').videoWidth > 0", 45000);
  await delay(2500);
  const lan = await viewer.webContents.executeJavaScript('window.shatootconnectDiagnostics()');
  if (lan.route !== 'direct' || lan.forceRelay || lan.iceUrls.length || lan.sessionRoute !== 'lan-viewer' || lan.framesDecoded < 1 || lan.registered) throw new Error('Serverless LAN video verification failed');
  console.log('SHATOOTCONNECT_LAN_SMOKE', JSON.stringify(lan));
  await wait(host,"exchange?.channel.readyState==='open'");await wait(viewer,"exchange?.channel.readyState==='open'");
  await viewer.webContents.executeJavaScript(`exchange.sendFiles('sources',[${JSON.stringify(transferFixture)}])`);
  if(!fs.readFileSync(hostState.testClipboard.files[0]).equals(transferBytes))throw new Error('Serverless LAN upload corrupted');
  await host.webContents.executeJavaScript("exchange.sendFiles('clipboard-sources')");
  if(!fs.readFileSync(states.get(viewer.webContents.id).testClipboard.files[0]).equals(transferBytes))throw new Error('Serverless LAN download corrupted');
  await viewer.webContents.executeJavaScript("sendGuestCursor({x:0.4,y:0.5,visible:true});true");
  await delay(100);
  if(hostState.guestCursor?.isVisible())throw new Error('Shared mouse duplicated the Windows pointer');
  hostState.sharedCursor=false;
  await viewer.webContents.executeJavaScript("sendGuestCursor({x:0.4,y:0.5,visible:true});true");
  for(let i=0;i<40 && !hostState.guestCursor?.isVisible();i++)await delay(50);
  if(!hostState.guestCursor?.isAlwaysOnTop() || !hostState.guestPointerData)throw new Error('Host cannot see the independent guest pointer');
  if(!await hostState.guestCursor.webContents.executeJavaScript("getComputedStyle(document.querySelector('#pointer')).display==='block'"))throw new Error('Guest pointer did not render on host');
  smokeLog('Natural serverless LAN file transfer in both directions and visible guest pointer passed');

  const lanOverlay = states.get(host.webContents.id).overlay;
  if (!lanOverlay || lanOverlay.isDestroyed()) throw new Error('LAN host overlay missing');
  await lanOverlay.webContents.executeJavaScript("document.querySelector('#overlay-disconnect').click(); true", true);
  await wait(viewer, "window.shatootconnectDiagnostics().role === 'idle'");
  await wait(host, "window.shatootconnectDiagnostics().role === 'idle' && !window.shatootconnectDiagnostics().capturing");
  if (!lanOverlay.isDestroyed()) throw new Error('Disconnect did not close the host overlay');
  smokeLog('Serverless direct IP video passed with central broker stopped and no STUN/TURN');
  await require('../tests/collaboration-smoke.cjs')({ phase: 'lan', host, viewer, states, wait, createWindow, log: smokeLog, artifacts: path.join(__dirname, '../artifacts') });
  const target = new BrowserWindow({ width: 380, height: 200, x: 80, y: 80, alwaysOnTop: true, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
  let coveringPanel;
  try {
    await target.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><style>body{margin:25px;background:#182431;color:white;font:16px sans-serif}button{padding:20px}</style><button onclick="window.clicks=(window.clicks||0)+1">Independent click test</button>'));
    target.show(); target.moveTop(); target.focus(); await delay(400);
    const point = await target.webContents.executeJavaScript('(()=>{const r=document.querySelector("button").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
    const content = target.getContentBounds();
    const physical = screen.dipToScreenPoint({ x: Math.round(content.x + point.x), y: Math.round(content.y + point.y) });
    coveringPanel = new BrowserWindow({ x: Math.round(content.x + point.x - 20), y: Math.round(content.y + point.y - 20), width: 120, height: 70, frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true, focusable: false, webPreferences: { sandbox: true, nodeIntegration: false } });
    coveringPanel.setContentProtection(true);
    await coveringPanel.loadURL('data:text/html,' + encodeURIComponent('<style>body{margin:0;height:100vh;background:rgba(15,40,50,.5)}</style>Protected overlay'));
    coveringPanel.showInactive(); await delay(150);
    const nativeHandle = coveringPanel.getNativeWindowHandle();
    const proc = spawn(path.join(__dirname, '../native/publish/ShatootConnect.Input.exe'), ['--verify-cursor'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = ''; proc.stdout.on('data', b => output += b); proc.stderr.on('data', b => errors += b);
    proc.stdin.end([{ type: 'bounds', x: physical.x, y: physical.y, width: 1, height: 1, sharedCursor: false }, { type: 'exclude-window', handle: nativeHandle.readBigUInt64LE().toString(16) }, { type: 'move', x: 0, y: 0 }, { type: 'button', button: 0, down: true, x: 0, y: 0 }, { type: 'button', button: 0, down: false, x: 0, y: 0 }].map(m => JSON.stringify(m)).join('\n') + '\n');
    const exit = await new Promise((resolve, reject) => { proc.once('exit', resolve); proc.once('error', reject); });
    smokeLog(`Cursor probe: ${JSON.stringify({ exit, output, errors })}`);
    await wait(target, 'window.clicks === 1', 5000);
    const cursorProbe=output.trim().split(/\r?\n/).map(line=>JSON.parse(line)).find(value=>Object.hasOwn(value,'cursorMovedByHelper'));
    if (exit !== 0 || errors || cursorProbe?.cursorMovedByHelper !== false) throw new Error('Independent Chromium click moved the cursor or was blocked');
    console.log('SHATOOTCONNECT_POINTER_SMOKE', output.trim());
  } finally { coveringPanel?.destroy(); target.destroy(); }
  await viewer.webContents.executeJavaScript(`window.shatootconnect.favoriteDelete(${JSON.stringify(favorite.id)})`);
  await host.webContents.executeJavaScript("window.shatootconnect.fixedPassword('')");
  app.quit();
}
