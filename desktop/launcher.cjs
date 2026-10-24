'use strict';
const fs=require('node:fs'),path=require('node:path');
const {newer}=require('./updater.cjs');
class Launcher{
  constructor({directory,script=path.join(__dirname,'launcher.ps1'),icon,powershell}){Object.assign(this,{directory,script,icon,powershell});}
  register(target,version){
    target=path.resolve(target);if(path.extname(target).toLowerCase()!=='.exe'||!fs.existsSync(target))throw new Error('The application executable is missing.');
    fs.mkdirSync(this.directory,{recursive:true});let previous={};try{previous=JSON.parse(fs.readFileSync(path.join(this.directory,'launcher.json'),'utf8'))}catch{}
    if(previous.version&&newer(previous.version,version)&&typeof previous.target==='string'&&fs.existsSync(previous.target)){this.record=previous;return previous;}
    const record={target,version,previous:[...new Set([previous.target,...(previous.previous||[])].filter(p=>typeof p==='string'&&p!==target))].slice(0,16)};
    fs.copyFileSync(this.script,path.join(this.directory,'launcher.ps1'));if(this.icon&&fs.existsSync(this.icon))fs.copyFileSync(this.icon,path.join(this.directory,'launcher.ico'));
    const file=path.join(this.directory,'launcher.json');fs.writeFileSync(file+'.tmp',JSON.stringify(record),{mode:0o600});fs.renameSync(file+'.tmp',file);this.record=record;return record;
  }
  link({favorite,startInTray=false}={}){
    if(favorite&&!/^[a-f0-9-]{36}$/.test(favorite))throw new Error('Invalid saved computer.');
    return{target:this.powershell,cwd:this.directory,args:`-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${path.join(this.directory,'launcher.ps1')}"${favorite?` -Favorite ${favorite}`:''}${startInTray?' -StartInTray':''}`,icon:path.join(this.directory,'launcher.ico'),iconIndex:0};
  }
  repair(desktop,shell){
    const record=this.record;if(!record||!fs.existsSync(desktop))return;
    const known=[record.target,...(record.previous||[])].map(value=>path.resolve(value).toLowerCase());
    for(const name of fs.readdirSync(desktop))if(name.toLowerCase().endsWith('.lnk'))try{
      const file=path.join(desktop,name),link=shell.readShortcutLink(file);if(!known.includes(path.resolve(link.target).toLowerCase()))continue;
      const args=(link.args||'').trim(),favorite=args.match(/^--connect-saved=([a-f0-9-]{36})$/)?.[1];if(args&&!favorite&&args!=='--start-in-tray')continue;
      shell.writeShortcutLink(file,'update',{...this.link({favorite,startInTray:args==='--start-in-tray'}),description:link.description||'Shatoot Connect'});
    }catch{}
  }
}
module.exports={Launcher};
