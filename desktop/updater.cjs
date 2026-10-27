'use strict';
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PassThrough } = require('node:stream');
const REPOSITORY = 'tyeety/shatoot-connect';
function trustedAddress(url) { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password && ['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname); }
function electronResponse(url,range) {
  if (!trustedAddress(url)) return Promise.reject(new Error('Untrusted update download address.'));
  return new Promise((resolve,reject) => {
    const request = require('electron').net.request({ url, redirect: 'manual', useSessionCookies: false }); let redirects = 0;
    if(range)request.setHeader('Range',`bytes=${range.start}-${range.end}`);request.setHeader('User-Agent','ShatootConnect-Updater'); request.setHeader('Accept','application/vnd.github+json');request.setHeader('Cache-Control','no-cache');request.setHeader('Pragma','no-cache');
    const timer = setTimeout(() => { request.abort(); reject(new Error('Update request timed out.')); },30000);
    request.on('redirect', (_status,_method,target) => { if (++redirects > 5 || !trustedAddress(target)) { clearTimeout(timer); request.abort(); reject(new Error('Untrusted update download address.')); } else request.followRedirect(); });
    request.on('error', error => { clearTimeout(timer); reject(error); });
    request.on('response', response => { clearTimeout(timer); if (response.statusCode !== 200 && !(range&&response.statusCode===206)) { response.resume(); reject(new Error(`GitHub update request failed (${response.statusCode}). Try again later.`)); return; } const stalled = () => setTimeout(() => { request.abort(); response.destroy(new Error('Update download stalled.')); },30000); let idle = stalled(); response.on('data', () => { clearTimeout(idle); idle=stalled(); }); const clear = () => clearTimeout(idle); response.once('end',clear); response.once('error',clear); response.once('close',clear); const stream = new PassThrough({highWaterMark:256*1024});stream.statusCode=response.statusCode;stream.headers=response.headers; response.on('error', error => stream.destroy(error)); stream.on('close', () => { if (!response.readableEnded) request.abort(); clearTimeout(idle); }); response.pipe(stream); resolve(stream); });
    request.end();
  });
}
function newer(next, current) {
  const parse = v => /^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null;
  const a = parse(next), b = parse(current); if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function assetFor(release, current, portable) {
  const version = String(release?.tag_name || '').replace(/^v/, '');
  if (release?.draft || release?.prerelease || !newer(version, current)) return null;
  const name = `ShatootConnect-${portable ? '' : 'Setup-'}${version}-win-x64.exe`;
  const asset = release.assets?.find(a => a.name === name && a.state === 'uploaded');
  if (!asset || !Number.isSafeInteger(asset.size) || asset.size < 1024 || asset.size > 1024 ** 3 || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '') || asset.browser_download_url !== `https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`) throw new Error('The release has no verified compatible update package.');
  return { version, name, size: asset.size, digest: asset.digest.slice(7), url: asset.browser_download_url };
}
function response(url, range, redirects = 0) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password || !['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(u.hostname) || redirects > 5) return Promise.reject(new Error('Untrusted update download address.'));
  return new Promise((resolve, reject) => {
    const req = https.get(u, { headers: { 'User-Agent': 'ShatootConnect-Updater', Accept: 'application/vnd.github+json','Cache-Control':'no-cache',...(range?{Range:`bytes=${range.start}-${range.end}`}:{}) }, timeout: 30000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) { res.resume(); response(new URL(res.headers.location, u).href,range,redirects + 1).then(resolve, reject); }
      else if (res.statusCode !== 200 && !(range&&res.statusCode===206)) { res.resume(); reject(new Error(`GitHub update request failed (${res.statusCode}). Try again later.`)); }
      else resolve(res);
    });
    req.on('timeout', () => req.destroy(new Error('Update request timed out.'))); req.on('error', reject);
  });
}
class Updater {
  constructor({ version, directory, portable, changed = () => {}, request = response }) { Object.assign(this, { version, directory, portable, changed, request }); this.status = { state: 'idle', current: version }; }
  emit(patch) { Object.assign(this.status, patch); this.changed({ ...this.status }); return { ...this.status }; }
  async check() {
    if (this.busy) return this.status;
    this.busy = true; this.emit({ state: 'checking', error: '' });
    try {
      const res = await this.request(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=100&_=${Date.now()}`); let text = '';
      for await (const chunk of res) { text += chunk; if (text.length > 2 * 1024 ** 2) { res.destroy(); throw new Error('Update metadata is too large.'); } }
      const releases=JSON.parse(text);if(!Array.isArray(releases))throw new Error('Invalid release metadata.');
      const latest=releases.filter(r=>!r.draft&&!r.prerelease&&newer(String(r.tag_name||'').replace(/^v/,''),this.version)).reduce((a,b)=>!a||newer(b.tag_name.replace(/^v/,''),a.tag_name.replace(/^v/,''))?b:a,null);
      this.asset = latest?assetFor(latest, this.version, this.portable):null;
      return this.emit({ state: this.asset ? 'available' : 'current', version: this.asset?.version || this.version });
    } catch (error) { return this.emit({ state: 'error', error: error.message }); }
    finally { this.busy = false; }
  }
  async prepare(){
    if(this.preparing||this.busy)throw new Error('An update is already in progress.');this.preparing=true;
    try{for(let pass=0;pass<3;pass++){
      const status=await this.check();if(status.state==='error')throw new Error(status.error);if(!this.asset)throw new Error('The latest version is already installed.');
      const asset=this.asset,target=path.join(this.directory,asset.name);
      let valid=false;if(fs.existsSync(target)&&fs.statSync(target).size===asset.size){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(target))hash.update(chunk);valid=hash.digest('hex')===asset.digest;}
      if(valid){this.file=target;this.emit({state:'ready',percent:100});}else await this.download();
      const fresh=await this.check();if(fresh.state==='error')throw new Error(fresh.error);
      if(this.asset?.version===asset.version&&this.asset.digest===asset.digest){this.emit({state:'ready',percent:100});return this.file;}
    }throw new Error('A newer release appeared during download. Please retry.');}
    catch(error){this.emit({state:'error',error:error.message});throw error;}finally{this.preparing=false;}
  }
  async download() {
    if (this.busy || !this.asset) throw new Error('Check for a new version first.');
    this.busy = true; this.emit({ state: 'downloading', percent: 0, error: '',retrying:false,speed:0,received:0 });
    const a = this.asset, target = path.join(this.directory, a.name), partial = target + '.partial';
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      const space = fs.statfsSync(this.directory); if (space.bavail * space.bsize < a.size * 2) throw new Error('Not enough free space for the update.');
      await require('./update-download.cjs').download({asset:a,partial,request:this.request,progress:value=>this.emit(value)});
      fs.renameSync(partial, target); this.file = target; return this.emit({ state: 'ready', percent: 100 });
    } catch (error) { if(!error.resumable)fs.rmSync(partial, { force: true }); this.emit({ state: 'error', error: error.message }); throw error; }
    finally { this.busy = false; }
  }
}
module.exports = { Updater, newer, assetFor, electronResponse };
