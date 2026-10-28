'use strict';
const {EventEmitter}=require('node:events');
// Each remote renderer retains its own RTC/input state, inside one native window.
class RemoteTab extends EventEmitter{
 constructor({parent,view,id,select,remove}){super();Object.assign(this,{parent,view,id,select,remove,workspaceTab:true,webContents:view.webContents});this.parentBlur=()=>this.emit('blur');parent.on('blur',this.parentBlur);}
 isDestroyed(){return this.webContents.isDestroyed();}
 loadFile(...args){return this.webContents.loadFile(...args);}
 show(){this.select(this.id);this.parent.show();}
 showInactive(){this.show();}
 hide(){this.select('home');}
 isVisible(){return !this.isDestroyed()&&this.parent.isVisible()&&this.parent.workspaceActive===this.id;}
 isFocused(){return this.isVisible()&&this.parent.isFocused();}
 focus(){this.show();this.webContents.focus();}
 close(){const e={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};this.emit('close',e);if(!e.defaultPrevented)this.destroy();}
 destroy(){if(this.isDestroyed()||this.closing)return;this.closing=true;this.parent.removeListener('blur',this.parentBlur);this.remove(this.id);this.emit('closed');this.webContents.close();}
 getNativeWindowHandle(){return this.parent.getNativeWindowHandle();}
 getBounds(){return this.parent.getBounds();}
 getNormalBounds(){return this.parent.getNormalBounds();}
 getContentBounds(){return this.parent.getContentBounds();}
 getMinimumSize(){return [640,360];}
 isMinimized(){return this.parent.isMinimized();}
 isMaximized(){return this.parent.isMaximized();}
 isFullScreen(){return this.parent.isFullScreen();}
 restore(){this.parent.restore();}
 setFullScreen(value){this.parent.setFullScreen(value);}
 setOverlayIcon(...args){this.parent.setOverlayIcon(...args);}
 removeMenu(){} setAspectRatio(){} setMinimumSize(){} setBounds(){} setContentSize(){} setPosition(){} maximize(){} unmaximize(){} setContentProtection(){} setTitle(){} setBackgroundColor(){}
}
module.exports={RemoteTab};
