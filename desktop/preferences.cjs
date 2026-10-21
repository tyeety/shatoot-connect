const crypto = require('node:crypto');
class ClientPreferences {
  constructor({ read, write, encrypt, decrypt, validateEndpoint, validateDirect }) { Object.assign(this, { read, write, encrypt, decrypt, validateEndpoint, validateDirect }); }
  fixedPassword() { const value = this.read().fixedPassword; return value ? this.decrypt(value) : ''; }
  unattended() { return this.read().unattended === true && !!this.fixedPassword(); }
  canAutoApprove(fixedPasswordAuthenticated) { return fixedPasswordAuthenticated === true && this.unattended(); }
  setUnattended(enabled) {
    if (typeof enabled !== 'boolean' || (enabled && !this.fixedPassword())) throw new Error('Save a fixed password before enabling unattended access.');
    this.write({ unattended: enabled }); return enabled;
  }
  setFixedPassword(value) {
    if (typeof value !== 'string' || (value.length && value.length < 8) || value.length > 128) throw new Error('Use 8 to 128 characters, or leave empty for random passwords.');
    this.write({ fixedPassword: value ? this.encrypt(value) : null, ...(value ? {} : { unattended: false }) }); return value;
  }
  list() { return (this.read().favorites || []).map(({ id, name, address, endpoint, shortcut }) => ({ id, name, address, endpoint, shortcut: !!shortcut })); }
  get(id) {
    const record = (this.read().favorites || []).find(record => record.id === id);
    if (!record) throw new Error('Saved connection not found.');
    return { ...record, password: record.password ? this.decrypt(record.password) : '', serverKey: record.serverKey ? this.decrypt(record.serverKey) : '' };
  }
  destination(value) {
    if (typeof value?.address !== 'string' || !value.address.trim()) throw new Error('Enter a remote ID or LAN IP first.');
    const address = value.address.replace(/\s/g,''), direct = !/^\d{9}$/.test(address);
    const endpoint = direct ? (this.validateDirect(address), '') : this.validateEndpoint(value.endpoint);
    const canonical = direct ? address.replace(/:8788$/,'') : address;
    return { address, endpoint, key: JSON.stringify([canonical,endpoint]) };
  }
  remember(enabled) { if (typeof enabled !== 'boolean') throw new Error('Invalid password preference.'); this.write({rememberPasswords:enabled,...(!enabled?{connectionPasswords:{}}:{})}); return enabled; }
  recall(value) { const {key}=this.destination(value); const encrypted=this.read().rememberPasswords !== false && this.read().connectionPasswords?.[key]; return encrypted ? this.decrypt(encrypted) : ''; }
  attempt(value) {
    const target=this.destination(value), password=value.password;
    if (typeof password !== 'string' || password.length>128) throw new Error('Invalid connection password.');
    if (this.read().rememberPasswords === false || !password) return;
    const cache={...(this.read().connectionPasswords||{})}; delete cache[target.key]; cache[target.key]=this.encrypt(password);
    for(const key of Object.keys(cache).slice(0,Math.max(0,Object.keys(cache).length-200)))delete cache[key];
    this.write({connectionPasswords:cache});
  }
  history() { return (this.read().connectionHistory||[]).map(({id,address,endpoint,name,at,count})=>({id,address,endpoint,name,at,count})); }
  connected(value) {
    const target=this.destination(value), history=this.read().connectionHistory||[], previous=history.find(h=>h.key===target.key);
    const record={...target,id:previous?.id||crypto.randomUUID(),name:String(value.name||previous?.name||target.address).slice(0,60),at:Date.now(),count:(previous?.count||0)+1};
    this.write({connectionHistory:[record,...history.filter(h=>h.key!==target.key)].slice(0,200)}); return this.history();
  }
  saveHistory(id) { const h=this.history().find(h=>h.id===id); if(!h)throw new Error('Connection history entry not found.');return this.save({...h,password:this.recall(h)}); }
  clearHistory() { this.write({connectionHistory:[]}); return []; }
  save(value) {
    const { password = '', serverKey = '' } = value || {};
    const {address:target,endpoint}=this.destination(value);
    if(value.name!=null&&typeof value.name!=='string')throw new Error('Enter a valid computer name and password.');
    const name=value.name?.trim()||target;
    if (typeof name !== 'string' || name.length > 60 || typeof password !== 'string' || password.length > 128 || typeof serverKey !== 'string' || serverKey.length > 256) throw new Error('Enter a valid computer name and password.');
    const direct=!endpoint;
    const favorites = this.read().favorites || [];
    const existing = favorites.find(record => record.address === target && record.endpoint === endpoint);
    if (!existing && favorites.length >= 100) throw new Error('You can save up to 100 connections.');
    const record = { id: existing?.id || crypto.randomUUID(), name, address: target, endpoint, password: password ? this.encrypt(password) : existing?.password || null, serverKey: !direct && serverKey ? this.encrypt(serverKey) : existing?.serverKey || null, shortcut: existing?.shortcut || false, shortcutFile: existing?.shortcutFile || null };
    this.write({ favorites: [...favorites.filter(item => item.id !== record.id), record] }); return record.id;
  }
  remove(id) { this.get(id); this.write({ favorites: (this.read().favorites || []).filter(record => record.id !== id) }); }
  markShortcut(id) { const filename = this.shortcutName(id); this.write({ favorites: (this.read().favorites || []).map(record => record.id === id ? { ...record, shortcut: true, shortcutFile: filename } : record) }); }
  shortcutName(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid connection ID.');
    const record = (this.read().favorites || []).find(item => item.id === id); if (!record) throw new Error('Saved connection not found.');
    if (record.shortcutFile && !/[<>:"/\\|?*\x00-\x1f]/.test(record.shortcutFile) && record.shortcutFile.startsWith('Shatoot Connect - ') && record.shortcutFile.endsWith(`(${id.slice(0, 8)}).lnk`)) return record.shortcutFile;
    const name = record.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').slice(0, 60) || 'Computer';
    return `Shatoot Connect - ${name} (${id.slice(0, 8)}).lnk`;
  }
}
module.exports = { ClientPreferences };
