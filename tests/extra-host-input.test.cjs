'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

test('additional host forwards cached/live input state and physical cursor packets',async()=>{
 const events={},channels=[],sent=[];
 const track={stop(){}};
 const stream={getVideoTracks:()=>[track],getTracks:()=>[track]};
 const win={LayoutSync:class{},StreamQuality:class{async start(){}},SessionExchange:class{},};
 const api=new Proxy({
  hostInit:async()=>({lan:true,profiles:{speed:{fps:60,width:1920,height:1080}},profile:'speed',autoQuality:false,showHostCursor:false,invitation:{name:'Fixture'}}),
  sources:async()=>[{id:'fixture'}],selectSource:async()=>{},approve:async()=>({accepted:true,control:true}),capture:()=>win.shatootconnectCapture(),hostSend:data=>sent.push(data),watchKeyboard:()=>{},
 },{get:(target,key)=>key.startsWith('on')?fn=>{events[key]=fn}:target[key]});
 win.shatootconnect=api;
 class Peer{
  addTrack(){return {};}
  getTransceivers(){return [];}
  createDataChannel(label){const channel={label,readyState:'connecting',bufferedAmount:0,packets:[],send(value){this.packets.push(JSON.parse(value));}};channels.push(channel);return channel;}
  async createOffer(){return {};}
  async setLocalDescription(){this.localDescription={toJSON:()=>({})};}
 }
 const context={window:win,navigator:{mediaDevices:{getDisplayMedia:async()=>stream}},RTCPeerConnection:Peer,RTCRtpReceiver:{getCapabilities:()=>null}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../desktop/ui/extra-host.js'),'utf8'),context);
 const until=async fn=>{for(let n=0;n<40;n++){if(fn())return;await new Promise(r=>setImmediate(r));}throw Error('Additional host fixture timed out');};
 await until(()=>sent.some(s=>s.type==='desktop-accept'));
 events.onInputState({type:'input-state',reason:'host'});
 events.onHostSignal({type:'desktop-ready'});await until(()=>channels.length===3);
 const control=channels.find(c=>c.label==='control'),pointer=channels.find(c=>c.label==='pointer');
 for(const c of [control,pointer]){c.readyState='open';c.onopen();}
 assert.equal(control.packets.find(p=>p.type==='input-state').reason,'host');
 events.onInputState({type:'input-state',reason:'ready'});assert.equal(control.packets.at(-1).reason,'ready');
 events.onInputState({type:'input-state',reason:'busy'});assert.equal(control.packets.at(-1).reason,'busy');
 events.onHostCursor({type:'host-cursor',x:.2,y:.3,visible:true,physical:true});
 events.onHostCursor({type:'host-cursor',x:.4,y:.5,visible:true,physical:true});
 assert.equal(pointer.packets.length,2);assert.equal(pointer.packets[0].visible,false);assert.equal(pointer.packets[0].physical,true);
 assert.ok(pointer.packets[1].sequence>pointer.packets[0].sequence);
 pointer.bufferedAmount=4096;events.onHostCursor({type:'host-cursor',x:.6,y:.7,visible:true,physical:true});assert.equal(pointer.packets.length,2);
});
