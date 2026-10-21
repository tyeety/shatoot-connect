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
    return { ...record, password: this.decrypt(record.password), serverKey: record.serverKey ? this.decrypt(record.serverKey) : '' };
  }
  save(value) {
    const { name, address, password, serverKey = '' } = value || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 60 || typeof address !== 'string' || typeof password !== 'string' || !password || password.length > 128 || typeof serverKey !== 'string' || serverKey.length > 256) throw new Error('Enter a name, valid remote address and password.');
    const target = address.replace(/\s/g, '');
    const direct = !/^\d{9}$/.test(target);
    const endpoint = direct ? (this.validateDirect(target), '') : this.validateEndpoint(value.endpoint);
    const favorites = this.read().favorites || [];
    const existing = favorites.find(record => record.address === target && record.endpoint === endpoint);
    if (!existing && favorites.length >= 100) throw new Error('You can save up to 100 connections.');
    const record = { id: existing?.id || crypto.randomUUID(), name: name.trim(), address: target, endpoint, password: this.encrypt(password), serverKey: !direct && serverKey ? this.encrypt(serverKey) : null, shortcut: existing?.shortcut || false, shortcutFile: existing?.shortcutFile || null };
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
