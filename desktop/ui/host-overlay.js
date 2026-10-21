'use strict';
const api = window.shatootconnect;
api.overlayInfo().then(info => {
  const fa = info.language === 'fa';
  document.documentElement.lang = fa ? 'fa' : 'en'; document.documentElement.dir = fa ? 'rtl' : 'ltr';
  document.getElementById('overlay-label').textContent = fa ? 'متصل به صفحهٔ شما' : 'Connected to your screen';
  document.getElementById('overlay-name').textContent = info.name || (fa ? 'میهمان' : 'Viewer');
  document.getElementById('overlay-mode').textContent = info.control ? (fa ? 'مشاهده و کنترل' : 'View and control') : (fa ? 'فقط مشاهده' : 'View only');
  const button = document.getElementById('overlay-disconnect'); button.title = button.ariaLabel = fa ? 'قطع اتصال' : 'Disconnect';
  const hide=document.getElementById('overlay-hide');hide.title=hide.ariaLabel=fa?'پنهان کردن پنل':'Hide panel';
});
document.getElementById('overlay-disconnect').onclick = () => api.overlayDisconnect();
document.getElementById('overlay-hide').onclick=()=>api.overlayHide();
