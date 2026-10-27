'use strict';
const STATUSES = ['available', 'busy', 'away', 'dnd', 'offline'];
function profile(value = {}) {
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 60) : '';
  const status = STATUSES.includes(value.status) ? value.status : 'available';
  const avatar = typeof value.avatar === 'string' && value.avatar.length <= 24000 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value.avatar) ? value.avatar : '';
  const appVersion=typeof value.appVersion==='string'&&value.appVersion.length<=32&&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.appVersion)?value.appVersion:'';
  return { name, status, avatar,appVersion };
}
module.exports = { profile, STATUSES };
