const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ClientPreferences } = require('../desktop/preferences.cjs');
function fixture() {
  let stored = {}; const secrets = new Map();
  const options = { read: () => structuredClone(stored), write: patch => stored = { ...stored, ...patch },
    encrypt: value => { const key = crypto.randomUUID(); secrets.set(key, value); return key; }, decrypt: key => secrets.get(key),
    validateEndpoint: endpoint => { if (!endpoint.startsWith('wss://')) throw Error('Invalid endpoint'); return endpoint; },
    validateDirect: address => { if (!/^192\.168\.\d+\.\d+(?::\d+)?$/.test(address)) throw Error('Invalid LAN IP'); return address; } };
  return { preferences: new ClientPreferences(options), storage: () => stored };
}
test('combined computers deduplicate saved/recent destinations and sort every row by its last connection',()=>{
  const {preferences:p}=fixture();p.save({address:'192.168.1.10:8788',name:'Saved',password:'secret'});p.connected({address:'192.168.1.10'});p.connected({address:'192.168.1.11',name:'Recent'});
  let rows=p.computers();assert.equal(rows.length,2);assert.equal(rows.filter(r=>r.saved).length,1);assert.equal(rows.find(r=>r.saved).address,'192.168.1.10:8788');
  assert.equal(rows[0].address,'192.168.1.11');assert.equal(rows[0].saved,false);
  const savedAt=rows.find(r=>r.saved).at;p.connected({address:'192.168.1.10'});rows=p.computers();assert.equal(rows[0].saved,true);assert.ok(rows[0].at>=savedAt);
  p.save({address:'192.168.1.11',name:'Now saved'});assert.equal(p.computers().length,2);assert.ok(p.computers().every(r=>r.saved));
});
test('a chosen computer nickname survives resaving credentials and keeps the shortcut identity',()=>{
  const{preferences}=fixture();const id=preferences.save({name:'دفتر مرکزی',address:'192.168.1.10',password:'secret'});preferences.markShortcut(id);const shortcut=preferences.shortcutName(id);
  preferences.save({address:'192.168.1.10',password:'new-secret'});assert.equal(preferences.get(id).name,'دفتر مرکزی');
  preferences.save({...preferences.get(id),name:'حسابداری'});assert.equal(preferences.get(id).name,'حسابداری');assert.equal(preferences.get(id).password,'new-secret');assert.equal(preferences.shortcutName(id),shortcut);
});
test('fixed credentials and favorites are stored only through the encryption boundary', () => {
  const { preferences, storage } = fixture();
  preferences.setFixedPassword('fixed-secret-123');
  const id = preferences.save({ name: 'Office', address: '123 456 789', password: 'remote-secret', endpoint: 'wss://office.example', serverKey: 'enrollment-secret' });
  const raw = JSON.stringify(storage());
  for (const secret of ['fixed-secret-123', 'remote-secret', 'enrollment-secret']) assert.ok(!raw.includes(secret));
  assert.equal(preferences.fixedPassword(), 'fixed-secret-123');
  assert.equal(preferences.get(id).password, 'remote-secret');
  assert.equal(preferences.get(id).serverKey, 'enrollment-secret');
  assert.ok(!JSON.stringify(preferences.list()).includes('remote-secret'));
  preferences.setFixedPassword(''); assert.equal(preferences.fixedPassword(), '');
});
test('favorites update without changing shortcut identity and reject invalid destinations', () => {
  const { preferences } = fixture();
  const value = { name: 'LAN', address: '192.168.1.10:8788', password: 'lan-password' };
  const id = preferences.save(value); preferences.markShortcut(id);
  assert.equal(preferences.save({ ...value, name: 'Renamed', password: 'new-secret' }), id);
  assert.equal(preferences.list().length, 1); assert.equal(preferences.list()[0].shortcut, true);
  assert.match(preferences.shortcutName(id), /^Shatoot Connect - LAN \([a-f0-9]{8}\)\.lnk$/);
  assert.throws(() => preferences.shortcutName('../bad'), /Invalid/);
  assert.throws(() => preferences.setFixedPassword('short'), /8 to 128/);
  assert.throws(() => preferences.save({ ...value, address: 'example.com' }), /Invalid LAN/);
  preferences.remove(id); assert.equal(preferences.list().length, 0);
});
test('unattended access is opt-in and is revoked when the fixed password is removed', () => {
  const { preferences } = fixture();
  assert.equal(preferences.unattended(), false);
  assert.throws(() => preferences.setUnattended(true), /fixed password/);
  preferences.setFixedPassword('unattended-secret'); assert.equal(preferences.unattended(), false);
  preferences.setUnattended(true); assert.equal(preferences.unattended(), true);
  assert.equal(preferences.canAutoApprove(true), true);
  for (const unverified of [false, undefined, 'true', 1]) assert.equal(preferences.canAutoApprove(unverified), false);
  preferences.setFixedPassword(''); assert.equal(preferences.unattended(), false);
  preferences.setFixedPassword('another-secret'); assert.equal(preferences.unattended(), false);
});

