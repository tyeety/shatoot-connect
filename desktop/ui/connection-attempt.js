'use strict';
window.ConnectionAttempt=class{
  constructor(){this.controller=new AbortController();}
  get cancelled(){return this.controller.signal.aborted;}
  check(){if(this.cancelled)throw new DOMException('Connection cancelled.','AbortError');}
  cancel(){this.controller.abort();}
  async wait(promise){
    this.check();let cancel;
    const aborted=new Promise((_,reject)=>{cancel=()=>reject(new DOMException('Connection cancelled.','AbortError'));this.controller.signal.addEventListener('abort',cancel,{once:true});});
    try{const result=await Promise.race([promise,aborted]);this.check();return result;}finally{this.controller.signal.removeEventListener('abort',cancel);}
  }
};
