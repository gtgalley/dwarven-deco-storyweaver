// public/js/weaver.js
// v0.4 — simple bridge with local mode (default) and optional live endpoint.

export function makeWeaver(store, log, setTag){
  let mode = 'local';
  let endpoint = '/dm-turn';

  function setMode(m){
    mode = (m === 'live') ? 'live' : 'local';
    setTag && setTag(mode==='live' ? 'Live' : 'Local');
  }
  function setEndpoint(url){ endpoint = url || '/dm-turn'; }

  async function turn(payload, localFallback){
    if (mode !== 'live') return localFallback(payload);

    try{
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data;
    }catch(e){
      log && log(`Live DM error: ${e.message}. Falling back.`);
      setMode('local');
      return localFallback(payload);
    }
  }

  return { mode, endpoint, setMode, setEndpoint, turn };
}
