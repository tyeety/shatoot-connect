'use strict';
window.installClientSettings = (config, profileChanged) => {
  const api = window.shatootconnect, $ = id => document.getElementById(id), tr = text => window.i18n.translate(text);
  const tabs = [
    ['profile', 'Profile and status', `<div class="profile-editor"><img id="profile-photo-preview" class="profile-avatar large" alt=""><div><button id="profile-photo" class="small-button">Choose photo</button> <button id="profile-photo-remove" class="small-button">Remove photo</button></div></div><label for="profile-name">Display name</label><input id="profile-name" maxlength="60"><label for="profile-status">Status</label><select id="profile-status"><option value="available">Available</option><option value="busy">Busy</option><option value="away">Away</option><option value="dnd">Do not disturb</option><option value="offline">Appear offline</option></select><button id="profile-save" class="small-button">Save profile</button><p class="footnote">This profile belongs to this device. Your name and status are visible to nearby computers.</p>`],
    ['chat', 'Chat and files', `<label class="pointer-setting"><input id="auto-accept-files" type="checkbox"><span>Accept incoming files automatically</span></label><p class="footnote">Files are saved to Downloads without opening them. Enable this only on trusted networks.</p><label class="pointer-setting"><input id="require-chat-approval" type="checkbox"><span>Ask before receiving ordinary messages</span></label><p class="footnote">Off by default. Chat never grants screen or keyboard access.</p>`],
    ['updates', 'Updates', `<p>Updates are checked automatically on GitHub. Installing an update restarts the app and keeps settings, saved computers and chat history.</p><p id="update-details" role="status"></p><div class="inline-setting"><button id="check-update" class="small-button">Check for updates</button><button id="install-update" class="small-button" hidden>Update and restart</button></div>`]
  ];
  for (const [id, title, content] of tabs) {
    const tab = document.createElement('button'); tab.id = `tab-${id}`; tab.dataset.settingsTab = id; tab.role = 'tab'; tab.setAttribute('aria-controls', `settings-${id}`); tab.setAttribute('aria-selected', 'false'); tab.tabIndex = -1; tab.textContent = tr(title); tab.onclick = () => selectSettingsTab(id); document.querySelector('.settings-tabs').append(tab);
    const page = document.createElement('section'); page.id = `settings-${id}`; page.role = 'tabpanel'; page.className = 'settings-page'; page.hidden = true; page.setAttribute('aria-labelledby', tab.id); page.innerHTML = content; $('settings-dialog').insertBefore(page, $('settings-status'));
  }
  const firewall = document.createElement('button'); firewall.id = 'repair-firewall'; firewall.className = 'small-button'; firewall.textContent = tr('Repair Windows Firewall access'); $('settings-lan').append(firewall);
  const firewallHint = document.createElement('p'); firewallHint.className = 'footnote'; firewallHint.textContent = tr('Requests Windows administrator permission. Allows this app on private and domain LAN networks; you can retry after cancelling.'); $('settings-lan').append(firewallHint);
  const run = fn => async () => { try { await fn(); } catch (error) { $('settings-status').textContent = tr(error.message); } };
  firewall.onclick = run(async () => { firewall.disabled = true; try { await api.repairFirewall(); $('settings-status').textContent = tr('Firewall access repaired.'); } finally { firewall.disabled = false; } });
  function showProfile() { $('profile-name').value = config.name; $('profile-status').value = config.status; $('profile-photo-preview').src = config.avatar || 'assets/app-icon.png'; }
  async function acceptProfile(next) { Object.assign(config, next); showProfile(); await profileChanged(next); }
  $('profile-photo').onclick = run(async () => acceptProfile(await api.profilePhoto(false)));
  $('profile-photo-remove').onclick = run(async () => acceptProfile(await api.profilePhoto(true)));
  $('profile-save').onclick = run(async () => acceptProfile(await api.profileSave({ name: $('profile-name').value, status: $('profile-status').value })));
  $('auto-accept-files').checked = config.autoAcceptFiles; $('require-chat-approval').checked = config.requireChatApproval;
  for (const id of ['auto-accept-files','require-chat-approval']) $(id).onchange = run(async () => { const result = await api.chatPreferences({ autoAcceptFiles: $('auto-accept-files').checked, requireChatApproval: $('require-chat-approval').checked }); Object.assign(config,result); });
  const notice = document.createElement('button'); notice.id = 'update-notice'; notice.className = 'small-button'; notice.hidden = true; document.querySelector('main>header').append(notice);
  function update(value) {
    const messages = { idle: 'Check for updates', checking: 'Checking for updates…', current: 'You are using the latest version.', available: 'Update available', downloading: 'Downloading update…', ready: 'Update ready', installing: 'Installing update…', error: value.error };
    $('update-details').textContent = tr(messages[value.state] || value.state) + (value.version ? ` · ${value.version}` : '') + (value.state === 'downloading' ? ` ${value.percent}%` : '');
    $('check-update').disabled = ['checking','downloading','installing'].includes(value.state);
    $('install-update').hidden = !['available','ready'].includes(value.state); notice.hidden = $('install-update').hidden; notice.textContent = tr('Update and restart') + ' · ' + (value.version || '');
  }
  $('check-update').onclick = run(async () => update(await api.update('check')));
  const install = run(async () => { $('install-update').disabled = true; notice.disabled = true; try { await api.update('install'); } finally { $('install-update').disabled = false; notice.disabled = false; } });
  $('install-update').onclick = install; notice.onclick = install; api.onUpdate(update); api.update('status').then(update); showProfile(); window.i18n.setLanguage(config.language);
};
