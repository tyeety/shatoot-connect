'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {configureChatWindow}=require('../desktop/chat-window.cjs');
test('chat has a separate Windows taskbar identity, icon and native edit shortcuts',()=>{
 const calls={},events={};const win={setAppDetails:d=>calls.details=d,setIcon:p=>calls.icon=p,setMenu:m=>calls.menu=m,setMenuBarVisibility:v=>calls.visible=v,webContents:{on:(name,fn)=>events[name]=fn}};
 const Menu={buildFromTemplate:template=>({template,popup:value=>{calls.popup={template,...value};}})};
 configureChatWindow({win,Menu,icon:'C:\\App\\chat.ico',executable:'C:\\Program Files\\Shatoot.exe',appPath:'C:\\source',packaged:true,platform:'win32'});
 assert.equal(calls.details.appId,'com.shatootsoft.connect.chats');assert.equal(calls.details.appIconPath,calls.icon);assert.equal(calls.details.relaunchCommand,'"C:\\Program Files\\Shatoot.exe" --open-chat');
 assert.deepEqual(calls.menu.template[0].submenu.map(m=>m.role),['undo','redo','cut','copy','paste','selectAll']);assert.equal(calls.visible,false);
 events['context-menu']({}, {selectionText:'بخشی از پیام',isEditable:false});assert.deepEqual(calls.popup.template.map(m=>m.role),['copy','selectAll']);assert.equal(calls.popup.window,win);
});
