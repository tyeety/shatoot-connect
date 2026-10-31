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
 const settled=policy.sample(stats({capacity:2000000,sent:300,limitation:'bandwidth'}),2500);
 assert.equal(settled.name,'economy');assert.equal(settled.bitrate,policy.profiles.economy.bitrate);
});
test('high capacity upgrades slowly, while a low-traffic desktop does not masquerade as a speed test',()=>{
 const idle=new QualityPolicy(PROFILES);for(let n=0;n<30;n++)idle.sample(stats({sent:100}),n*2000);assert.equal(idle.name,'balanced');
 const active=new QualityPolicy(PROFILES);for(let n=0;n<6;n++)active.sample(stats({sent:n*100,rtt:.1,capacity:20000000}),n*1000);assert.equal(active.name,'quality');
 active.sample(stats({sent:700,rtt:.1,capacity:20000000}),6000);assert.equal(active.name,'quality');
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
 for(let n=0;n<11;n++)policy.sample(stats({capacity:policy.profiles.economy.bitrate,sent:n*100}),n*1000);
 assert.equal(policy.name,'balanced');
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

test('sub-megabit pressure jumps directly to a usable capture size within one second',()=>{
 for(const [capacity,name] of [[100000,'survival'],[256000,'narrow'],[700000,'mobile']]){
  const policy=new QualityPolicy(PROFILES);
  for(let n=0;n<=3;n++)policy.sample(stats({capacity,sent:n*30,limitation:'bandwidth'}),n*500);
  assert.equal(policy.name,name);
  assert.ok(policy.profiles[name].height<=540);
 }
});

test('idle low estimates never collapse resolution, and prolonged pressure has a floor',()=>{
 const idle=new QualityPolicy(PROFILES);
 for(let n=0;n<100;n++)idle.sample(stats({capacity:90000,sent:10,limitation:'bandwidth'}),n*500);
 assert.equal(idle.name,'balanced');
 const active=new QualityPolicy(PROFILES);
 for(let n=0;n<100;n++)active.sample(stats({capacity:90000,sent:n*30,limitation:'bandwidth'}),n*500);
 assert.equal(active.name,'survival');assert.equal(active.sample(stats({capacity:90000,sent:3100}),51000).bitrate,250000);
});

test('fast LAN skips warmup while recovered internet climbs without oscillation',()=>{
 const lan=new QualityPolicy(PROFILES);
 for(let n=0;n<=3;n++)lan.sample(stats({capacity:100000000,sent:n*30}),n*500);
 assert.equal(lan.name,'lan');
 const internet=new QualityPolicy(PROFILES);
 for(let n=0;n<6;n++)internet.sample(stats({capacity:100000,sent:n*30,rtt:.2,limitation:'bandwidth'}),n*500);
 assert.equal(internet.name,'survival');
 const upgrades=[];let last=internet.name;
 for(let n=6;n<=50;n++){
  internet.sample(stats({capacity:10000000,sent:n*30,rtt:.2}),n*500);
  if(last!==internet.name){upgrades.push(internet.name);last=internet.name;}
 }
 assert.deepEqual(upgrades,['narrow','mobile','economy','balanced']);
});

test('automatic low-bandwidth rungs do not change saved manual presets',async()=>{
 const sizes=[],params=[],track={readyState:'live',async applyConstraints(c){sizes.push(c);}},sender={getParameters:()=>({encodings:[{}]}),async setParameters(p){params.push(p);}};
 const quality=new StreamQuality({profiles:PROFILES,peer:{},stream:{getVideoTracks:()=>[track]},sender});
 await quality.apply('survival',250000);assert.equal(sizes.at(-1).height.max,270);assert.equal(params.at(-1).encodings[0].maxFramerate,30);
 await quality.setMode(false,'economy');assert.equal(sizes.at(-1).height.max,720);assert.equal(params.at(-1).encodings[0].maxFramerate,30);assert.equal(params.at(-1).encodings[0].maxBitrate,2500000);
 quality.stop();
});

test('receiver decode pressure adapts capture but stale or malformed feedback cannot',()=>{
 const policy=new QualityPolicy(PROFILES);
 for(let n=0;n<4;n++)policy.sample(stats({capacity:5000000,sent:n*50}),n*500,{fps:12,decodeMs:50,dropRatio:.4,at:n*500});
 assert.equal(policy.name,'economy');
 const recovered=new QualityPolicy(PROFILES);
 for(let n=0;n<5;n++)recovered.sample(stats({capacity:5000000,sent:n*50}),5000+n*500,{fps:12,decodeMs:50,dropRatio:.4,at:0});
 assert.equal(recovered.name,'balanced');
 const controller=new StreamQuality({profiles:PROFILES});
 for(const data of [null,{}, {fps:Infinity,decodeMs:50,dropRatio:.4},{fps:20,decodeMs:-1,dropRatio:.4},{fps:20,decodeMs:50,dropRatio:2}])controller.feedback(data);
 assert.equal(controller.receiver,undefined);controller.feedback({fps:20,decodeMs:50,dropRatio:.4});assert.equal(controller.receiver.fps,20);
});

test('delayed RTCP loss is divided by the packets sent over its own reporting interval',()=>{
 const policy=new QualityPolicy(PROFILES);
 for(let n=0;n<=8;n++){
  const report=stats({capacity:5000000,sent:n*20,lost:n===8?2:0});report.get('remote').timestamp=n===8?4000:0;
  policy.sample(report,n*500);
 }
 assert.equal(policy.name,'balanced');assert.equal(policy.badSince,null);
});

test('an ICE path change resets the latency baseline instead of treating a new VPN RTT as permanent congestion',()=>{
 const policy=new QualityPolicy(PROFILES);
 for(let n=0;n<8;n++){
  const report=stats({capacity:5000000,sent:n*40,rtt:n<3?.01:.2});report.get('pair').id=n<3?'lan':'vpn';policy.sample(report,n*500);
 }
 assert.equal(policy.name,'balanced');assert.equal(policy.baseRtt,.2);
});
