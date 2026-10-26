'use strict';
// One Windows input stream: a held drag/key cannot be stolen by another viewer.
class InputControl {
  constructor({now=()=>Date.now(),release=()=>{},changed=()=>{},idle=2000,pause=2000}={}) { Object.assign(this,{now,release,changed,idle,pause});this.owner=null;this.held=new Set();this.until=0;this.last=0; }
  drop(session) { if(!this.owner||this.owner!==session)return;this.release(session);this.owner=null;this.held.clear();this.changed(); }
  activity() { this.until=this.now()+this.pause;this.drop(this.owner);this.changed(); }
  host(active) { this.hostActive=active;if(active)this.activity();else{this.until=this.now();this.changed();} }
  tick() { if(this.owner&&!this.held.size&&this.now()-this.last>=this.idle)this.drop(this.owner); }
  reason(session) { return this.hostActive||this.now()<this.until?'host':this.owner&&this.owner!==session?'busy':'ready'; }
  accept(session,data) {
    if(!data||typeof data!=='object')return false;
    const point=()=>Number.isFinite(data.x)&&Number.isFinite(data.y);
    if(data.type==='move'&&!point()||data.type==='button'&&(!point()||![0,1,2].includes(data.button)||typeof data.down!=='boolean')||data.type==='key'&&(typeof data.code!=='string'||data.code.length>32||typeof data.down!=='boolean')||data.type==='physical-key'&&(!Number.isInteger(data.scan)||data.scan<1||data.scan>127||!Number.isInteger(data.vk)||data.vk<1||data.vk>254||typeof data.down!=='boolean')||data.type==='wheel'&&(!Number.isFinite(data.dx)||!Number.isFinite(data.dy)))return false;
    this.tick();
    if(data.type==='release'){this.drop(session);return false;}
    if(this.hostActive||this.now()<this.until||this.owner&&this.owner!==session)return false;
    // Layout advertisements and orphan up events cannot claim an idle desktop.
    if(!this.owner&&(data.type==='layout'||(['button','key','physical-key'].includes(data.type)&&data.down!==true)))return false;
    if(!this.owner){this.owner=session;this.changed();}
    this.last=this.now();
    const key=data.type==='button'?'b:'+data.button:data.type==='key'?'k:'+data.code:data.type==='physical-key'?'p:'+data.scan+':'+!!data.extended:null;
    if(key){if(data.down)this.held.add(key);else this.held.delete(key);}
    return true;
  }
}
module.exports={InputControl};
