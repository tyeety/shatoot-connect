'use strict';
// Shared by the primary desktop sender and each additional viewer's sender.
(function(root){
  // Automatic-only rungs: keep saved/manual presets and the wire protocol stable.
  // Ceilings deliberately leave congestion control room to probe upwards.
  function automaticProfiles(profiles){return {
    ...profiles,
    survival:{width:640,height:360,fps:8,bitrate:250000},
    narrow:{width:960,height:540,fps:12,bitrate:900000},
    mobile:{width:1280,height:720,fps:15,bitrate:2000000},
    economy:{...profiles.economy,width:1920,height:1080,fps:20,bitrate:4000000}
  };}
  const floors={survival:50000,narrow:180000,mobile:500000,economy:1000000,balanced:2500000,quality:12000000,lan:35000000};
  class QualityPolicy {
    constructor(profiles){this.profiles=automaticProfiles(profiles);this.order=['survival','narrow','mobile','economy','balanced','quality','lan'].filter(n=>this.profiles[n]);this.reset('balanced');}
    reset(name){this.name=this.order.includes(name)?name:'balanced';this.badSince=null;this.goodSince=null;this.lastChange=-Infinity;this.previous=null;this.baseRtt=null;this.pathId=null;this.cpuFps=null;this.cpuSince=null;this.cpuRecovered=null;this.lastCpuChange=-Infinity;}
    sample(report,at,receiver){
      let video,pair,remote;
      for(const s of report.values()){
        if(s.type==='outbound-rtp'&&s.kind==='video'&&!s.isRemote)video=s;
        if(s.type==='transport'&&s.selectedCandidatePairId)pair=report.get(s.selectedCandidatePairId);
      }
      if(!video)return null;
      pair||=[...report.values()].find(s=>s.type==='candidate-pair'&&s.nominated&&s.state==='succeeded');
      if(pair?.id&&pair.id!==this.pathId){this.pathId=pair.id;this.baseRtt=null;this.badSince=this.goodSince=null;}
      remote=report.get(video.remoteId);
      const capacity=Number.isFinite(pair?.availableOutgoingBitrate)&&pair.availableOutgoingBitrate>0?pair.availableOutgoingBitrate:null;
      const rtt=pair?.currentRoundTripTime??remote?.roundTripTime;
      const previous=this.previous?.id===video.id?this.previous:null;
      const sent=previous?Math.max(0,video.packetsSent-previous.sent):0;
      const freshRemote=previous&&previous.remote===remote?.id&&(remote?.timestamp===undefined||remote.timestamp!==previous.remoteAt);
      const lost=freshRemote?Math.max(0,(remote?.packetsLost||0)-previous.lost):0;
      const lossSent=(previous?.lossSent||0)+sent;
      const queueMs=sent>0&&video.totalPacketSendDelay!==undefined&&previous?.queue!==undefined?Math.max(0,video.totalPacketSendDelay-previous.queue)*1000/sent:0;
      this.previous={id:video.id,remote:remote?.id,sent:video.packetsSent||0,lost:remote?.packetsLost||0,remoteAt:remote?.timestamp,lossSent:freshRemote?0:lossSent,queue:video.totalPacketSendDelay,at};
      if(Number.isFinite(rtt)&&rtt>0)this.baseRtt=this.baseRtt===null?rtt:Math.min(this.baseRtt,rtt);
      const loss=lossSent+lost>=20?lost/(lossSent+lost):0,index=this.order.indexOf(this.name),current=this.profiles[this.name];
      // BWE is an estimate, not a throughput test. In particular, a static
      // desktop/startup probe can be far below the nominal profile ceiling.
      // Lower capture quality only for actual pressure; WebRTC owns pacing.
      const latencyPressure=this.baseRtt!==null&&Number.isFinite(rtt)&&rtt-this.baseRtt>Math.max(.08,this.baseRtt*.5);
      // Hardware encoders pipeline frames: average encode duration alone does
      // not prove throughput pressure. Use the encoder's actual CPU signal.
      const cpu=video.qualityLimitationReason==='cpu'||receiver&&at-receiver.at<2500&&receiver.fps>0&&receiver.dropRatio>.08&&receiver.decodeMs>800/current.fps;
      // Packet rates, not poll counts: changing the sampling interval must not
      // turn idle screens into speed tests or alter the recovery hysteresis.
      const active=previous&&at>previous.at&&sent*1000/(at-previous.at)>=10;
      const scarce=active&&capacity!==null&&capacity<floors[this.name]*(video.qualityLimitationReason==='bandwidth'?1:.7);
      // CPU pressure is independent of packet rate (static desktops send few
      // packets). Reduce capture AND encoder FPS before sacrificing text detail.
      if(cpu){
        this.cpuRecovered=null;this.cpuSince??=at;
        if(at-this.cpuSince>=500&&at-this.lastCpuChange>=1500){
          const fps=Math.min(current.fps,this.cpuFps??current.fps);
          if(fps>10){this.cpuFps=Math.max(10,Math.floor(fps/2));this.lastCpuChange=at;}
        }
      }else{
        this.cpuSince=null;this.cpuRecovered??=at;
        if(this.cpuFps!==null&&at-this.cpuRecovered>=8000&&at-this.lastCpuChange>=3000){
          this.cpuFps+=5;this.lastCpuChange=at;if(this.cpuFps>=current.fps)this.cpuFps=null;
        }
      }
      const cpuExhausted=cpu&&this.cpuFps!==null&&this.cpuFps<=10&&at-this.lastCpuChange>=3000;
      const overloaded=active&&(loss>.035||queueMs>70||latencyPressure)||cpuExhausted;
      const congested=overloaded||scarce;
      const severe=active&&(loss>.12||queueMs>120||scarce&&capacity<500000);
      this.badSince=congested?(this.badSince??at):null;
      this.goodSince=active&&!congested&&!cpu&&this.cpuFps===null&&capacity!==null?(this.goodSince??at):null;
      let next=index;
      if(index>0&&(severe||this.badSince!==null&&at-this.badSince>=500)&&at-this.lastChange>=1000){
        next=index-1;
        if(capacity!==null&&(scarce||video.qualityLimitationReason==='bandwidth'))while(next>0&&floors[this.order[next]]>capacity*.8)next--;
      }else if(index<this.order.length-1&&this.goodSince!==null&&at-this.lastChange>=4000){
        // Probe up one tier after sustained active traffic. Idle screens are not
        // throughput tests; absence of sent packets never proves spare capacity.
        const stable=at-this.goodSince;
        // Do not upgrade on the next tier's emergency floor: that can select
        // a multi-megabit encoder on a 1 Mbps path, trigger a keyframe burst,
        // and immediately fall back again. Keep the bitrate ceiling stable.
        const enough=capacity>=Math.max(floors[this.order[index+1]]*1.3,this.profiles[this.order[index+1]].bitrate*.8);
        if(stable>=4000&&enough)next=index+1;
        // A verified clean high-capacity path can skip redundant warmup tiers.
        // RTT alone never classifies a routed VPN as a fast LAN.
        if(stable>=1000&&rtt>0&&rtt<.035&&capacity>=20000000){
          while(next<this.order.length-1&&capacity>=Math.max(floors[this.order[next+1]]*1.3,this.profiles[this.order[next+1]].bitrate*.8))next++;
        }
      }
      if(next!==index){this.name=this.order[next];this.lastChange=at;this.badSince=this.goodSince=null;}
      const ceiling=this.profiles[this.name].bitrate;
      // Repeatedly imposing 85% of BWE creates an application-side ratchet:
      // the transport measures our own limit and the next poll cuts it again.
      // Keep a stable ceiling so congestion control can probe and recover.
      // Probe bandwidth headroom without resizing capture (and forcing a large
      // keyframe). A successful estimate, rather than the probe itself, may
      // upgrade resolution on a subsequent sample.
      const nextProfile=this.profiles[this.order[this.order.indexOf(this.name)+1]];
      const probe=nextProfile&&this.goodSince!==null&&at-this.goodSince>=10000&&capacity>=ceiling*.85;
      return {name:this.name,bitrate:probe?nextProfile.bitrate:ceiling,fps:Math.min(this.profiles[this.name].fps,this.cpuFps??Infinity)};
    }
  }
  class StreamQuality {
    constructor({profiles,peer,stream,sender,automatic=true,profile='balanced',onChange=()=>{},onError=()=>{}}){
      Object.assign(this,{profiles,peer,stream,sender,onChange,onError});this.policy=new QualityPolicy(profiles);this.queue=Promise.resolve();this.revision=0;this.stopped=false;this.active=true;this.automatic=this.lastAutomatic=automatic;this.manual=profiles[profile]?profile:'speed';this.name=automatic?'balanced':this.manual;
    }
    start(){this.policy.reset(this.name);this.timer=setInterval(()=>this.poll(),500);return this.apply(this.name,this.profiles[this.name].bitrate);}
    setActive(active){if(this.active===active)return;this.active=active;if(active){this.policy.reset(this.name);if(this.automatic&&this.fps<this.policy.profiles[this.name].fps)this.policy.cpuFps=this.fps;}this.receiver=null;this.revision++;return this.apply(this.name,this.bitrate||this.profiles[this.name]?.bitrate,this.fps).catch(this.onError);}
    feedback(value){
      if(!value||!Number.isFinite(value.fps)||value.fps<0||value.fps>240||!Number.isFinite(value.decodeMs)||value.decodeMs<0||value.decodeMs>10000||!Number.isFinite(value.dropRatio)||value.dropRatio<0||value.dropRatio>1)return;
      this.receiver={fps:value.fps,decodeMs:value.decodeMs,dropRatio:value.dropRatio,at:performance.now()};
    }
    setMode(automatic,name){
      this.automatic=automatic===true;if(this.profiles[name])this.manual=name;
      const next=this.automatic?(this.automatic===this.lastAutomatic?this.name:'balanced'):this.manual;
      this.lastAutomatic=this.automatic;this.revision++;this.policy.reset(next);return this.apply(next,(this.automatic?this.policy.profiles:this.profiles)[next].bitrate);
    }
    apply(name,bitrate,fps){
      const revision=this.revision;
      const task=this.queue.catch(()=>{}).then(async()=>{
        if(this.stopped||revision!==this.revision)return;
        const p=(this.automatic?this.policy.profiles:this.profiles)[name],track=this.stream.getVideoTracks()[0];if(!p||!track||track.readyState==='ended')return;
        const frameRate=this.active?Math.min(p.fps,fps??p.fps):3;
        if(this.appliedFps!==frameRate||this.appliedName!==name||this.appliedAutomatic!==this.automatic||this.appliedActive!==this.active){
          track.contentHint=name==='survival'?'motion':'detail';
          // Raising only a maximum permits Chromium to keep the old small
          // capture forever after recovery. Request the desired size as well.
          await track.applyConstraints({width:{ideal:p.width,max:p.width},height:{ideal:p.height,max:p.height},frameRate:{ideal:frameRate,max:frameRate}});
        }
        if(this.stopped||revision!==this.revision)return;
        const params=this.sender.getParameters();if(!params.encodings?.length)params.encodings=[{}];
        Object.assign(params.encodings[0],{maxBitrate:bitrate,maxFramerate:frameRate,priority:'high',networkPriority:'high'});
        params.degradationPreference=name==='survival'?'maintain-framerate':'maintain-resolution';
        await this.sender.setParameters(params);
        if(this.stopped||revision!==this.revision)return;
        this.name=this.appliedName=name;this.appliedAutomatic=this.automatic;this.appliedActive=this.active;this.bitrate=bitrate;this.fps=Math.min(p.fps,fps??p.fps);this.appliedFps=frameRate;this.onChange({automatic:this.automatic,name,bitrate,fps:this.fps});
      });this.queue=task;return task;
    }
    async poll(){
      if(this.stopped||!this.active||!this.automatic||this.polling||this.peer.connectionState!=='connected')return;
      this.polling=true;const revision=this.revision;
      try{
        const report=await this.peer.getStats();if(this.stopped||revision!==this.revision||!this.automatic)return;
        const plan=this.policy.sample(report,performance.now(),this.receiver);
        if(plan&&(plan.name!==this.appliedName||plan.fps!==this.fps||Math.abs(plan.bitrate-(this.bitrate||0))>Math.max(150000,(this.bitrate||0)*.2)))await this.apply(plan.name,plan.bitrate,plan.fps);
      }catch(error){if(!this.stopped)this.onError(error);}finally{this.polling=false;}
    }
    stop(){this.stopped=true;this.revision++;clearInterval(this.timer);}
  }
  const exported={QualityPolicy,StreamQuality};if(typeof module!=='undefined')module.exports=exported;else Object.assign(root,exported);
})(globalThis);
