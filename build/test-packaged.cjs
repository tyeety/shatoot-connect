'use strict';
// Exercise the final portable launcher, not just win-unpacked or an updater fixture.
// NSIS targets share an archive cache: ZIP for the installer can otherwise reach
// the portable's 7z-only extractor when both targets are built in one invocation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (process.argv[2] === '--probe') {
  try {
    process.noAsar = true; // Hash the archive bytes, not Electron's virtual directory.
    const resources = path.join(path.dirname(process.execPath), 'resources');
    if (!process.versions.electron || !process.env.PORTABLE_EXECUTABLE_FILE || !fs.existsSync(path.join(resources, 'input/ShatootConnect.Input.exe'))) throw new Error('Portable did not launch the packaged Electron/native payload.');
    const chatIcon=path.join(resources,'chat-icon.ico');if(!fs.existsSync(chatIcon)||fs.readFileSync(chatIcon).readUInt16LE(2)!==1)throw Error('Packaged Windows chat taskbar icon is missing.');
    const nativeProbe=JSON.parse(execFileSync(path.join(resources,'input/ShatootConnect.Input.exe'),['--virtual-clipboard-self-test',__filename],{encoding:'utf8',windowsHide:true}));if(!nativeProbe.ok||!nativeProbe.deferred||!nativeProbe.clipboardUntouched)throw new Error('Packaged virtual clipboard probe failed.');
    fs.writeFileSync(process.argv[3], JSON.stringify({ virtualClipboard:nativeProbe,electron: process.versions.electron, archive: digest(path.join(resources, 'app.asar')) }));
  } catch(error) { fs.writeFileSync(process.argv[3], JSON.stringify({error:error.stack})); process.exitCode=1; }
} else {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
async function main() {
  const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
  const fileArg = process.argv.indexOf('--file');
  const executable = path.resolve(fileArg < 0 ? path.join(root, `release/ShatootConnect-${version}-win-x64.exe`) : process.argv[fileArg + 1]);
  const ui = process.argv.includes('--ui');
  if (ui && process.env.GITHUB_ACTIONS !== 'true') throw new Error('Packaged UI/startup integration requires the clean Windows GitHub runner; use test:smoke locally.');
  if (!fs.existsSync(executable)) throw new Error('Build the portable executable first.');
  const artifacts = path.join(root, 'artifacts'); fs.mkdirSync(artifacts, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(artifacts, 'package-launch-'));
  if (!path.resolve(fixture).startsWith(root + path.sep)) throw new Error('Fixture outside workspace.');
  let child;
  const launch = (args, env) => {
    const environment={...process.env,...env}; for(const name of Object.keys(environment))if(environment[name]===null)delete environment[name];
    child = spawn(executable, args, { windowsHide: true, stdio: ['ignore','pipe','pipe'], env: environment });
    const processChild=child; processChild.output='';
    for(const stream of [processChild.stdout,processChild.stderr])stream.on('data',data=>{processChild.output=(processChild.output+data.toString()).slice(-8000)});
    processChild.once('error', error => { processChild.launchError = error; });
    return child;
  };
  try {
    const marker = path.join(fixture, 'launched.json');
    launch([__filename, '--probe', marker], { ELECTRON_RUN_AS_NODE: '1' });
    await until(() => { if (child.launchError) throw child.launchError; return child.exitCode !== null; }, 90000);
    if (child.exitCode !== 0 || !fs.existsSync(marker)) throw new Error(`Portable launch failed (exit ${child.exitCode}): ${fs.existsSync(marker) ? fs.readFileSync(marker,'utf8') : 'Electron probe never started; check embedded ZIP/7z format.'}`);
    const probe = JSON.parse(fs.readFileSync(marker, 'utf8'));
    const source = path.join(root, 'release/win-unpacked/resources/app.asar');
    if (fs.existsSync(source) && probe.archive !== digest(source)) throw new Error('Extracted portable payload differs from win-unpacked.');
    console.log(`Final portable extracted and executed Electron ${probe.electron}; packaged ASAR SHA-256 verified.`);
    if (ui) {
      const profile = path.join(fixture, 'profile'); fs.mkdirSync(profile);
      fs.writeFileSync(path.join(profile, 'connection.json'), JSON.stringify({ internetEnabled: false, startupEnabled: false, language: 'en', profile: { name: 'Packaged launch test' } }));
      const updateToken=crypto.randomUUID();
      launch([`--update-token=${updateToken}`,`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1','--open-chat'], { ELECTRON_RUN_AS_NODE: null });
      const activePort = path.join(profile, 'DevToolsActivePort');
      await until(() => { if (child.launchError) throw child.launchError; if (child.exitCode !== null) throw new Error(`Packaged UI closed on startup (${child.exitCode}): ${child.output}`); return fs.existsSync(activePort); }, 90000);
      const port = fs.readFileSync(activePort, 'utf8').split('\n')[0];
      let target;
      await until(async () => { const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()); target = pages.find(p => p.url.endsWith('/ui/index.html')); return !!target; });
      const { WebSocket } = require('ws'), socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      let sequence = 0; const pending = new Map();
      socket.on('message', data => { const message = JSON.parse(data); if (pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(new Error(message.error.message)) : resolve(message.result); } });
      const evaluate = async expression => {
        const id = ++sequence;
        const result = await Promise.race([new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); }), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Packaged renderer did not respond.')), 15000); timer.unref(); })]);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      };
      try {
        await until(() => evaluate('window.shatootconnectReady === true'));
        if (!await evaluate(`window.shatootconnect.config().then(c => c.version === '${version}' && c.internetEnabled === false && c.startupEnabled === false && c.name === 'Packaged launch test')`)) throw new Error('Packaged UI did not load its isolated profile/version.');
        const ack=JSON.parse(fs.readFileSync(path.join(profile,'updates',updateToken+'.ready.json'),'utf8'));
        const launcher=JSON.parse(fs.readFileSync(path.join(profile,'launcher/launcher.json'),'utf8'));
        if(ack.token!==updateToken||ack.version!==version||path.resolve(ack.executable)!==executable||launcher.target!==executable||launcher.version!==version||!fs.existsSync(path.join(profile,'launcher/launcher.ico')))throw new Error('Packaged update-readiness acknowledgement/stable launcher did not match the final executable.');
        let chatTarget;await until(async()=>{const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());chatTarget=pages.find(p=>p.url.includes('/ui/index.html?chat=1'));return !!chatTarget;});
        const chatSocket=new WebSocket(chatTarget.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{chatSocket.once('open',resolve);chatSocket.once('error',reject);});
        try{let id=0;const chatReady=()=>new Promise((resolve,reject)=>{chatSocket.once('message',data=>{const reply=JSON.parse(data);if(reply.error||reply.result?.exceptionDetails)reject(Error('Packaged chat renderer failed'));else resolve(reply.result?.result?.value===true);});chatSocket.send(JSON.stringify({id:++id,method:'Runtime.evaluate',params:{expression:'window.shatootconnectChatReady===true',returnByValue:true}}));});await until(chatReady);}
        finally{chatSocket.close();}
        console.log('Final portable confirmed update readiness, registered its stable launcher/icon and opened chat from the taskbar launch command.');
        for (const language of ['en', 'fa']) {
          const errors = await evaluate(`(async()=>{
            window.i18n.setLanguage('${language}'); document.body.classList.add('viewing'); document.querySelector('#session-panel').hidden=false;
            for(const button of document.querySelectorAll('.session-toolbar button'))button.hidden=false;
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            const errors=[],expected=['privacy-screen','session-settings','open-received','send-files','fullscreen','disconnect'];
            if(document.querySelectorAll('.session-toolbar button:not([hidden])').length!==expected.length||expected.some(id=>!document.getElementById(id)||document.getElementById(id).hidden))errors.push('toolbar buttons missing');
            for(const button of document.querySelectorAll('.session-toolbar button:not([hidden])')){
              const icon=button.querySelector('.mi'),b=button.getBoundingClientRect(),i=icon.getBoundingClientRect();
              if(Math.abs(b.x+b.width/2-i.x-i.width/2)>.75 || Math.abs(b.y+b.height/2-i.y-i.height/2)>.75 || i.width<20 || i.height<20)errors.push(button.id+' off-center/small');
              if([...button.querySelectorAll('span:not(.mi)')].some(label=>label.getClientRects().length))errors.push(button.id+' hidden text occupies space');
              const mask=getComputedStyle(icon).maskImage, match=mask.match(/url\\(['"]?(.+?)['"]?\\)/);
              if(!match)errors.push(button.id+' missing mask');else{const image=new Image();image.src=match[1];try{await image.decode()}catch{errors.push(button.id+' SVG did not load')}}
            }
            return errors;
          })()`);
          if (errors.length) throw new Error(`${language} toolbar: ${errors.join(', ')}`);
        }
        console.log('Final portable UI opened with the correct version/profile; toolbar icon alignment and SVG loading passed in English and Persian.');
        await evaluate("window.shatootconnect.lifecycle('quit')");
        await until(() => child.exitCode !== null, 20000);
        if (child.exitCode !== 0) throw new Error('Packaged app did not exit cleanly.');
      } finally { socket.close(); }
    }
  } finally {
    if (child?.pid && child.exitCode === null) try { execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); } catch {}
    await until(() => !child?.pid || child.exitCode !== null, 10000).catch(() => {});
    fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
  }
}
async function until(check, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 150)); }
  throw new Error('Packaged launch test timed out.');
}
