// Cloudflare's TURN API token never leaves the broker.
function cloudflareTurnProvider(config, fetcher = fetch) {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(config.keyId || '') || typeof config.apiToken !== 'string' || config.apiToken.length < 20) throw new Error('Configure the Cloudflare TURN key ID and API token.');
  const ttl = 86400;
  let cached, expires = 0, pending;
  return async () => {
    if (cached && Date.now() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      let response;
      try {
        response = await fetcher(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(config.keyId)}/credentials/generate-ice-servers`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl })
        });
      } catch { throw new Error('Managed TURN provider is unreachable. Check outbound HTTPS access.'); }
      if (!response.ok) throw new Error(`Managed TURN credential request failed (HTTP ${response.status}). Check the TURN key and token in Server Manager.`);
      const result = await response.json();
      if (!Array.isArray(result.iceServers) || !result.iceServers.length || result.iceServers.some(s =>
        !s || !Array.isArray(s.urls) || !s.urls.length || !s.urls.every(u => typeof u === 'string' && /^(stun|turn|turns):/.test(u)) ||
        (s.urls.some(u => /^turns?:/.test(u)) && (typeof s.username !== 'string' || typeof s.credential !== 'string')))) throw new Error('Managed TURN provider returned an invalid ICE configuration.');
      cached = result.iceServers.map(s => ({ urls: s.urls.filter(u => !/:53(?:\?|$)/.test(u)), ...(s.username ? { username: s.username, credential: s.credential } : {}) })).filter(s => s.urls.length);
      expires = Date.now() + 15 * 60 * 1000;
      return cached;
    })();
    try { return await pending; } finally { pending = null; }
  };
}
module.exports = { cloudflareTurnProvider };
