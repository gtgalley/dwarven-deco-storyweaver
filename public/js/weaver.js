// public/js/weaver.js
// Minimal "Weaver" bridge that can switch between Local (built-in)
// and Live (serverless endpoint) without breaking your UI.

export function makeWeaver(store, logFn, setEngineTag) {
  let mode = 'local';
  let endpoint = store.get('dm_endpoint', '/dm-turn'); // you can change later in UI

  function setMode(m) {
    mode = (m === 'live') ? 'live' : 'local';
    setEngineTag(mode === 'live' ? 'Live' : 'Local');
  }

  function setEndpoint(u) {
    endpoint = u && u.trim() ? u.trim() : '/dm-turn';
    store.set('dm_endpoint', endpoint);
  }

  async function turn(payload, localTurn) {
    if (mode !== 'live') return localTurn(payload);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      return json;
    } catch (err) {
      logFn?.('Live DM unavailable — falling back to Local.');
      return localTurn(payload);
    }
  }

  return {
    get mode(){ return mode; },
    get endpoint(){ return endpoint; },
    setMode, setEndpoint, turn
  };
}
