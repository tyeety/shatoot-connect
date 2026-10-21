const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { newer, assetFor, Updater } = require('../desktop/updater.cjs');
const { profile } = require('../shared/profile.cjs');
function release(bytes, portable = false) { const name = `ShatootConnect-${portable ? '' : 'Setup-'}0.11.0-win-x64.exe`; return { tag_name: 'v0.11.0', assets: [{ name, state: 'uploaded', size: bytes.length, digest: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`, browser_download_url: `https://github.com/tyeety/shatoot-connect/releases/download/v0.11.0/${name}` }] }; }
test('updates accept newer stable versions and only exact official assets with a SHA256 digest', () => {
  assert.equal(newer('0.11.0','0.10.9'),true); assert.equal(newer('0.11.0-beta','0.10.9'),false); assert.equal(newer('0.9.9','0.10.0'),false);
  const value = release(Buffer.alloc(1024)); assert.equal(assetFor(value,'0.10.0',false).version,'0.11.0');
  assert.equal(assetFor({...value,prerelease:true},'0.10.0',false),null); assert.equal(assetFor(value,'0.11.0',false),null);
  assert.throws(() => assetFor(value,'0.10.0',true)); value.assets[0].browser_download_url = 'https://example.com/update.exe'; assert.throws(() => assetFor(value,'0.10.0',false));
});
test('download checks bytes and digest, deletes corrupt partials and never touches the existing profile', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shatoot-update-')); t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const userProfile=path.join(dir,'connection.json'); fs.writeFileSync(userProfile,'preserve-settings-and-history');
  const bytes=crypto.randomBytes(10000), metadata=release(bytes); let corrupted=false;
  const updater=new Updater({version:'0.10.0',directory:path.join(dir,'updates'),portable:false,request: async url => Readable.from([url.includes('/latest') ? JSON.stringify(metadata) : corrupted ? Buffer.alloc(bytes.length) : bytes])});
  assert.equal((await updater.check()).state,'available'); await updater.download(); assert.deepEqual(fs.readFileSync(updater.file),bytes);
  corrupted=true; await assert.rejects(updater.download(),/integrity/); assert.equal(fs.existsSync(updater.file+'.partial'),false); assert.deepEqual(fs.readFileSync(updater.file),bytes); assert.equal(fs.readFileSync(userProfile,'utf8'),'preserve-settings-and-history');
});
test('profile metadata rejects active content, foreign URLs and oversized avatars', () => {
  assert.equal(profile({avatar:'https://example.com/pixel',status:'bad'}).avatar,''); assert.equal(profile({avatar:'data:image/svg+xml;base64,PHN2Zz4='}).avatar,'');
  assert.equal(profile({avatar:'data:image/png;base64,'+'A'.repeat(24000)}).avatar,''); assert.equal(profile({name:'  Desk  ',status:'busy'}).name,'Desk');
});
