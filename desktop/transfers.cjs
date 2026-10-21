const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const LIMIT = 10 * 1024 ** 3, CHUNK = 32768;
function safeRelative(value) {
  if (typeof value !== 'string' || value.length > 2000 || !value || value.split('/').some(part => !part || part === '.' || part === '..' || /[<>:"\\|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Invalid file name.');
  return value;
}
class Transfers {
  constructor(root) { this.root = root; this.sources = new Map(); this.incoming = null; this.completed = []; }
  async offer(paths) {
    if (!Array.isArray(paths) || !paths.length || paths.length > 1000) throw new Error('Select up to 1000 files or folders.');
    const entries = [], names = new Set(); let total = 0;
    const visit = async (file, relative) => {
      safeRelative(relative); const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) throw new Error('Symbolic links are not transferred.');
      if (stat.isDirectory()) { const children = await fs.readdir(file); if (!children.length) entries.push({ name: relative, directory: true, size: 0 }); else for (const child of children) await visit(path.join(file, child), relative + '/' + child); }
      else if (stat.isFile()) { total += stat.size; const id = crypto.randomUUID(); entries.push({ id, name: relative, size: stat.size }); this.sources.set(id, { file, size: stat.size, mtime: stat.mtimeMs }); }
      else throw new Error('Only regular files and folders can be transferred.');
      if (entries.length > 1000 || total > LIMIT) throw new Error('Transfer limit: 1000 files and 10 GB.');
    };
    // A new local selection replaces old grants; the peer never chooses source paths.
    this.sources.clear();
    try { for (const file of paths) { const name = path.basename(file); if (names.has(name.toLowerCase())) throw new Error('Select files with distinct top-level names.'); names.add(name.toLowerCase()); await visit(file, name); } }
    catch (e) { this.sources.clear(); throw e; }
    return entries;
  }
  async read({ id, offset }) {
    const grant = this.sources.get(id);
    if (!grant || !Number.isSafeInteger(offset) || offset < 0 || offset > grant.size) throw new Error('Invalid file read.');
    const stat = await fs.lstat(grant.file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== grant.size || stat.mtimeMs !== grant.mtime) throw new Error('The source file changed.');
    if (!offset) { grant.hash = crypto.createHash('sha256'); grant.offset = 0; }
    if (offset !== grant.offset) throw new Error('Out of order file read.');
    const handle = await fs.open(grant.file, 'r');
    try { const buffer = Buffer.alloc(Math.min(CHUNK, grant.size - offset)); const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset); const bytes = buffer.subarray(0, bytesRead); grant.hash.update(bytes); grant.offset += bytesRead; return { bytes: bytes.toString('base64'), length: bytesRead, hash: grant.offset === grant.size ? grant.hash.digest('hex') : null }; }
    finally { await handle.close(); }
  }
  async begin(entries) {
    if (this.incoming) throw new Error('A file transfer is already in progress.');
    if (!Array.isArray(entries) || !entries.length || entries.length > 1000) throw new Error('Invalid transfer list.');
    let total = 0; const names = new Set();
    for (const e of entries) { safeRelative(e.name); if (!Number.isSafeInteger(e.size) || e.size < 0 || (e.directory && e.size)) throw new Error('Invalid file size.'); total += e.size; const name = e.name.toLowerCase(); if (names.has(name) || [...names].some(n => n.startsWith(name + '/') || name.startsWith(n + '/'))) throw new Error('Duplicate or conflicting file names.'); names.add(name); }
    if (total > LIMIT) throw new Error('Transfer limit: 10 GB.');
    await fs.mkdir(this.root, { recursive: true });
    const folder = await fs.mkdtemp(path.join(this.root, 'Receive-'));
    let parts; try { parts = await fs.mkdtemp(path.join(this.root, '.parts-')); } catch (error) { await fs.rmdir(folder); throw error; }
    this.incoming = { folder, parts, entries, index: 0, offset: 0, hash: crypto.createHash('sha256'), handle: null };
    return true;
  }
  async write({ index, offset, bytes }) {
    const s = this.incoming, e = s?.entries[index];
    if (!s || !e || index !== s.index || e.directory || offset !== s.offset || typeof bytes !== 'string' || bytes.length > 43692 || !/^[A-Za-z0-9+/]*={0,2}$/.test(bytes)) throw new Error('Invalid file chunk.');
    const data = Buffer.from(bytes, 'base64'); if (!data.length || data.length > CHUNK || s.offset + data.length > e.size) throw new Error('Invalid file chunk size.');
    if (!s.handle) s.handle = await fs.open(path.join(s.parts, String(index)), 'wx');
    let written = 0; while (written < data.length) { const result = await s.handle.write(data, written, data.length - written); if (!result.bytesWritten) throw new Error('Disk write failed.'); written += result.bytesWritten; }
    s.hash.update(data); s.offset += data.length;
  }
  async endFile({ index, hash }) {
    const s = this.incoming, e = s?.entries[index]; if (!s || !e || index !== s.index || s.offset !== e.size || (hash !== s.hash.digest('hex'))) throw new Error('File integrity check failed.');
    const file = path.join(s.folder, ...e.name.split('/'));
    if (e.directory) await fs.mkdir(file, { recursive: true });
    else { await fs.mkdir(path.dirname(file), { recursive: true }); const part = path.join(s.parts, String(index)); if (s.handle) { await s.handle.sync(); await s.handle.close(); s.handle = null; } else await fs.writeFile(part, '', { flag: 'wx' }); await fs.rename(part, file); }
    s.index++; s.offset = 0; s.hash = crypto.createHash('sha256');
  }
  async finish() {
    const s = this.incoming; if (!s || s.index !== s.entries.length) throw new Error('Incomplete transfer.');
    await fs.rmdir(s.parts); this.completed = [...new Set(s.entries.map(e => path.join(s.folder, e.name.split('/')[0])))]; this.incoming = null; return this.completed;
  }
  async abort() { const s = this.incoming; this.incoming = null; if (s?.handle) await s.handle.close().catch(() => {}); if (s) { await fs.rm(s.parts, { recursive: true, force: true }); await fs.rm(s.folder, { recursive: true, force: true }); } }
  async reset() { this.sources.clear(); this.completed = []; await this.abort(); }
}
module.exports = { Transfers, safeRelative };
