'use strict';
const entry = document.createElement('script');
entry.src = new URLSearchParams(location.search).has('chat') ? 'chat-window.js' : 'renderer.js';
document.body.append(entry);
