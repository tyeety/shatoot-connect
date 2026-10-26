'use strict';
// Shared by the primary desktop sender and each additional viewer's sender.
(function(root){
  class QualityPolicy {
    constructor(profiles){this.profiles=profiles;this.order=['economy','speed','balanced','quality','lan'].filter(n=>profiles[n]);this.reset('balanced');}
    reset(name){this.name=this.profiles[name]?name:'balanced';this.bad=0;this.good=0;this.lastChange=-Infinity;this.previous=null;this.baseRtt=null;}
    sample(report,at){
      let video,pair,remote;
      for(const s of report.values()){
        if(s.type==='outbound-rtp'&&s.kind==='video'&&!s.isRemote)video=s;
        if(s.type==='transport'&&s.selectedCandidatePairId)pair=report.get(s.selectedCandidatePairId);
      }
      if(!video)return null;
      pair||=[...report.values()].find(s=>s.type==='candidate-pair'&&s.nominated&&s.state==='succeeded');
      remote=report.get(video.remoteId);
      const capacity=Number.isFinite(pair?.availableOutgoingBitrate)&&pair.availableOutgoingBitrate>0?pair.availableOutgoingBitrate:null;
      const rtt=pair?.currentRoundTripTime??remote?.roundTripTime;
      const sent=this.previous&&this.previous.id===video.id?Math.max(0,video.packetsSent-this.previous.sent):0;
      const lost=this.previous&&this.previous.remote===remote?.id?Math.max(0,(remote?.packetsLost||0)-this.previous.lost):0;
      const queueMs=sent>0&&video.totalPacketSendDelay!==undefined&&this.previous?.queue!==undefined?Math.max(0,video.totalPacketSendDelay-this.previous.queue)*1000/sent:0;
      this.previous={id:video.id,remote:remote?.id,sent:video.packetsSent||0,lost:remote?.packetsLost||0,queue:video.totalPacketSendDelay};
      if(Number.isFinite(rtt)&&rtt>0)this.baseRtt=this.baseRtt===null?rtt:Math.min(this.baseRtt,rtt);
      const loss=sent>0?lost/sent:0,index=this.order.indexOf(this.name),current=this.profiles[this.name];
      // BWE is an estimate, not a throughput test. In particular, a static
      // desktop/startup probe can be far below the nominal profile ceiling.
      // Lower capture quality only for actual pressure; WebRTC owns pacing.
      const latencyPressure=this.baseRtt!==null&&Number.isFinite(rtt)&&rtt-this.baseRtt>Math.max(.08,this.baseRtt*.5);
      // Hardware encoders pipeline frames: average encode duration alone does
      // not prove throughput pressure. Use the encoder's actual CPU signal.
      const cpu=video.qualityLimitationReason==='cpu';
      const congested=loss>.035||queueMs>40||latencyPressure||cpu||video.qualityLimitationReason==='bandwidth';
      const severe=loss>.12||queueMs>150||capacity!==null&&capacity<1000000;
      this.bad=congested?this.bad+1:0;
      this.good=!congested&&!severe&&sent>=20&&capacity!==null?this.good+1:0;
      let next=index;
      if(index>0&&(severe||this.bad>=2)&&(severe||at-this.lastChange>=6000)){
        next=index-1;
        if(severe)while(next>0&&capacity!==null&&this.profiles[this.order[next]].bitrate>capacity*.85)next--;
      }else if(index<this.order.length-1&&this.good>=5&&at-this.lastChange>=10000){
        // Probe up one tier after sustained active traffic. Idle screens are not
        // throughput tests; absence of sent packets never proves spare capacity.
        const enough=capacity>=this.profiles[this.order[index+1]].bitrate*1.2;
        const probe=this.good>=10&&capacity>=current.bitrate*.9;
        if(enough||probe)next=index+1;
      }
      if(next!==index){this.name=this.order[next];this.lastChange=at;this.bad=this.good=0;}
      const ceiling=this.profiles[this.name].bitrate;
      // Repeatedly imposing 85% of BWE creates an application-side ratchet:
      // the transport measures our own limit and the next poll cuts it again.
      // Keep a stable ceiling so congestion control can probe and recover.
      return {name:this.name,bitrate:ceiling};
    }
  }
  class StreamQuality {
    constructor({profiles,peer,stream,sender,automatic=true,profile='balanced',onChange=()=>{},onError=()=>{}}){
      Object.assign(this,{profiles,peer,stream,sender,onChange,onError});this.policy=new QualityPolicy(profiles);this.queue=Promise.resolve();this.revision=0;this.stopped=false;this.automatic=this.lastAutomatic=automatic;this.manual=profiles[profile]?profile:'speed';this.name=automatic?'balanced':this.manual;
    }
    start(){this.policy.reset(this.name);this.timer=setInterval(()=>this.poll(),2000);return this.apply(this.name,this.profiles[this.name].bitrate);}
    setMode(automatic,name){
      this.automatic=automatic===true;if(this.profiles[name])this.manual=name;
      const next=this.automatic?(this.automatic===this.lastAutomatic?this.name:'balanced'):this.manual;
      this.lastAutomatic=this.automatic;this.revision++;this.policy.reset(next);return this.apply(next,this.profiles[next].bitrate);
    }
    apply(name,bitrate){
      const revision=this.revision;
      const task=this.queue.catch(()=>{}).then(async()=>{
        if(this.stopped||revision!==this.revision)return;
        const p=this.profiles[name],track=this.stream.getVideoTracks()[0];if(!p||!track||track.readyState==='ended')return;
        if(this.appliedName!==name||this.appliedAutomatic!==this.automatic){
          track.contentHint=!this.automatic&&['quality','lan'].includes(name)?'detail':'motion';
          await track.applyConstraints({width:{max:p.width},height:{max:p.height},frameRate:{ideal:p.fps,max:p.fps}});
        }
        if(this.stopped||revision!==this.revision)return;
        const params=this.sender.getParameters();if(!params.encodings?.length)params.encodings=[{}];
        Object.assign(params.encodings[0],{maxBitrate:bitrate,maxFramerate:p.fps,priority:'high',networkPriority:'high'});
        params.degradationPreference=!this.automatic&&['quality','lan'].includes(name)?'maintain-resolution':'maintain-framerate';
        await this.sender.setParameters(params);
        if(this.stopped||revision!==this.revision)return;
        this.name=this.appliedName=name;this.appliedAutomatic=this.automatic;this.bitrate=bitrate;this.onChange({automatic:this.automatic,name,bitrate});
      });this.queue=task;return task;
    }
    async poll(){
      if(this.stopped||!this.automatic||this.polling||this.peer.connectionState!=='connected')return;
      this.polling=true;const revision=this.revision;
      try{
        const report=await this.peer.getStats();if(this.stopped||revision!==this.revision||!this.automatic)return;
        const plan=this.policy.sample(report,Date.now());
        if(plan&&(plan.name!==this.appliedName||Math.abs(plan.bitrate-(this.bitrate||0))>Math.max(150000,(this.bitrate||0)*.2)))await this.apply(plan.name,plan.bitrate);
      }catch(error){if(!this.stopped)this.onError(error);}finally{this.polling=false;}
    }
    stop(){this.stopped=true;this.revision++;clearInterval(this.timer);}
  }
  const exported={QualityPolicy,StreamQuality};if(typeof module!=='undefined')module.exports=exported;else Object.assign(root,exported);
})(globalThis);