test('password recall is encrypted, canonical for LAN, isolated by server and erased when disabled',()=>{
  const {preferences:p,storage}=fixture();p.attempt({address:'192.168.1.10:8788',password:'last-lan-secret'});
  assert.equal(p.recall({address:'192.168.1.10'}),'last-lan-secret');
  p.attempt({address:'123 456 789',endpoint:'wss://one.example',password:'one-password'});
  assert.equal(p.recall({address:'123456789',endpoint:'wss://two.example'}),'');
  assert.equal(p.recall({address:'123456789',endpoint:'wss://one.example'}),'one-password');
  assert.ok(!JSON.stringify(storage()).includes('last-lan-secret'));assert.ok(!JSON.stringify(storage()).includes('one-password'));
  p.remember(false);assert.equal(p.recall({address:'192.168.1.10'}),'');assert.deepEqual(storage().connectionPasswords,{});
  p.attempt({address:'192.168.1.10',password:'do-not-store'});p.remember(true);assert.equal(p.recall({address:'192.168.1.10'}),'');
});
test('recent connections deduplicate and can be saved directly without a separate name/password form',()=>{
  const {preferences:p}=fixture();const target={address:'192.168.1.10',password:'remembered-secret'};
  p.attempt(target);p.connected(target);p.connected({...target,address:'192.168.1.10:8788'});
  assert.equal(p.history().length,1);assert.equal(p.history()[0].count,2);const id=p.saveHistory(p.history()[0].id);assert.equal(p.get(id).password,'remembered-secret');
  const addressOnly=p.save({address:'192.168.1.11'});assert.equal(p.get(addressOnly).password,'');assert.equal(p.get(addressOnly).name,'192.168.1.11');
  p.clearHistory();assert.equal(p.history().length,0);assert.equal(p.list().length,2);
});

test('local names and encrypted offline previews follow LAN/ID identity without changing the published profile',()=>{
  const{preferences:p,storage}=fixture(),deviceId=crypto.randomUUID(),preview='data:image/jpeg;base64,YWJj';
  p.save({address:'192.168.1.20',name:'دفتر',password:'secret'});
  p.rememberComputer({preview},{address:'192.168.1.20:8788'});
  p.rememberComputer({deviceId,name:'Amir',avatar:''},{address:'192.168.1.20'});
  assert.equal(p.decorate({deviceId,name:'Amir'}).displayName,'دفتر');assert.equal(p.decorate({deviceId}).preview,preview);assert.ok(!JSON.stringify(storage()).includes(preview));
  p.rememberComputer({deviceId,name:'Amir changed'},{address:'123456789',endpoint:'wss://one.example'});
  p.renameComputer({deviceId},'حسابداری');p.save({address:'192.168.1.20',name:'حسابداری'});assert.equal(p.decorate({deviceId}).preview,preview);
  assert.equal(p.decorate({deviceId,name:'Amir changed'}).name,'Amir changed');assert.equal(p.decorate({address:'123456789',endpoint:'wss://one.example'}).displayName,'حسابداری');assert.equal(p.list()[0].name,'حسابداری');
  p.rememberComputer({deviceId,name:'New published name',avatar:''});assert.equal(p.decorate({deviceId}).displayName,'حسابداری');assert.equal(p.decorate({deviceId}).preview,preview);
  assert.equal(p.decorate({address:'123456789',endpoint:'wss://another.example'}).preview,'');
  p.renameComputer({deviceId},'');assert.equal(p.decorate({deviceId}).displayName,'New published name');
  assert.throws(()=>p.rememberComputer({preview:'data:image/svg+xml;base64,YWJj'},{address:'192.168.1.20'}),/Invalid desktop preview/);
});
