const PROFILES = Object.freeze({
  lan: { label: 'LAN · Ultra', width: 7680, height: 4320, fps: 30, bitrate: 100000000 },
  balanced: { label: 'متعادل', width: 1920, height: 1080, fps: 30, bitrate: 12000000 },
  quality: { label: 'بیشترین کیفیت', width: 3840, height: 2160, fps: 30, bitrate: 40000000 },
  speed: { label: 'کمترین تأخیر', width: 1920, height: 1080, fps: 45, bitrate: 8000000 },
  economy: { label: 'اینترنت ضعیف', width: 1280, height: 720, fps: 24, bitrate: 2500000 }
});
function validSignal(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.description) return ['offer', 'answer'].includes(data.description.type) &&
    typeof data.description.sdp === 'string' && data.description.sdp.length < 100000;
  return data.candidate && typeof data.candidate === 'object' &&
    typeof data.candidate.candidate === 'string' && data.candidate.candidate.length < 4096;
}
module.exports = { PROFILES, validSignal };
