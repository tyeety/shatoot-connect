const crypto = require('node:crypto');
class ClientPreferences {
  constructor({ read, write, encrypt, decrypt, validateEndpoint, validateDirect }) { Object.assign(this, { read, write, encrypt, decrypt, validateEndpoint, validateDirect }); }
  cardRoutes(value={}) {
    const routes=[];for(const address of [value.address,...(value.endpoints||[])])if(address)try{const target=this.destination({address,endpoint:value.endpoint});if(!routes.some(r=>r.key===target.key))routes.push(target);}catch{}
    return routes;
  }
  card(value={}) {
    const routes=this.cardRoutes(value),cards=this.read().computerCards||{};
    const pair=(value.deviceId&&cards[value.deviceId])?[value.deviceId,cards[value.deviceId]]:Object.entries(cards).find(([,c])=>value.deviceId&&c.deviceId===value.deviceId||c.routes?.some(r=>routes.some(t=>t.key===r.key)));return pair?{...pair[1],_key:pair[0]}:undefined;
  }
  rememberComputer(value={},route={}) {
    const input={...value,...route},routes=this.cardRoutes(input),validId=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.deviceId||'');
    if(!validId&&!routes.length)return;
    const cards={...(this.read().computerCards||{})},old=this.card(input)||{},key=validId?value.deviceId:old.deviceId||old._key||routes[0].key;
    const record={...old,...(validId?{deviceId:value.deviceId}:{}),routes:[...new Map([...(old.routes||[]),...routes].map(r=>[r.key,r])).values()].slice(-20)};
    delete record._key;
    if(typeof value.name==='string')record.name=value.name.slice(0,60);
    if(value.avatar!==undefined)record.avatar=require('../shared/profile.cjs').profile(value).avatar;
    if(value.preview!==undefined){if(typeof value.preview!=='string'||value.preview.length>90000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value.preview))throw new Error('Invalid desktop preview.');if(value.previewKind==='wallpaper'){let unchanged=false;try{unchanged=old.previewKind==='wallpaper'&&!!old.preview&&this.decrypt(old.preview)===value.preview;}catch{}if(!unchanged){record.preview=this.encrypt(value.preview);record.previewAt=Date.now();}record.previewKind='wallpaper';}}
    if(JSON.stringify(record)===JSON.stringify(cards[key]))return;
    if(old._key&&old._key!==key)delete cards[old._key];
    cards[key]=record;for(const id of Object.keys(cards).slice(0,Math.max(0,Object.keys(cards).length-200)))delete cards[id];
    this.write({computerCards:cards});return true;
  }
  decorate(value={},route={}) {
    const input={...value,...route},card=this.card(input)||{},keys=new Set([...this.cardRoutes(input),...(card.routes||[])].map(r=>r.key));
    const favorite=(this.read().favorites||[]).find(f=>{try{return f.name!==f.address&&keys.has(this.destination(f).key);}catch{return false;}});
    let preview='';try{if(card.preview&&card.previewKind==='wallpaper'){this.previewCache||=new Map();if(!this.previewCache.has(card.preview)){this.previewCache.set(card.preview,this.decrypt(card.preview));if(this.previewCache.size>200)this.previewCache.delete(this.previewCache.keys().next().value);}preview=this.previewCache.get(card.preview);}}catch{}
    const knownRoute=card.routes?.at(-1);
    return {...value,deviceId:value.deviceId||card.deviceId,route:value.route||(knownRoute?{type:knownRoute.endpoint?'id':'lan',address:knownRoute.address,endpoint:knownRoute.endpoint}:null),displayName:card.alias||favorite?.name||card.name||value.name||value.address||'',avatar:card.avatar!==undefined?card.avatar:value.avatar||'',preview,previewAt:card.previewAt};
  }
  renameComputer(value,name) {
    if(typeof name!=='string'||name.trim().length>60)throw new Error('Enter a valid computer name.');
    const previous=this.card(value);this.rememberComputer({...value,name:previous?.name||value.name,preview:undefined});const old=this.card(value);if(!old)throw new Error('Computer not found.');
    const cards={...(this.read().computerCards||{})},key=old._key;cards[key]={...old,alias:name.trim()};delete cards[key]._key;
    const keys=new Set((old.routes||[]).map(r=>r.key));const favorites=(this.read().favorites||[]).map(f=>{try{return keys.has(this.destination(f).key)?{...f,name:name.trim()||f.address}:f;}catch{return f;}});
    this.write({computerCards:cards,favorites});return this.decorate(value);
  }
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
  list() { return (this.read().favorites || []).map(({ id, name, address, endpoint, shortcut }) => this.decorate({ id, name, address, endpoint, shortcut: !!shortcut })); }
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
  history() { return (this.read().connectionHistory||[]).map(({id,address,endpoint,name,at,count})=>this.decorate({id,address,endpoint,name,at,count})); }
  computers(){
    const rows=[];
    for(const record of [...this.list().map(r=>({...r,saved:true,at:0})),...this.history().map(r=>({...r,saved:false}))]){
      const key=this.destination(record).key,existing=rows.find(r=>r.keys.has(key)||(record.deviceId&&r.deviceId===record.deviceId));
      if(existing){existing.at=Math.max(existing.at||0,record.at||0);existing.keys.add(key);if(!existing.deviceId)existing.deviceId=record.deviceId;}
      else rows.push({...record,keys:new Set([key])});
    }
    return rows.sort((a,b)=>(b.at||0)-(a.at||0)||Number(b.saved)-Number(a.saved)||a.name.localeCompare(b.name)).map(({keys,...record})=>record);
  }
  connected(value) {
    const target=this.destination(value), history=this.read().connectionHistory||[], previous=history.find(h=>h.key===target.key);
    const record={...target,id:previous?.id||crypto.randomUUID(),name:String(value.name||previous?.name||target.address).slice(0,60),at:Math.max(Date.now(),(history[0]?.at||0)+1),count:(previous?.count||0)+1};
    this.write({connectionHistory:[record,...history.filter(h=>h.key!==target.key)].slice(0,200)}); return this.history();
  }
  saveHistory(id) { const h=this.history().find(h=>h.id===id); if(!h)throw new Error('Connection history entry not found.');return this.save({...h,password:this.recall(h)}); }
  clearHistory() { this.write({connectionHistory:[]}); return []; }
  save(value) {
    const { password = '', serverKey = '' } = value || {};
    const {address:target,endpoint}=this.destination(value);
    if(value.name!=null&&typeof value.name!=='string')throw new Error('Enter a valid computer name and password.');
    const favorites = this.read().favorites || [];
    const existing = favorites.find(record => record.address === target && record.endpoint === endpoint);
    const name=value.name?.trim()||existing?.name||target;
    if (typeof name !== 'string' || name.length > 60 || typeof password !== 'string' || password.length > 128 || typeof serverKey !== 'string' || serverKey.length > 256) throw new Error('Enter a valid computer name and password.');
    const direct=!endpoint;
    if (!existing && favorites.length >= 100) throw new Error('You can save up to 100 connections.');
    const record = { id: existing?.id || crypto.randomUUID(), name, address: target, endpoint, password: password ? this.encrypt(password) : existing?.password || null, serverKey: !direct && serverKey ? this.encrypt(serverKey) : existing?.serverKey || null, shortcut: existing?.shortcut || false, shortcutFile: existing?.shortcutFile || null };
    this.write({ favorites: [...favorites.filter(item => item.id !== record.id), record] });const card=this.card(record);if(card&&value.name?.trim())this.renameComputer(record,name);return record.id;
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
