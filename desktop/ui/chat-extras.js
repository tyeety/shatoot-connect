'use strict';
window.installChatExtras=({api,engine,self,field,selected,button,run,tr,error,reload})=>{
  const emojiData=window.shatootEmojiData,categories=[{name:'Most used',symbol:'⭐',items:[]},...emojiData.groups.map((g,i)=>({...g,symbol:['😀','🧑','🐻','🍔','🚗','⚽','💡','🔣','🏳️'][i]}))];let emojiGroup=0,emojiLimit=160;
  let picker,scheduler,scheduleConversation='',editingId='',draft='',listKey='',pickerTarget=null;
  const emojiButton=button('Emoji',()=>openPicker(null),'sentiment_satisfied');emojiButton.id='chat-emoji';
  const scheduleButton=button('Schedule message',()=>openSchedule(),'schedule_send');scheduleButton.id='chat-schedule';
  const tools=document.createElement('div');tools.className='chat-extra-tools';tools.append(emojiButton,scheduleButton);field.after(tools);
  function dialog(id,title){const box=document.createElement('dialog');box.id=id;box.className='chat-extra-dialog';const heading=document.createElement('div');heading.className='settings-heading';const h=document.createElement('h2');h.textContent=tr(title);heading.append(h,button('Close',()=>box.close(),'close'));box.append(heading);document.body.append(box);return box;}
  function localTime(value){const date=new Date(value);return new Date(date-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
  function tomorrow(){const date=new Date();date.setDate(date.getDate()+1);date.setHours(8,0,0,0);return date;}
  function openPicker(row){
    if(!selected())return;pickerTarget=row?{conversation:row.conversation,id:row.id,emoji:row.reactions?.[self.deviceId]?.emoji||''}:null;
    if(!picker){picker=dialog('chat-emoji-dialog','Emoji');const tabs=document.createElement('div');tabs.className='emoji-tabs';const grid=document.createElement('div');grid.className='emoji-grid';grid.setAttribute('role','group');
      const search=document.createElement('input');search.type='search';search.placeholder=tr('Search emoji');search.dir='auto';search.oninput=()=>{emojiLimit=160;renderEmoji();};picker.append(search);picker.emojiSearch=search;picker.emojiGrid=grid;picker.emojiTabs=tabs;
      for(const [index,category]of categories.entries()){const control=button(category.name,()=>{emojiGroup=index;emojiLimit=160;renderEmoji();});control.className='emoji-category';control.textContent=category.symbol;control.setAttribute('role','tab');tabs.append(control);}picker.append(tabs,grid);
    }
    picker.querySelector('h2').textContent=tr(row?'React to message':'Emoji');picker.showModal();emojiGroup=0;emojiLimit=160;picker.emojiSearch.value='';renderEmoji();
  }
  function renderEmoji(){const search=picker.emojiSearch.value.trim().toLowerCase(),used=engine.catalog.emojiUsage||{},all=categories.slice(1).flatMap(g=>g.items);const frequent=Object.entries(used).sort((a,b)=>b[1]-a[1]).map(([emoji])=>all.find(e=>e[0]===emoji)).filter(Boolean);let items=search?all.filter(([emoji,name])=>name.includes(search)||emoji.includes(search)):emojiGroup?categories[emojiGroup].items:frequent.length?frequent:all.filter(([emoji])=>['😀','👍','❤️','😂','🙏','🎉'].includes(emoji));picker.emojiGrid.replaceChildren(...items.slice(0,emojiLimit).map(([emoji,name])=>{const b=document.createElement('button');b.type='button';b.className='emoji-choice';b.textContent=emoji;b.title=name;b.setAttribute('aria-label',name);b.onclick=run(()=>chooseEmoji(emoji));return b;}));for(const [i,b]of [...picker.emojiTabs.children].entries())b.setAttribute('aria-selected',String(i===emojiGroup));if(items.length>emojiLimit){const more=button('Load more',()=>{emojiLimit+=160;renderEmoji();});more.className='emoji-more';picker.emojiGrid.append(more);}}
  async function chooseEmoji(emoji){
    if(pickerTarget){await engine.react(pickerTarget.conversation,pickerTarget.id,pickerTarget.emoji===emoji?'':emoji);await reload();}
    else {if(field.disabled)return;const start=field.selectionStart,end=field.selectionEnd;if(field.value.length-end+start+emoji.length>field.maxLength)return;picker.close();field.focus();field.setSelectionRange(start,end);document.execCommand('insertText',false,emoji);}
    try{engine.catalog.emojiUsage=await api.collaboration('emoji-usage',{emoji});}catch{}picker.close();field.focus();
  }
  function setEditor(item){editingId=item?.id||'';scheduler.querySelector('textarea').value=item?.text||draft;scheduler.querySelector('[type=datetime-local]').value=localTime(item?.sendAt||tomorrow());scheduler.querySelector('[type=submit]').textContent=tr(item?'Save changes':'Schedule message');scheduler.querySelector('.schedule-error').textContent='';}
  function openSchedule(){
    if(!selected())return;scheduleConversation=selected();draft=field.value;
    if(!scheduler){scheduler=dialog('chat-schedule-dialog','Scheduled messages');const form=document.createElement('form');form.id='chat-schedule-form';
      const messageLabel=document.createElement('label');messageLabel.textContent=tr('Message');const text=document.createElement('textarea');text.id='scheduled-text';text.dir='auto';text.maxLength=8000;text.required=true;messageLabel.append(text);
      const timeLabel=document.createElement('label');timeLabel.textContent=tr('Send at (this computer’s time)');const time=document.createElement('input');time.id='scheduled-time';time.type='datetime-local';time.required=true;timeLabel.append(time);
      const actions=document.createElement('div');actions.className='inline-setting';const submit=document.createElement('button');submit.type='submit';submit.className='small-button';actions.append(submit);
      const hint=document.createElement('p');hint.className='footnote';hint.textContent=tr('Keep the app running in the tray. If it is closed, overdue messages send when it starts again.');
      const status=document.createElement('p');status.className='schedule-error error';status.setAttribute('role','alert');form.append(messageLabel,timeLabel,actions,hint,status);scheduler.append(form);const list=document.createElement('div');list.className='scheduled-list';scheduler.append(list);
      form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;try{await engine.schedule(scheduleConversation,text.value,new Date(time.value).getTime(),editingId||undefined);if(!editingId&&selected()===scheduleConversation&&field.value===draft){field.value='';field.dispatchEvent(new Event('input',{bubbles:true}));}draft='';setEditor();renderSchedules();window.actionNotice(tr('Message scheduled'));}catch(e){status.textContent=tr(e.message);}finally{submit.disabled=false;}};
    }
    scheduler.querySelector('[type=datetime-local]').min=localTime(Date.now());setEditor();listKey='';renderSchedules();scheduler.showModal();scheduler.querySelector('textarea').focus();
  }
  function renderSchedules(){
    if(!scheduler)return;const items=(engine.catalog.scheduled||[]).filter(m=>m.conversation===scheduleConversation).sort((a,b)=>a.sendAt-b.sendAt),key=JSON.stringify(items);if(listKey===key)return;listKey=key;
    const list=scheduler.querySelector('.scheduled-list');list.replaceChildren();if(!items.length){const empty=document.createElement('p');empty.textContent=tr('No scheduled messages');list.append(empty);}
    for(const item of items){const row=document.createElement('div');row.className='scheduled-item';const content=document.createElement('div'),text=document.createElement('p'),time=document.createElement('small');text.dir='auto';text.textContent=item.text;time.textContent=new Intl.DateTimeFormat(window.i18n.language==='fa'?'fa-IR':'en',{dateStyle:'medium',timeStyle:'short'}).format(item.sendAt);content.append(text,time);row.append(content,button('Edit message',()=>setEditor(item),'edit'),button('Cancel scheduled message',async()=>{await engine.cancelScheduled(item.id);if(editingId===item.id)setEditor();renderSchedules();},'delete'));list.append(row);}
  }
  function renderReactions(item,row){
    let container=item.querySelector('.message-reactions');if(!container){container=document.createElement('div');container.className='message-reactions';item.querySelector('footer').before(container);}
    const reactions=Object.entries(row.reactions||{}).filter(([,r])=>r.emoji),key=JSON.stringify(reactions);if(container.dataset.key===key)return;container.dataset.key=key;container.replaceChildren();
    const grouped=new Map();for(const [id,r]of reactions){if(!grouped.has(r.emoji))grouped.set(r.emoji,[]);grouped.get(r.emoji).push(id);}
    for(const [emoji,ids]of grouped){const chip=document.createElement('button');chip.type='button';chip.className='reaction-chip';chip.textContent=emoji+' '+ids.length;chip.setAttribute('aria-pressed',String(ids.includes(self.deviceId)));chip.title=ids.map(id=>id===self.deviceId?self.name:engine.catalog.contacts.find(c=>c.deviceId===id)?.displayName||engine.catalog.contacts.find(c=>c.deviceId===id)?.name||engine.group(row.conversation.slice(2))?.members.find(m=>m.deviceId===id)?.name||id.slice(0,8)).join(', ');chip.onclick=run(async()=>{await engine.react(row.conversation,row.id,ids.includes(self.deviceId)?'':emoji);await reload();});container.append(chip);}
    container.hidden=!grouped.size;
  }
  return {openReaction:openPicker,renderReactions,sync(){emojiButton.disabled=!selected();scheduleButton.disabled=!selected();const count=(engine.catalog.scheduled||[]).filter(m=>m.conversation===selected()).length;scheduleButton.title=tr('Scheduled messages')+(count?' · '+count:'');scheduleButton.dataset.count=String(count);scheduleButton.setAttribute('aria-label',scheduleButton.title);renderSchedules();}};
};
