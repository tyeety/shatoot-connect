window.mergeVisiblePins=(order,all)=>{const visible=new Set(order);let index=0;return all.map(id=>visible.has(id)?order[index++]:id);};
'use strict';
window.installCollectionFilter=(list,changed)=>{
 const select=document.createElement('select');select.className='collection-filter';select.setAttribute('aria-label',window.i18n.translate('Collection'));list.before(select);let names=[];
 select.onchange=changed;
 return {clear(){select.value='';},names:()=>names,sync(items){names=[...new Set(items.map(i=>i.category||'').filter(Boolean))].sort((a,b)=>a.localeCompare(b));const options=[['',window.i18n.translate('All collections')],['\u0001',window.i18n.translate('Ungrouped')],...names.map(n=>[n,n])],key=JSON.stringify(options);if(select.dataset.key!==key){const value=select.value;select.replaceChildren(...options.map(([value,text])=>{const o=document.createElement('option');o.value=value;o.textContent=text;return o;}));select.value=options.some(([v])=>v===value)?value:'';select.dataset.key=key;}select.hidden=names.length===0;},accept:item=>!select.value||(select.value==='\u0001'?!item.category:item.category===select.value)};
};
