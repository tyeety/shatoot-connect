'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {QualityPolicy,StreamQuality}=require('../desktop/ui/stream-quality.js');
const {PROFILES}=require('../shared/protocol.cjs');
function stats({capacity=100000000,rtt=.02,sent=100,lost=0,limitation='none'}={}){return new Map([
 ['video',{id:'video',type:'outbound-rtp',kind:'video',packetsSent:sent,remoteId:'remote',qualityLimitationReason:limitation}],
 ['transport',{type:'transport',selectedCandidatePairId:'pair'}],['pair',{availableOutgoingBitrate:capacity,currentRoundTripTime:rtt}],['remote',{id:'remote',packetsLost:lost}]
]);}
test('automatic quality drops under actual sustained bandwidth pressure with a stable ceiling',()=>{
 const policy=new QualityPolicy(PROFILES);policy.sample(stats({capacity:2000000,sent:100,limitation:'bandwidth'}),0);
 const plan=policy.sample(stats({capacity:2000000,sent:200,limitation:'bandwidth'}),2000);
 assert.equal(plan.name,'speed');assert.equal(plan.bitrate,PROFILES.speed.bitrate);
});
test('high capacity upgrades slowly, while a low-traffic desktop does not masquerade as a speed test',()=>{
 const idle=new QualityPolicy(PROFILES);for(let n=0;n<30;n++)idle.sample(stats({sent:100}),n*2000);assert.equal(idle.name,'balanced');
 const active=new QualityPolicy(PROFILES);for(let n=0;n<6;n++)active.sample(stats({sent:n*100}),n*2000);assert.equal(active.name,'quality');
 active.sample(stats({sent:700}),12000);assert.equal(active.name,'quality');
});
test('loss/added latency/cpu pressure cause backoff even when nominal capacity is high',()=>{
 for(const bad of [{rtt:.9},{lost:30},{limitation:'cpu'}]){
  const policy=new QualityPolicy(PROFILES);policy.sample(stats({sent:100}),0);
  policy.sample(stats({sent:200,...bad}),2000);policy.sample(stats({sent:300,...bad}),4000);
  assert.notEqual(policy.name,'balanced');
 }
});

test('startup estimates and a constant VPN latency do not throttle a healthy stream',()=>{
 const policy=new QualityPolicy(PROFILES);
 for(let n=0;n<30;n++){
  const plan=policy.sample(stats({capacity:3000000,rtt:.8,sent:n*100}),n*2000);
  assert.equal(plan.name,'balanced');assert.equal(plan.bitrate,PROFILES.balanced.bitrate);
 }
});

test('a capped estimate cannot ratchet the ceiling down and recovered traffic can probe up',()=>{
 const policy=new QualityPolicy(PROFILES);policy.reset('economy');
 for(let n=0;n<11;n++)policy.sample(stats({capacity:PROFILES.economy.bitrate,sent:n*100}),n*2000);
 assert.equal(policy.name,'speed');
});

test('packet queue deltas lower quality without mistaking cumulative counters for current pressure',()=>{
 for(const counter of ['totalPacketSendDelay']){
  const policy=new QualityPolicy(PROFILES);
  for(let n=0;n<3;n++){
   const report=stats({sent:n*100});Object.assign(report.get('video'),{framesEncoded:n*60,totalEncodeTime:n*.2,totalPacketSendDelay:0,[counter]:n*10});
   policy.sample(report,n*2000);
  }
  assert.notEqual(policy.name,'balanced');
 }
});

test('pipelined hardware encode duration alone does not halve capture frame rate',()=>{
 const policy=new QualityPolicy(PROFILES);
 for(let n=0;n<10;n++){
  const report=stats({capacity:5000000,sent:n*100});Object.assign(report.get('video'),{framesEncoded:n*100,totalEncodeTime:n*4});policy.sample(report,n*2000);
 }
 assert.equal(policy.name,'balanced');
});

test('automatic high detail prioritizes motion; manual high detail retains resolution',async()=>{
 const values=[],track={readyState:'live',async applyConstraints(){}},sender={getParameters:()=>({encodings:[{}]}),async setParameters(p){values.push(p.degradationPreference);}};
 const quality=new StreamQuality({profiles:PROFILES,peer:{},stream:{getVideoTracks:()=>[track]},sender});
 await quality.apply('quality',PROFILES.quality.bitrate);assert.equal(track.contentHint,'motion');assert.equal(values.at(-1),'maintain-framerate');
 await quality.setMode(false,'quality');assert.equal(track.contentHint,'detail');assert.equal(values.at(-1),'maintain-resolution');quality.stop();
});
test('missing optional WebRTC estimates do not force an idle downgrade',()=>{
 const policy=new QualityPolicy(PROFILES);const report=stats({capacity:undefined});report.get('pair').availableOutgoingBitrate=undefined;
 for(let n=0;n<20;n++)policy.sample(report,n*2000);assert.equal(policy.name,'balanced');
});
test('fixed quality overrides pending automatic work, survives polls, and serializes sender changes',async()=>{
 const applied=[],track={readyState:'live',async applyConstraints(){await new Promise(r=>setTimeout(r,5));}},sender={getParameters:()=>({encodings:[{}]}),async setParameters(p){applied.push(p.encodings[0].maxBitrate);}};
 const quality=new StreamQuality({profiles:PROFILES,peer:{connectionState:'connected',getStats:async()=>stats()},stream:{getVideoTracks:()=>[track]},sender});
 const old=quality.apply('quality',40000000),manual=quality.setMode(false,'economy');await Promise.all([old,manual]);
 await quality.poll();assert.equal(quality.name,'economy');assert.equal(applied.at(-1),2500000);assert.equal(quality.automatic,false);
 quality.stop();await quality.apply('lan',100000000);assert.equal(applied.at(-1),2500000);
});
