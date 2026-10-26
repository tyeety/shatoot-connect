'use strict';
const path=require('node:path');
// Opaque physical-monitor covers excluded from Windows capture. Never power off
// displays, lock Windows, block physical input, or change the display topology.
class DisplayPrivacy {
  constructor({BrowserWindow,screen,supported,escapeAvailable,now=Date.now,timers=globalThis,changed=()=>{},lease=6500}){
    Object.assign(this,{BrowserWindow,screen,supported,escapeAvailable,now,timers,changed,lease});this.owners=new Map();this.windows=new Map();this.sync=()=>{try{this.rebuild();}catch{this.clear('error');}};
    for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,this.sync);
    this.ticker=timers.setInterval(()=>this.tick(),500);this.ticker.unref?.();
  }
  status(owner){return {active:this.owners.has(owner)};}
  request(owner,active){
    if(typeof active!=='boolean')throw Error('Invalid privacy screen request.');
    if(!active){this.release(owner);return this.status(owner);}
    if(!this.supported()||!this.escapeAvailable())throw Error('Privacy screen is unavailable on this computer.');
    const first=!this.owners.has(owner);this.owners.set(owner,this.now()+this.lease);
    try{this.rebuild();}catch(error){this.clear('error');throw error;}
    if(first)this.changed(owner,'active');return this.status(owner);
  }
  rebuild(){
    if(!this.owners.size)return;
    const displays=this.screen.getAllDisplays();
    for(const [id,win]of this.windows)if(!displays.some(d=>d.id===id)){this.windows.delete(id);if(!win.isDestroyed())win.destroy();}
    for(const display of displays){
      let win=this.windows.get(display.id);
      if(win&&!win.isDestroyed()){win.setBounds(display.bounds);continue;}
      win=new this.BrowserWindow({...display.bounds,show:false,frame:false,backgroundColor:'#000000',resizable:false,movable:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,fullscreenable:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}});
      this.windows.set(display.id,win);win.setContentProtection(true);win.setIgnoreMouseEvents(true);win.setAlwaysOnTop(true,'screen-saver');
      win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
      win.webContents.on('render-process-gone',()=>this.clear('error'));win.on('unresponsive',()=>this.clear('error'));
      win.on('closed',()=>{if(this.windows.get(display.id)===win){this.windows.delete(display.id);this.clear('closed');}});
      win.once('ready-to-show',()=>{if(this.owners.size&&this.windows.get(display.id)===win&&!win.isDestroyed())win.showInactive();});
      win.loadFile(path.join(__dirname,'ui/display-privacy.html')).catch(()=>this.clear('error'));
    }
  }
  release(owner,reason='released'){
    if(!this.owners.delete(owner))return;
    if(!this.owners.size)this.removeWindows();this.changed(owner,reason);
  }
  removeWindows(){const windows=[...this.windows.values()];this.windows.clear();for(const win of windows)if(!win.isDestroyed())win.destroy();}
  clear(reason='emergency'){const owners=[...this.owners.keys()];this.owners.clear();this.removeWindows();for(const owner of owners)this.changed(owner,reason);}
  tick(){for(const[owner,deadline]of this.owners)if(deadline<=this.now()||owner.win?.isDestroyed())this.release(owner,'expired');}
  close(){this.clear('closed');this.timers.clearInterval(this.ticker);for(const event of ['display-added','display-removed','display-metrics-changed'])this.screen.removeListener(event,this.sync);}
}
module.exports={DisplayPrivacy};
