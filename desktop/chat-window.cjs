'use strict';
function configureChatWindow({win,Menu,icon,executable,appPath,packaged,platform=process.platform}){
  if(platform==='win32'){
    const quote=value=>'"'+value+'"';
    win.setAppDetails({appId:'com.shatootsoft.connect.chats',appIconPath:icon,appIconIndex:0,relaunchDisplayName:'Shatoot Connect Chats',relaunchCommand:[quote(executable),...(packaged?[]:[quote(appPath)]),'--open-chat'].join(' ')});
    win.setIcon(icon);
  }
  // Keep native editing accelerators even though the chat has no visible menu.
  win.setMenu(Menu.buildFromTemplate([{label:'Edit',visible:false,submenu:['undo','redo','cut','copy','paste','selectAll'].map(role=>({role}))}]));
  win.setMenuBarVisibility(false);
  win.webContents.on('context-menu',(_event,params)=>{
    if(!params.isEditable&&!params.selectionText)return;
    const roles=params.isEditable?['undo','redo','cut','copy','paste','selectAll']:['copy','selectAll'];
    Menu.buildFromTemplate(roles.map(role=>({role,enabled:!['cut','copy'].includes(role)||!!params.selectionText}))).popup({window:win});
  });
}
module.exports={configureChatWindow};
