const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
class IdentityStore {
  constructor(filename) {
    this.filename = filename;
    this.records = filename && fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {};
  }
  register(deviceId, secret) {
    if (!/^[a-f0-9-]{36}$/i.test(deviceId || '') || !/^[A-Za-z0-9_-]{43}$/.test(secret || '')) throw new Error('Invalid device identity.');
    const hash = crypto.createHash('sha256').update(secret).digest('hex');
    const existing = this.records[deviceId];
    if (existing) {
      if (existing.hash !== hash) throw new Error('Device identity could not be verified.');
      return existing.id;
    }
    if (Object.keys(this.records).length >= 10000) throw new Error('Device registry capacity reached.');
    let id; const used = new Set(Object.values(this.records).map(r => r.id));
    do { id = String(crypto.randomInt(100000000, 1000000000)); } while (used.has(id));
    this.records[deviceId] = { id, hash };
    if (this.filename) {
      fs.mkdirSync(path.dirname(this.filename), { recursive: true });
      const temp = this.filename + '.tmp'; fs.writeFileSync(temp, JSON.stringify(this.records), { mode: 0o600 }); fs.renameSync(temp, this.filename);
    }
    return id;
  }
}
module.exports = { IdentityStore };
