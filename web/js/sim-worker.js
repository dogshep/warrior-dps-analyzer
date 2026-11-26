// Runs the wowsims Forever sim (WebAssembly) off the main thread.
// In:  {id, request}
// Out: {id, progress: {stage: 'download' | 'sim', done: 0..1}} while working, then {id, result} or {id, error}.
importScripts('../sim/wasm_exec.js');

let ready = null;
function load(report) {
  ready ??= (async () => {
    const res = await fetch('../sim/lib.wasm.gz');
    if (!res.ok) throw new Error(`Could not load the sim (${res.status}). Run scripts/build-sim.sh first.`);
    const total = Number(res.headers.get('content-length')) || 6.4e6;
    let got = 0;
    const counted = res.body.pipeThrough(new TransformStream({
      transform(chunk, ctl) { got += chunk.length; report(Math.min(1, got / total)); ctl.enqueue(chunk); },
    }));
    const bytes = await new Response(counted.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const go = new Go();
    const done = new Promise(r => (self.wasmready = r));
    const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
    go.run(instance);
    await done;
  })();
  return ready;
}

const CHUNKS = 10;

// Runs the iterations in chunks so progress can be reported, then merges them: DPS is the mean of equal-sized
// chunks, and action metrics are concatenated (they are sums over iterations, which the page adds up by name).
async function run(request, report) {
  const total = request.simOptions.iterations;
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

self.onmessage = async ({ data }) => {
  const report = stage => done => self.postMessage({ id: data.id, progress: { stage, done } });
  try {
    await load(report('download'));
    const result = await run(data.request, report('sim'));
    self.postMessage({ id: data.id, result });
  } catch (e) {
    self.postMessage({ id: data.id, error: String(e.message || e) });
  }
};
