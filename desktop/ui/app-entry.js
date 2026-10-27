'use strict';
if(new URLSearchParams(location.search).has('viewer'))document.body.classList.add('remote-window','remote-connecting');
const entry = document.createElement('script');
entry.src = new URLSearchParams(location.search).has('chat') ? 'chat-window.js' : 'renderer.js';
document.body.append(entry);
