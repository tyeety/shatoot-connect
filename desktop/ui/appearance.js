'use strict';
(()=>{
  function apply(value){const theme=value==='light'?'light':'dark';document.documentElement.dataset.theme=theme;try{localStorage.setItem('appearance-theme',theme);}catch{}window.dispatchEvent(new CustomEvent('shatoot-theme-change',{detail:theme}));}
  try{apply(localStorage.getItem('appearance-theme'));}catch{apply('dark');}
  window.shatootconnect.onAppearance(apply);
  window.shatootconnect.appearance().then(apply).catch(()=>{});
})();
