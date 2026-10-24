'use strict';
const path=require('node:path');
function createNotifications({BrowserWindow,ipcMain,screen,language=()=> 'en',activity=()=>true,now=Date.now,timers=globalThis}){
  const entries=new Map(),waiting=[],tasks=new Set(),reserved=new Map();
  const width=420,height=230,gap=12,margin=16;
  let closed=false,pumping=false,lastTick=now(),sequence=0,listening=false;
  const rank=task=>task.data.priority==='critical'?0:task.data.urgent?1:2;
  function entry(event){const record=entries.get(event.sender.id);if(!record||event.senderFrame!==event.sender.mainFrame)throw new Error('Unauthorized notification.');return record;}
  ipcMain.handle('notice-info',event=>entry(event).data);
  ipcMain.on('notice-answer',(event,index)=>{const record=entry(event);if(Number.isInteger(index)&&index>=0&&index<record.data.buttons.length)record.finish(index);});
  ipcMain.on('notice-hide',event=>{const record=entry(event);if(!record.data.urgent)record.finish(record.cancel);});
  ipcMain.on('notice-hover',(event,hovered)=>{const record=entry(event);record.hovered=hovered===true;if(record.hovered)stopFade(record);});
  function geometry(){
    if(!listening){for(const event of displays)screen.on?.(event,pump);listening=true;}
    const area=screen.getPrimaryDisplay().workArea;let bottom=area.y+area.height-margin;
    for(const win of reserved.keys())if(!win.isDestroyed()&&win.isVisible()){const b=win.getBounds();if(b.x<area.x+area.width&&b.x+b.width>area.x+area.width-width-margin&&b.y<bottom&&b.y+b.height>area.y)bottom=Math.min(bottom,b.y-gap);}
    bottom=Math.max(area.y+margin+height,bottom);
    return{x:area.x+area.width-width-margin,bottom,capacity:Math.max(1,Math.min(3,Math.floor((bottom-area.y-margin+gap)/(height+gap))))};
  }
  function position(){const{x,bottom}=geometry();let offset=0;for(const task of entries.values()){task.win.setPosition(x,bottom-height-offset);offset+=height+gap;}}
  function removeWindow(task){const win=task.win;task.win=null;task.visible=false;if(!win)return;entries.delete(win.webContents.id);if(!win.isDestroyed())win.destroy();}
  function stopFade(task){if(!task.fading)return;timers.clearTimeout(task.fadeTimer);task.fading=false;task.remaining=Math.max(2000,task.remaining);task.win?.webContents.send('notice-fade',false);}
  function finish(task,response){if(task.done)return;task.done=true;tasks.delete(task);timers.clearTimeout(task.deadline);timers.clearTimeout(task.fadeTimer);const index=waiting.indexOf(task);if(index>=0)waiting.splice(index,1);task.owner?.removeListener('closed',task.ownerClosed);removeWindow(task);task.resolve({response});pump();}
  function suspend(task){stopFade(task);removeWindow(task);waiting.push(task);}
  function present(task){
    const win=new BrowserWindow({width,height,show:false,frame:false,resizable:false,skipTaskbar:true,alwaysOnTop:true,transparent:true,backgroundColor:'#00000000',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
    task.win=win;entries.set(win.webContents.id,task);win.on('closed',()=>{if(task.win===win)task.finish(task.cancel);});win.setContentProtection(true);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
    win.once('ready-to-show',()=>{if(task.win!==win||task.done)return;position();win.setAlwaysOnTop(true,'screen-saver');win.showInactive();task.visible=true;});
    win.loadFile(path.join(__dirname,'ui/notification.html')).catch(()=>task.finish(task.cancel));
  }
  function pump(){
    if(closed||pumping)return;pumping=true;
    try{const capacity=geometry().capacity;while(entries.size>capacity)suspend([...entries.values()].at(-1));waiting.sort((a,b)=>rank(a)-rank(b)||a.sequence-b.sequence);
      const last=[...entries.values()].sort((a,b)=>rank(b)-rank(a)).find(task=>waiting[0]&&rank(task)>rank(waiting[0]));if(entries.size>=capacity&&last)suspend(last);
      waiting.sort((a,b)=>rank(a)-rank(b)||a.sequence-b.sequence);while(entries.size<capacity&&waiting.length)present(waiting.shift());position();
    }finally{pumping=false;}
  }
  function showMessageBox(owner,options={}){
    if(closed||owner?.isDestroyed())return Promise.resolve({response:options.cancelId||0});
    if(waiting.length>=64){const oldest=waiting.find(task=>!task.data.urgent);if(oldest)oldest.finish(oldest.cancel);else return Promise.resolve({response:options.cancelId||0});}
    return new Promise(resolve=>{const urgent=options.type==='question';const task={owner,resolve,cancel:options.cancelId||0,sequence:sequence++,remaining:options.timeout||6500,data:{title:String(options.title||'Shatoot Connect').slice(0,100),message:String(options.message||'').slice(0,300),detail:String(options.detail||'').slice(0,1600),buttons:(options.buttons||(urgent?['Close']:[])).slice(0,4),language:options.language||language(),urgent,priority:options.priority}};
      task.finish=response=>finish(task,response);task.ownerClosed=()=>task.finish(task.cancel);tasks.add(task);waiting.push(task);owner?.once('closed',task.ownerClosed);if(urgent)task.deadline=timers.setTimeout(task.ownerClosed,options.timeout||60000);pump();});
  }
  const ticker=timers.setInterval(()=>{const at=now(),elapsed=Math.max(0,Math.min(1000,at-lastTick));lastTick=at;const active=activity();for(const task of entries.values())if(!task.data.urgent&&task.visible){if(!active||task.hovered){stopFade(task);continue;}if(task.fading)continue;task.remaining-=elapsed;if(task.remaining<=0){task.fading=true;task.win.webContents.send('notice-fade',true);task.fadeTimer=timers.setTimeout(()=>task.finish(task.cancel),600);}}},200);ticker.unref?.();
  const displays=['display-metrics-changed','display-added','display-removed'];
  return{showMessageBox,toast:(owner,message,options={})=>showMessageBox(owner,{...options,message}),entries,
    reserve(win){if(reserved.has(win))return;const update=()=>{if(win.isDestroyed())reserved.delete(win);pump();};reserved.set(win,update);for(const event of ['show','hide','closed','move','resize'])win.on(event,update);pump();},
    cancelFor(owner,priority){for(const task of [...tasks])if(task.owner===owner&&task.data.priority===priority)task.finish(task.cancel);},
    close(){closed=true;timers.clearInterval(ticker);if(listening)for(const event of displays)screen.removeListener?.(event,pump);for(const[win,update]of reserved)for(const event of ['show','hide','closed','move','resize'])win.removeListener(event,update);reserved.clear();for(const task of [...tasks])task.finish(task.cancel);}};
}
module.exports={createNotifications};
