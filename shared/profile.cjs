'use strict';
const STATUSES = ['available', 'busy', 'away', 'dnd', 'offline'];
function profile(value = {}) {
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 60) : '';
  const status = STATUSES.includes(value.status) ? value.status : 'available';
  const avatar = typeof value.avatar === 'string' && value.avatar.length <= 24000 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value.avatar) ? value.avatar : '';
  const appVersion=typeof value.appVersion==='string'&&value.appVersion.length<=32&&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.appVersion)?value.appVersion:'';
    const result={name,status,avatar,appVersion};if(typeof value.bio==='string')result.bio=value.bio.trim().slice(0,500);if(Array.isArray(value.photos))result.photos=[...new Set(value.photos.filter(p=>typeof p==='string'&&p.length<=100000&&/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(p)))].slice(0,4);return result;

}
module.exports = { profile, STATUSES };
