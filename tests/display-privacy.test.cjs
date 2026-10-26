'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {DisplayPrivacy}=require('../desktop/display-privacy.cjs');
class Window extends EventEmitter{
 constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};}
 setContentProtection(value){this.protected=value;}setIgnoreMouseEvents(value){this.passthrough=value;}setAlwaysOnTop(value,level){this.level=level;}
 loadFile(){queueMicrotask(()=>this.emit('ready-to-show'));return Promise.resolve();}showInactive(){this.visible=true;}setBounds(value){this.options={...this.options,...value};}
 isDestroyed(){return this.destroyed===true;}destroy(){this.destroyed=true;this.emit('closed');}
}
function setup(){let time=0;const screen=new EventEmitter();screen.displays=[{id:1,bounds:{x:-1920,y:0,width:1920,height:1080}},{id:2,bounds:{x:0,y:0,width:2560,height:1440}}];screen.getAllDisplays=()=>screen.displays;const changes=[];
 const privacy=new DisplayPrivacy({BrowserWindow:Window,screen,now:()=>time,supported:()=>true,escapeAvailable:()=>true,changed:(owner,reason)=>changes.push({owner,reason}),timers:{setInterval:()=>({unref(){}}),clearInterval(){}}});
 return {privacy,screen,changes,advance:n=>time+=n};
}
test('every physical monitor is covered without intercepting remote input or entering capture',async()=>{
 const {privacy,screen}=setup(),owner={};privacy.request(owner,true);await Promise.resolve();
 assert.equal(privacy.windows.size,2);for(const d of screen.displays){const w=privacy.windows.get(d.id);for(const key of ['x','y','width','height'])assert.equal(w.options[key],d.bounds[key]);assert.equal(w.protected,true);assert.equal(w.passthrough,true);assert.equal(w.options.focusable,false);assert.equal(w.visible,true);}
 screen.displays.push({id:3,bounds:{x:2560,y:-900,width:1600,height:900}});screen.emit('display-added');assert.equal(privacy.windows.size,3);
 screen.displays.shift();screen.emit('display-removed');assert.equal(privacy.windows.size,2);privacy.close();assert.equal(screen.listenerCount('display-added'),0);
});
test('one guest disconnecting cannot restore a different guest’s active privacy request',()=>{
 const {privacy}=setup(),a={},b={};privacy.request(a,true);privacy.request(b,true);privacy.release(a);assert.equal(privacy.windows.size,2);privacy.release(b);assert.equal(privacy.windows.size,0);privacy.close();
});
test('missing heartbeats, destroyed owners and local emergency restore displays',()=>{
 const {privacy,advance,changes}=setup(),a={},b={win:{isDestroyed:()=>true}};privacy.request(a,true);advance(4000);privacy.request(a,true);advance(3000);privacy.tick();assert.equal(privacy.status(a).active,true);
 advance(3500);privacy.tick();assert.equal(privacy.windows.size,0);assert.equal(changes.at(-1).reason,'expired');
 privacy.request(b,true);privacy.tick();assert.equal(privacy.windows.size,0);
 privacy.request(a,true);privacy.clear('emergency');assert.equal(privacy.windows.size,0);assert.equal(changes.at(-1).reason,'emergency');privacy.close();
});
test('unsupported capture exclusion or unavailable emergency exit refuses activation',()=>{
 const {privacy}=setup();privacy.supported=()=>false;assert.throws(()=>privacy.request({},true),/unavailable/);assert.equal(privacy.windows.size,0);
 privacy.supported=()=>true;privacy.escapeAvailable=()=>false;assert.throws(()=>privacy.request({},true),/unavailable/);assert.throws(()=>privacy.request({},'yes'),/Invalid/);privacy.close();
});
test('cover crashes and a failed display allocation restore all monitors without crashing the main loop',()=>{
 const {privacy,screen,changes}=setup(),owner={};privacy.request(owner,true);
 [...privacy.windows.values()][0].webContents.emit('render-process-gone');assert.equal(privacy.windows.size,0);assert.equal(changes.at(-1).reason,'error');
 privacy.request(owner,true);privacy.BrowserWindow=class{constructor(){throw Error('display allocation failed')}};screen.displays.push({id:3,bounds:{x:0,y:0,width:20,height:20}});
 assert.doesNotThrow(()=>screen.emit('display-added'));assert.equal(privacy.windows.size,0);assert.equal(privacy.owners.size,0);privacy.close();
});
