'use strict';
const path=require('node:path');
function createNotifications({BrowserWindow,ipcMain,screen,language=()=> 'en'}){
  const entries=new Map(),waiting=[];
  function entry(event){const record=entries.get(event.sender.id);if(!record||event.senderFrame!==event.sender.mainFrame)throw new Error('Unauthorized notification.');return record;}
  ipcMain.handle('notice-info',event=>entry(event).data);
  ipcMain.on('notice-answer',(event,index)=>{const record=entry(event);if(Number.isInteger(index)&&index>=0&&index<record.data.buttons.length)record.finish(index);});
  function position(){let offset=16;const area=screen.getPrimaryDisplay().workArea;for(const {win}of entries.values()){if(win.isDestroyed())continue;win.setPosition(area.x+16,Math.max(area.y+8,area.y+area.height-230-offset));offset+=242;}}
  function showMessageBox(owner,options){
    if(options.type==='question'){const informational=[...entries.values()].find(entry=>!entry.data.urgent||(options.priority==='critical'&&entry.data.priority!=='critical'));if(informational)informational.finish(0,options.priority!=='critical');}
    if(entries.size>=Math.max(1,Math.floor(screen.getPrimaryDisplay().workArea.height/242))){
      if(options.type!=='question'||waiting.length>=16)return Promise.resolve({response:options.cancelId||0});
      return new Promise(resolve=>{const task={owner,options,resolve};const cancel=()=>{const index=waiting.indexOf(task);if(index<0)return;waiting.splice(index,1);clearTimeout(task.timer);owner?.removeListener('closed',cancel);resolve({response:options.cancelId||0});};task.cancel=cancel;task.timer=setTimeout(cancel,60000);owner?.once('closed',cancel);if(options.priority==='critical')waiting.unshift(task);else waiting.push(task);});
    }
    return new Promise(resolve=>{
      const data={title:String(options.title||'Shatoot Connect').slice(0,100),message:String(options.message||'').slice(0,300),detail:String(options.detail||'').slice(0,1600),buttons:(options.buttons||['Close']).slice(0,4),language:options.language||language(),urgent:options.type==='question',priority:options.priority};
      const win=new BrowserWindow({width:420,height:230,show:false,frame:false,resizable:false,skipTaskbar:true,alwaysOnTop:true,backgroundColor:'#1c102a',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
      const id=win.webContents.id;let done=false,timer;
      const close=()=>finish(options.cancelId||0);
      function finish(response,drain=true){if(done)return;done=true;clearTimeout(timer);entries.delete(id);owner?.removeListener('closed',close);if(!win.isDestroyed())win.destroy();position();resolve({response});const task=drain?waiting.shift():null;if(task){clearTimeout(task.timer);task.owner?.removeListener('closed',task.cancel);showMessageBox(task.owner,task.options).then(task.resolve);}}
      entries.set(id,{win,owner,data,finish});owner?.once('closed',close);win.on('closed',close);win.setContentProtection(true);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
      win.once('ready-to-show',()=>{if(done)return;position();win.setAlwaysOnTop(true,'screen-saver');win.showInactive();});
      timer=setTimeout(close,options.timeout||(data.urgent?60000:6500));win.loadFile(path.join(__dirname,'ui/notification.html'));
    });
  }
  return {showMessageBox,toast:(owner,message)=>showMessageBox(owner,{message,buttons:['Close']}),entries,cancelFor:(owner,priority)=>{for(const task of [...waiting])if(task.owner===owner&&task.options.priority===priority)task.cancel();for(const entry of [...entries.values()])if(entry.owner===owner&&entry.data.priority===priority)entry.finish(0);},close:()=>{for(const task of [...waiting])task.cancel();for(const entry of [...entries.values()])entry.finish(0);}};
}
module.exports={createNotifications};
