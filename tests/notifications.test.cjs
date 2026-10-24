'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const{EventEmitter}=require('node:events');
const{createNotifications}=require('../desktop/notifications.cjs');
function fixture(t){
  let time=0,nextTimer=0,nextWindow=0,active=true;const timersMap=new Map(),handlers=new Map(),listeners=new Map();
  const schedule=(fn,delay,interval=0)=>{const id=++nextTimer;timersMap.set(id,{fn,at:time+delay,interval});return id;};
  const timers={setTimeout:(fn,delay)=>schedule(fn,delay),clearTimeout:id=>timersMap.delete(id),setInterval:(fn,delay)=>schedule(fn,delay,delay),clearInterval:id=>timersMap.delete(id)};
  const clock=ms=>{const end=time+ms;for(;;){const item=[...timersMap].sort((a,b)=>a[1].at-b[1].at).find(([,r])=>r.at<=end);if(!item)break;const[id,r]=item;time=r.at;if(r.interval)r.at+=r.interval;else timersMap.delete(id);r.fn();}time=end;};
  class Window extends EventEmitter{
    constructor(options={}){super();this.bounds={x:0,y:0,width:options.width||320,height:options.height||76};this.messages=[];this.webContents=new EventEmitter();this.webContents.id=++nextWindow;this.webContents.mainFrame={};this.webContents.setWindowOpenHandler=()=>{};this.webContents.send=(...args)=>this.messages.push(args);}
    isDestroyed(){return!!this.destroyed}isVisible(){return!!this.visible}getBounds(){return{...this.bounds}}setPosition(x,y){Object.assign(this.bounds,{x,y})}setBounds(bounds){Object.assign(this.bounds,bounds)}setSize(width,height){Object.assign(this.bounds,{width,height})}setContentProtection(){}setAlwaysOnTop(){}showInactive(){this.visible=true;this.emit('show')}destroy(){this.destroyed=true;this.visible=false;this.emit('closed')}loadFile(){queueMicrotask(()=>{if(!this.destroyed){this.emit('ready-to-show');listeners.get('notice-size')?.({sender:this.webContents,senderFrame:this.webContents.mainFrame},this.bounds.height);}});return Promise.resolve()}
  }
  const screen=new EventEmitter();screen.area={x:-1920,y:-100,width:1920,height:1080};screen.getPrimaryDisplay=()=>({workArea:screen.area});
  const owner=new Window(),api=createNotifications({BrowserWindow:Window,ipcMain:{handle:(n,f)=>handlers.set(n,f),on:(n,f)=>listeners.set(n,f)},screen,activity:()=>active,now:()=>time,timers});t.after(()=>api.close());
  const event=record=>({sender:record.win.webContents,senderFrame:record.win.webContents.mainFrame});
  const answer=(record,index)=>listeners.get('notice-answer')(event(record),index),hide=record=>listeners.get('notice-hide')(event(record));
  const disjoint=()=>{const boxes=[...api.entries.values()].map(r=>r.win.getBounds());for(const b of boxes){assert.equal(b.x+b.width,screen.area.x+screen.area.width-16);assert.ok(b.y>=screen.area.y&&b.y+b.height<=screen.area.y+screen.area.height)}for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)assert.ok(boxes[i].y+boxes[i].height<=boxes[j].y||boxes[j].y+boxes[j].height<=boxes[i].y)};
  return{api,owner,screen,Window,clock,disjoint,answer,hide,event,listeners,active:value=>active=value,ready:()=>new Promise(resolve=>queueMicrotask(resolve))};
}
test('one bottom-right queue never overlaps, reflows on display changes and preserves preempted toasts',async t=>{
  const f=fixture(t);let resolved=0;const promises=Array.from({length:6},(_,i)=>f.api.toast(f.owner,'File '+i).then(()=>resolved++));await f.ready();assert.equal(f.api.entries.size,3);f.disjoint();
  const question=f.api.showMessageBox(f.owner,{type:'question',priority:'critical',buttons:['Reject','Allow']});await f.ready();const critical=[...f.api.entries.values()].find(r=>r.data.urgent);assert.ok(critical);assert.equal(resolved,0);f.disjoint();f.answer(critical,0);assert.equal((await question).response,0);
  f.screen.area.height=560;f.screen.emit('display-metrics-changed');await f.ready();assert.equal(f.api.entries.size,2);f.disjoint();
  while(f.api.entries.size){for(const record of [...f.api.entries.values()])f.hide(record);await f.ready()}await Promise.all(promises);assert.equal(resolved,6);
});
test('passive notices wait during idle, fade during activity, pause on hover and have explicit Hide',async t=>{
  const f=fixture(t);f.active(false);const done=f.api.toast(f.owner,'Received');await f.ready();f.clock(120000);assert.equal(f.api.entries.size,1);const record=[...f.api.entries.values()][0];
  f.active(true);f.clock(6600);assert.ok(record.fading);assert.deepEqual(record.win.messages.at(-1),['notice-fade',true]);
  f.listeners.get('notice-hover')(f.event(record),true);f.clock(10000);assert.equal(f.api.entries.size,1);assert.equal(record.fading,false);
  f.listeners.get('notice-hover')(f.event(record),false);f.clock(2600);await done;assert.equal(f.api.entries.size,0);
  f.active(false);const hidden=f.api.toast(f.owner,'Hide me');await f.ready();f.hide([...f.api.entries.values()][0]);assert.equal((await hidden).response,0);
});
test('critical expiry and cancellation never accept requests; host panels reserve stack space',async t=>{
  const f=fixture(t);const panel=new f.Window();Object.assign(panel.bounds,{x:-332,y:892,width:320,height:76});panel.showInactive();f.api.reserve(panel);
  const toast=f.api.toast(f.owner,'Saved');await f.ready();assert.ok([...f.api.entries.values()][0].win.getBounds().y+230<=panel.bounds.y-12);f.disjoint();
  const promises=Array.from({length:5},()=>f.api.showMessageBox(f.owner,{type:'question',priority:'critical',buttons:['Reject','Allow']}));await f.ready();f.api.cancelFor(f.owner,'critical');assert.ok((await Promise.all(promises)).every(r=>r.response===0));await f.ready();
  const question=f.api.showMessageBox(f.owner,{type:'question',buttons:['Reject','Allow']});f.active(false);await f.ready();f.clock(60000);assert.equal((await question).response,0);
  panel.destroy();await f.ready();const record=[...f.api.entries.values()][0];assert.throws(()=>f.listeners.get('notice-hide')({sender:record.win.webContents,senderFrame:{}}),/Unauthorized/);f.hide(record);await toast;
});

test('measured notification heights compact the stack and a tall critical request preempts short passive notices',async t=>{
  const f=fixture(t);f.screen.area.height=560;const a=f.api.toast(f.owner,'Short'),b=f.api.toast(f.owner,'Short 2');await f.ready();
  for(const record of f.api.entries.values())f.listeners.get('notice-size')(f.event(record),110);
  const c=f.api.toast(f.owner,'Short 3');await f.ready();for(const record of f.api.entries.values())f.listeners.get('notice-size')(f.event(record),110);assert.equal(f.api.entries.size,3);f.disjoint();
  const critical=f.api.showMessageBox(f.owner,{type:'question',priority:'critical',buttons:['Reject','Allow']});await f.ready();const record=[...f.api.entries.values()].find(r=>r.data.urgent);assert.ok(record);f.listeners.get('notice-size')(f.event(record),450);f.disjoint();assert.ok(f.api.entries.size<=2);f.answer(record,0);await critical;
  while(f.api.entries.size){for(const r of [...f.api.entries.values()])f.hide(r);await f.ready()}await Promise.all([a,b,c]);
});
