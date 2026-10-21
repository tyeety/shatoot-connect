'use strict';
window.shatootconnect.onGuestCursor(data => {
  const pointer = document.getElementById('pointer');
  pointer.style.display = data.visible ? 'block' : 'none';
  pointer.style.left = Math.round(data.x * (innerWidth - 1)) + 'px';
  pointer.style.top = Math.round(data.y * (innerHeight - 1)) + 'px';
  document.getElementById('name').textContent = data.name || 'Guest';
});
