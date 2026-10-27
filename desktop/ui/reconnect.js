'use strict';
class SessionReconnect {
 constructor({connect,changed=()=>{},timer=(fn,delay)=>setTimeout(fn,delay),clear=id=>clearTimeout(id),now=()=>Date.now()}){Object.assign(this,{connect,changed,timer,clear,now});this.generation=0;this.state='idle';}
 arm(target){this.cancel();this.target={...target};this.wanted=true;this.established=false;this.attempts=0;this.state='joining';}
 connected(){if(!this.wanted)return;this.clear(this.pending);this.pending=null;this.established=true;this.attempts=0;this.state='connected';this.changed(this.snapshot());}
 interrupted(minimum=0){if(!this.wanted||!this.established||this.pending)return false;this.state='waiting';const delay=Math.max(minimum,Math.min(30000,2000*2**Math.min(4,this.attempts++)));this.nextAt=this.now()+delay;const generation=this.generation;this.pending=this.timer(()=>{this.pending=null;if(generation!==this.generation||!this.wanted)return;this.state='joining';this.changed(this.snapshot());Promise.resolve().then(()=>this.connect({...this.target})).catch(()=>{if(generation===this.generation)this.interrupted();});},delay);this.changed(this.snapshot());return true;}
 retryNow(){if(!this.wanted||!this.established||this.state!=='waiting')return;this.clear(this.pending);this.pending=null;this.nextAt=this.now();const generation=this.generation;this.state='joining';this.changed(this.snapshot());Promise.resolve().then(()=>this.connect({...this.target})).catch(()=>{if(generation===this.generation)this.interrupted();});}
 cancel(){this.generation++;this.clear(this.pending);this.pending=null;this.wanted=false;this.established=false;this.state='idle';this.changed(this.snapshot());}
 snapshot(){return{state:this.state,attempts:this.attempts,nextAt:this.nextAt};}
}
if(typeof module!=='undefined')module.exports={SessionReconnect};else window.SessionReconnect=SessionReconnect;
