'use strict';
window.installClientSettings = (config, profileChanged) => {
  const api = window.shatootconnect, $ = id => document.getElementById(id), tr = text => window.i18n.translate(text);
  const tabs = [
    ['general','Application',`<label class="pointer-setting"><input id="remember-passwords" type="checkbox"><span>Remember the last password for each computer</span></label><p class="footnote">Turning this off deletes remembered passwords. Explicitly saved computers keep their own credentials.</p><label class="pointer-setting"><input id="startup-enabled" type="checkbox"><span>Start with Windows in the tray</span></label><div class="inline-setting"><button id="clear-history" class="small-button">Clear connection history</button><button id="show-panels" class="small-button">Show connection panels</button></div><button id="quit-app" class="small-button stop">Quit completely</button>`],
    ['profile', 'Profile and status', `<div class="profile-editor"><img id="profile-photo-preview" class="profile-avatar large" alt=""><div><button id="profile-photo" class="small-button">Choose photo</button> <button id="profile-photo-remove" class="small-button">Remove photo</button></div></div><label for="profile-name">Display name</label><input id="profile-name" maxlength="60"><label for="profile-status">Status</label><select id="profile-status"><option value="available">Available</option><option value="busy">Busy</option><option value="away">Away</option><option value="dnd">Do not disturb</option><option value="offline">Appear offline</option></select><button id="profile-save" class="small-button">Save profile</button>`],
    ['chat', 'Chat and files', `<label class="pointer-setting"><input id="auto-accept-files" type="checkbox"><span>Ask before receiving files</span></label><label class="pointer-setting"><input id="require-chat-approval" type="checkbox"><span>Ask before receiving ordinary messages</span></label>`],
    ['updates', 'Updates', `<p>Updates are checked automatically on GitHub. Installing an update restarts the app and keeps settings, saved computers and chat history.</p><p id="update-details" role="status"></p><div class="inline-setting"><button id="check-update" class="small-button">Check for updates</button><button id="install-update" class="small-button" hidden>Update and restart</button></div>`]
  ];
  for (const [id, title, content] of tabs) {
    const tab = document.createElement('button'); tab.id = `tab-${id}`; tab.dataset.settingsTab = id; tab.role = 'tab'; tab.setAttribute('aria-controls', `settings-${id}`); tab.setAttribute('aria-selected', 'false'); tab.tabIndex = -1; tab.textContent = tr(title); tab.onclick = () => selectSettingsTab(id); document.querySelector('.settings-tabs').append(tab);
    const page = document.createElement('section'); page.id = `settings-${id}`; page.role = 'tabpanel'; page.className = 'settings-page'; page.hidden = true; page.setAttribute('aria-labelledby', tab.id); page.innerHTML = content; $('settings-dialog').insertBefore(page, $('settings-status'));
  }
  const firewall = document.createElement('button'); firewall.id = 'repair-firewall'; firewall.className = 'small-button'; firewall.textContent = tr('Repair Windows Firewall access'); $('settings-lan').append(firewall);
  const firewallHint = document.createElement('p'); firewallHint.className = 'footnote'; firewallHint.textContent = tr('Requests Windows administrator permission. Allows this app on private and domain LAN networks; you can retry after cancelling.'); $('settings-lan').append(firewallHint);
  const run = fn => async event => { const control=event?.currentTarget;try { await window.withActionFeedback(control,fn); } catch (error) { $('settings-status').textContent = tr(error.message);window.actionNotice?.(error.message); } };
  $('remember-passwords').checked=config.rememberPasswords;$('startup-enabled').checked=config.startupEnabled;
  $('remember-passwords').onchange=run(async()=>{config.rememberPasswords=await api.connections('remember',$('remember-passwords').checked);if(!config.rememberPasswords)document.getElementById('remote-password').value='';});
  $('startup-enabled').onchange=run(async()=>{config.startupEnabled=await api.lifecycle('startup',$('startup-enabled').checked);});
  $('clear-history').onclick=run(async()=>renderHistory(await api.connections('clear')));$('show-panels').onclick=run(()=>api.lifecycle('panels'));$('quit-app').onclick=()=>api.lifecycle('quit');
  let checkingFirewall=false;const firewallReadyAt=Date.now()+15000;
  const refreshFirewall=async(force=false)=>{if(checkingFirewall||!force&&Date.now()<firewallReadyAt)return;checkingFirewall=true;try{const value=await api.firewallStatus(force);$('allow-firewall').hidden=value.needsRepair!==true;}catch{$('allow-firewall').hidden=true;}finally{checkingFirewall=false;}};
  window.refreshFirewallAction=()=>refreshFirewall(true);setTimeout(()=>refreshFirewall(),15000);setInterval(()=>refreshFirewall(),60000);window.addEventListener('focus',()=>refreshFirewall());
  const allowFirewall=async()=>{const controls=[firewall,$('allow-firewall')];for(const button of controls)button.disabled=true;try{await api.repairFirewall();$('settings-status').textContent=tr('Firewall access repaired.');window.actionNotice('Firewall access repaired.');window.messenger?.renderDiscovery(await api.discovery());}finally{for(const button of controls)button.disabled=false;await refreshFirewall(true);}};
  firewall.onclick=run(allowFirewall);$('allow-firewall').onclick=run(allowFirewall);
  function showProfile() { $('profile-name').value = config.name; $('profile-status').value = config.status; $('profile-photo-preview').src = config.avatar || 'assets/app-icon.png'; }
  async function acceptProfile(next) { Object.assign(config, next); showProfile(); await profileChanged(next); }
  $('profile-photo').onclick = run(async () => acceptProfile(await api.profilePhoto(false)));
  $('profile-photo-remove').onclick = run(async () => acceptProfile(await api.profilePhoto(true)));
  $('profile-save').onclick = run(async () => {await acceptProfile(await api.profileSave({ name: $('profile-name').value, status: $('profile-status').value }));$('settings-status').textContent=tr('Profile saved.');window.actionNotice('Profile saved.');});
  $('auto-accept-files').checked = !config.autoAcceptFiles; $('require-chat-approval').checked = config.requireChatApproval;
  for (const id of ['auto-accept-files','require-chat-approval']) $(id).onchange = run(async () => { const result = await api.chatPreferences({ autoAcceptFiles: !$('auto-accept-files').checked, requireChatApproval: $('require-chat-approval').checked }); Object.assign(config,result); });
  const notice = document.createElement('button'); notice.id = 'update-notice'; notice.className = 'small-button'; notice.hidden = true; document.querySelector('main>header').append(notice);
  let lastUpdate;
  function updateButton(button,label,value) {
    let text=button.querySelector('.update-label'),percent=button.querySelector('.update-percent');
    if(!text){text=document.createElement('span');text.className='update-label';percent=document.createElement('span');percent.className='update-percent';percent.dir='ltr';button.replaceChildren(text,percent);}
    const downloading=value.state==='downloading',amount=Math.max(0,Math.min(100,Math.floor(Number(value.percent)||0)));
    text.textContent=tr(label)+(button===notice&&!['downloading','installing'].includes(value.state)&&value.version?` · ${value.version}`:'');percent.hidden=!downloading;percent.textContent=downloading?`${amount}%`:'';
    button.classList.toggle('update-downloading',downloading);button.title=text.textContent+(downloading?` ${amount}%`:'');button.setAttribute('aria-label',button.title);
  }
  function update(value) {
    lastUpdate=value;
    const messages = { idle: 'Check for updates', checking: 'Checking for updates…', current: 'You are using the latest version.', available: 'Update available', downloading: 'Downloading update…', ready: 'Update ready', installing: 'Installing update…', error: value.error };
    const busy=['checking','downloading','installing'].includes(value.state),amount=Math.max(0,Math.min(100,Math.floor(Number(value.percent)||0)));
    $('update-details').textContent = tr(messages[value.state] || value.state) + (value.version ? ` · ${value.version}` : '') + (value.state === 'downloading' ? ` ${amount}%` : '');
    $('check-update').disabled=busy;
    $('install-update').hidden=!(['available','ready','downloading','installing'].includes(value.state)||(value.state==='error'&&value.version&&value.version!==config.version));notice.hidden=$('install-update').hidden;
    const label=['downloading','installing'].includes(value.state)?messages[value.state]:'Update and restart';
    updateButton($('install-update'),label,value);updateButton(notice,label,value);
    if(value.version&&!notice.title.includes(` · ${value.version}`))notice.title+=` · ${value.version}`;
    if(value.state==='error')window.actionNotice?.(value.error);
    notice.disabled=['downloading','installing'].includes(value.state);$('install-update').disabled=notice.disabled;
  }
  window.addEventListener('shatoot-language-change',()=>{if(lastUpdate)update(lastUpdate);});
  $('check-update').onclick = run(async () => update(await api.update('check')));
  const install = run(async () => { $('install-update').disabled = true; notice.disabled = true; try { window.actionNotice?.('Downloading update…');await api.update('install'); } finally { $('install-update').disabled = false; notice.disabled = false; } });
  $('install-update').onclick = install; notice.onclick = install; api.onUpdate(update); api.update('status').then(update); showProfile(); window.i18n.setLanguage(config.language);
  const enterTargets={'remote-id':'join','remote-password':'join','server-url':'connect-server','server-key':'connect-server','fixed-password':'save-fixed-password','profile-name':'profile-save'};
  document.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&enterTargets[event.target.id]){event.preventDefault();const button=$(enterTargets[event.target.id]);if(button&&!button.disabled)button.click();}});
};
