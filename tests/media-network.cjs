'use strict';
// A real UDP bottleneck around the local TURN fixture, not a forged BWE report.
// No system routes, firewall rules or production services are changed.
const dgram=require('node:dgram'),{spawn}=require('node:child_process'),path=require('node:path');
module.exports=async({kbps,rtt=0,loss=0})=>{
 const server=spawn(path.join(__dirname,'../tools/relay-fixture.exe'),[],{windowsHide:true,stdio:['ignore','pipe','ignore']});
 const sockets=new Set(),timers=new Set(),flows=new Map();let rate=kbps*1000/8,closed=false;
 const counters={forwarded:0,dropped:0,bytes:0,maxQueueMs:0};let received=0;
 const close=()=>{if(closed)return;closed=true;for(const timer of timers)clearTimeout(timer);for(const socket of sockets)try{socket.close();}catch{}server.kill();};
 try{
  const endpoint=await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('Local TURN fixture did not start')),5000);let output='';
   server.once('error',reject);server.once('exit',()=>reject(Error('Local TURN fixture exited')));
   server.stdout.on('data',chunk=>{output+=chunk;try{const value=JSON.parse(output);clearTimeout(timeout);resolve(value);}catch{}});
  });
  const listen=socket=>new Promise((resolve,reject)=>{sockets.add(socket);socket.once('error',reject);socket.bind(0,'127.0.0.1',resolve);});
  const proxy=dgram.createSocket('udp4');await listen(proxy);
  proxy.on('message',(packet,client)=>{
   const key=client.address+':'+client.port;let flow=flows.get(key);
   if(!flow){
    const upstream=dgram.createSocket('udp4');sockets.add(upstream);flow={upstream,next:0};flows.set(key,flow);
    upstream.on('error',()=>{});
    upstream.on('message',reply=>{
     if(closed)return;
     if(loss>0&&++received%Math.round(100/loss)===0){counters.dropped++;return;}
     const now=performance.now(),start=Math.max(now,flow.next),queue=start-now;
     if(queue>150){counters.dropped++;return;}
     flow.next=start+reply.length/rate*1000;counters.maxQueueMs=Math.max(counters.maxQueueMs,queue);
     const timer=setTimeout(()=>{timers.delete(timer);if(!closed){proxy.send(reply,client.port,client.address);counters.forwarded++;counters.bytes+=reply.length;}},queue+rtt/2);
     timers.add(timer);
    });
   }
   const timer=setTimeout(()=>{timers.delete(timer);if(!closed)flow.upstream.send(packet,endpoint.port,endpoint.host);},rtt/2);timers.add(timer);
  });
  return {iceServers:[{urls:`turn:127.0.0.1:${proxy.address().port}?transport=udp`,username:'local-test-user',credential:'local-test-password'}],counters,setRate(value){rate=value*1000/8;},close};
 }catch(error){close();throw error;}
};
