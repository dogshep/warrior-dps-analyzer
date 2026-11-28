// Runs the wowsims Forever sim (WebAssembly) off the main thread.
// In:  {id, module} with the compiled sim (see simpool.js): starts the engine, then answers {id, result: 'ready'}.
//      {id, request}: runs a sim. Without a module first, the worker downloads the sim itself.
//      {id, stats: request}: the character sheet for that gear, no sim: answers {id, result: {sets, remainingHit}}.
// Out: {id, progress: {stage: 'sim', done: 0..1}} while working, then {id, result} or {id, error}.
importScripts('../sim/wasm_exec.js');

let ready = null;
function load(module) {
  ready ??= (async () => {
    if (!module) {
      const res = await fetch('../sim/lib.wasm.gz');
      if (!res.ok) throw new Error(`Could not load the sim (${res.status}). Run scripts/build-sim.sh first.`);
      module = await WebAssembly.compileStreaming(new Response(res.body.pipeThrough(new DecompressionStream('gzip')), { headers: { 'Content-Type': 'application/wasm' } }));
    }
    const go = new Go();
    const done = new Promise(r => (self.wasmready = r));
    go.run(await WebAssembly.instantiate(module, go.importObject));
    await done;
  })();
  return ready;
}

// Progress steps per sim. Each step is a separate sim call with about 30 ms of setup, so keep it small.
const CHUNKS = 4;

// Runs the iterations in chunks so progress can be reported, then merges them: DPS is the mean of equal-sized
// chunks, and action metrics are concatenated (they are sums over iterations, which the page adds up by name).
async function run(request, report) {
  const total = Math.min(5000, Math.max(1, Math.round(Number(request.simOptions.iterations)) || 300)); // limits as in sim-config.js
  const chunks = total >= CHUNKS * 10 ? CHUNKS : 1;
  const per = Math.ceil(total / chunks);
  const dps = [], actions = [];
  for (let i = 0; i < chunks; i++) {
    const req = { ...request, simOptions: { ...request.simOptions, iterations: per, randomSeed: String(Number(request.simOptions.randomSeed || 1) + i * 7919) } };
    const out = JSON.parse(self.raidSimJson(JSON.stringify(req)));
    if (out.error && out.error.message) throw new Error(out.error.message.split('\n')[0]);
    const p = out.raidMetrics.parties[0].players[0];
    dps.push(p.dps);
    actions.push(...(p.actions || []));
    report((i + 1) / chunks);
    await new Promise(r => setTimeout(r));
  }
  const avg = dps.reduce((s, d) => s + d.avg, 0) / dps.length;
  // Pooled standard deviation of equal-sized chunks.
  const varSum = dps.reduce((s, d) => s + d.stdev * d.stdev + (d.avg - avg) ** 2, 0) / dps.length;
  return { raidMetrics: { parties: [{ players: [{ dps: { avg, stdev: Math.sqrt(varSum) }, actions }] }] }, iterations: per * chunks };
}

// The set bonuses that are active and the main-hand auto attack's remaining miss chance in percent (the
// dual-wield penalty included), from the sim's character sheet. Takes a few milliseconds.
function sheet(request) {
  const out = JSON.parse(self.computeStatsJson(JSON.stringify({ raid: request.raid, encounter: request.encounter, skipRotation: true })));
  if (out.errorResult) throw new Error(out.errorResult.split('\n')[0]);
  const p = out.raidStats.parties[0].players[0];
  return { sets: p.sets || [], remainingHit: p.meleeCritCap ? p.meleeCritCap.remainingHit || 0 : null };
}

self.onmessage = async ({ data }) => {
  try {
    await load(data.module);
    if (data.stats) { self.postMessage({ id: data.id, result: sheet(data.stats) }); return; }
    if (!data.request) { self.postMessage({ id: data.id, result: 'ready' }); return; }
    const result = await run(data.request, done => self.postMessage({ id: data.id, progress: { stage: 'sim', done } }));
    self.postMessage({ id: data.id, result });
  } catch (e) {
    self.postMessage({ id: data.id, error: String(e.message || e) });
  }
};
