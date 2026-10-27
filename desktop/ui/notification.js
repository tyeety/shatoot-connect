'use strict';
const api=window.shatootconnect;
const notice=document.querySelector('.notice');notice.tabIndex=0;notice.addEventListener('click',event=>{if(!event.target.closest('button'))api.noticeOpen();});notice.addEventListener('keydown',event=>{if(event.target===notice&&['Enter',' '].includes(event.key)){event.preventDefault();api.noticeOpen();}});
function measure(){if(document.body.dataset.ready==='true')api.noticeSize({height:document.querySelector('.notice').scrollHeight+2,width:document.querySelector('.notice').getBoundingClientRect().width+2});}
api.noticeInfo().then(data=>{document.body.dataset.kind=data.kind||'general';window.i18n.setLanguage(data.language);document.getElementById('notice-title').textContent=data.title;document.getElementById('notice-message').textContent=window.i18n.translate(data.message);document.getElementById('notice-detail').textContent=data.detail;for(const [index,label]of data.buttons.entries()){const button=document.createElement('button');button.className='small-button';button.textContent=window.i18n.translate(label);button.onclick=()=>api.noticeAnswer(index);document.getElementById('notice-actions').append(button);}if(!data.urgent){const hide=document.createElement('button');hide.id='notice-hide';hide.className='small-button';hide.textContent=window.i18n.translate('Hide');hide.onclick=()=>api.noticeHide();document.getElementById('notice-actions').append(hide);}document.body.dataset.ready='true';requestAnimationFrame(measure);document.fonts.ready.then(measure);});
api.onNoticeFade(fading=>document.body.classList.toggle('fading',fading));
document.body.addEventListener('mouseenter',()=>api.noticeHover(true));document.body.addEventListener('mouseleave',()=>api.noticeHover(false));


new ResizeObserver(measure).observe(document.querySelector('.notice'));
