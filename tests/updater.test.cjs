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
  const updater=new Updater({version:'0.10.0',directory:path.join(dir,'updates'),portable:false,request: async url => Readable.from([url.includes('/releases?') ? JSON.stringify([metadata]) : corrupted ? Buffer.alloc(bytes.length) : bytes])});
  assert.equal((await updater.check()).state,'available'); await updater.download(); assert.deepEqual(fs.readFileSync(updater.file),bytes);
  corrupted=true; await assert.rejects(updater.download(),/integrity/); assert.equal(fs.existsSync(updater.file+'.partial'),false); assert.deepEqual(fs.readFileSync(updater.file),bytes); assert.equal(fs.readFileSync(userProfile,'utf8'),'preserve-settings-and-history');
});
test('install rechecks highest stable release before and after download and refuses incomplete newer releases',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shatoot-latest-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const bytes=Buffer.alloc(2048,7),first=release(bytes),next=JSON.parse(JSON.stringify(first).replaceAll('0.11.0','0.12.0'));let releases=[first],downloads=[];
  const updater=new Updater({version:'0.10.0',directory:dir,portable:false,request:async url=>{if(url.includes('/releases?'))return Readable.from([JSON.stringify(releases)]);downloads.push(url);if(url.includes('0.12.0'))releases=[first,next,{...next,tag_name:'v9.0.0',prerelease:true}];return Readable.from([bytes]);}});
  await updater.check();releases=[first,next];await updater.prepare();assert.equal(updater.asset.version,'0.12.0');assert.equal(downloads.length,1);assert.match(downloads[0],/0.12.0/);
  await updater.prepare();assert.equal(downloads.length,1,'Reuse only a verified current package');
  releases=[first,{...next,assets:[]}];await assert.rejects(updater.prepare(),/verified compatible/);
});
test('release published during download replaces the earlier package before installation',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shatoot-mid-update-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const bytes=Buffer.alloc(2048),first=release(bytes),next=JSON.parse(JSON.stringify(first).replaceAll('0.11.0','0.13.0'));let releases=[first],count=0;
  const updater=new Updater({version:'0.10.0',directory:dir,portable:false,request:async url=>{if(url.includes('/releases?'))return Readable.from([JSON.stringify(releases)]);count++;releases=[next,first];return Readable.from([bytes]);}});
  await updater.prepare();assert.equal(count,2);assert.equal(updater.asset.version,'0.13.0');assert.match(updater.file,/0.13.0/);
});
test('profile metadata rejects active content, foreign URLs and oversized avatars', () => {
  assert.equal(profile({avatar:'https://example.com/pixel',status:'bad'}).avatar,''); assert.equal(profile({avatar:'data:image/svg+xml;base64,PHN2Zz4='}).avatar,'');
  assert.equal(profile({avatar:'data:image/png;base64,'+'A'.repeat(24000)}).avatar,''); assert.equal(profile({name:'  Desk  ',status:'busy'}).name,'Desk');
});
