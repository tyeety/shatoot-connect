'use strict';
(function(root){
 function design(value){
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||!Array.isArray(value.layers)||value.layers.length>24)throw Error('Invalid story design.');
  const number=(v,fallback,min,max)=>{if(v===undefined)return fallback;if(!Number.isFinite(v)||v<min||v>max)throw Error('Invalid story transform.');return v;};
  const color=(v,fallback)=>{if(v===undefined)return fallback;if(!/^#[a-f0-9]{6}$/i.test(v))throw Error('Invalid story color.');return v;};
  const transform=v=>({x:number(v?.x,.5,0,1),y:number(v?.y,.5,0,1),scale:number(v?.scale,1,.1,8),rotation:number(v?.rotation,0,-360,360)});
  return {background:color(value.background,'#291438'),media:transform(value.media),layers:value.layers.map((layer,index)=>{
   if(!layer||!['text','sticker'].includes(layer.type)||typeof layer.text!=='string'||layer.text.length>(layer.type==='text'?500:64)||!['none','pill','square','bubble'].includes(layer.shape||'none')||!['left','center','right'].includes(layer.align||'center'))throw Error('Invalid story layer.');
   return {id:String(index),type:layer.type,text:layer.text,...transform(layer),color:color(layer.color,'#ffffff'),background:color(layer.background,'#63358a'),shape:layer.shape||'none',align:layer.align||'center',fontSize:number(layer.fontSize,28,12,96)};
  })};
 }
 function paint(stage,value){
  stage.querySelectorAll('.story-design-layer').forEach(node=>node.remove());
  for(const media of stage.querySelectorAll('.story-photo,video.story-media,.story-audio-art')){media.style.transform='';media.style.transformOrigin='center';}
  if(!value)return;const data=design(value);stage.style.background=data.background;
  for(const media of stage.querySelectorAll('.story-photo,video.story-media,.story-audio-art'))media.style.transform=`translate(${(data.media.x-.5)*stage.clientWidth}px,${(data.media.y-.5)*stage.clientHeight}px) rotate(${data.media.rotation}deg) scale(${data.media.scale})`;
  for(const layer of data.layers){const node=document.createElement('div');node.className='story-design-layer shape-'+layer.shape;node.dataset.layer=layer.id;node.textContent=layer.text;node.setAttribute('translate','no');node.dir='auto';node.style.cssText=`left:${layer.x*100}%;top:${layer.y*100}%;transform:translate(-50%,-50%) rotate(${layer.rotation}deg) scale(${layer.scale});color:${layer.color};--layer-background:${layer.background};font-size:${layer.fontSize/4}cqw;text-align:${layer.align}`;stage.append(node);}
 }
 function zoom(stage,canvas){
  const points=new Map();let scale=1,x=0,y=0,start;
  const distance=()=>{const [a,b]=[...points.values()];return Math.hypot(a.x-b.x,a.y-b.y);};const draw=()=>{canvas.style.transform=`translate(${x}px,${y}px) scale(${scale})`;};
  stage.addEventListener('pointerdown',e=>{if(e.target.closest('button')&&!e.target.closest('.story-tap-zone'))return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});start={x,y,scale,px:e.clientX,py:e.clientY,distance:points.size===2?distance():0};if(points.size>1)stage.dataset.zooming='true';});
  stage.addEventListener('pointermove',e=>{if(!points.has(e.pointerId))return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});if(points.size===2&&start.distance){scale=Math.max(1,Math.min(8,start.scale*distance()/start.distance));stage.dataset.zooming='true';}else if(scale>1&&start){x=Math.max(-stage.clientWidth*scale,Math.min(stage.clientWidth*scale,start.x+e.clientX-start.px));y=Math.max(-stage.clientHeight*scale,Math.min(stage.clientHeight*scale,start.y+e.clientY-start.py));stage.dataset.zooming='true';}draw();});
  const release=e=>{points.delete(e.pointerId);if(!points.size)setTimeout(()=>delete stage.dataset.zooming,0);else{const point=[...points.values()][0];start={x,y,scale,px:point.x,py:point.y,distance:0};}};stage.addEventListener('pointerup',release);stage.addEventListener('pointercancel',release);
  stage.addEventListener('wheel',e=>{e.preventDefault();scale=Math.max(1,Math.min(8,scale*Math.exp(-e.deltaY*.002)));if(scale===1)x=y=0;draw();},{passive:false});stage.addEventListener('dblclick',e=>{e.preventDefault();scale=scale>1?1:2;x=y=0;draw();});
 }
 const api={design,paint,zoom};if(typeof module!=='undefined')module.exports=api;else root.StoryDesign=api;
})(globalThis);
