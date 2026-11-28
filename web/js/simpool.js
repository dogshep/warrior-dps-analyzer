// The sim workers. The page downloads and compiles the wowsims WASM once and hands the compiled module to each
// worker, so an extra worker only pays the engine start (about 1 to 2 s), not another 6 MB download and compile.
// Workers are started early (warm) so the engine is usually running before anyone presses Analyze.

import { DEFAULT_ITERATIONS } from './sim-config.js';

// Workers to run side by side: one per spare CPU core, up to 4 (each one holds about 110 MB).
export const THREADS = typeof navigator === 'undefined' ? 1 : Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

let modP = null, downloaded = 0;
const dlListeners = new Set();

// The compiled sim, downloaded on first use. onDownload(0..1) follows the download.
function simModule(onDownload) {
  if (onDownload) { dlListeners.add(onDownload); onDownload(downloaded); }
  if (!modP) {
    modP = (async () => {
      const res = await fetch('sim/lib.wasm.gz');
      if (!res.ok) throw new Error(`Could not load the sim (${res.status}). Run scripts/build-sim.sh first.`);
      const total = Number(res.headers.get('content-length')) || 6.4e6;
      let got = 0;
      const counted = res.body.pipeThrough(new TransformStream({
        transform(chunk, ctl) {
          got += chunk.length;
          downloaded = Math.min(1, got / total);
          for (const l of dlListeners) l(downloaded);
          ctl.enqueue(chunk);
        },
      }));
      // Compiles while it downloads instead of after.
      const wasm = new Response(counted.pipeThrough(new DecompressionStream('gzip')), { headers: { 'Content-Type': 'application/wasm' } });
      const mod = await WebAssembly.compileStreaming(wasm);
      downloaded = 1;
      for (const l of dlListeners) l(1);
      return mod;
    })();
    modP.catch(() => { modP = null; downloaded = 0; });
  }
  return onDownload ? modP.finally(() => dlListeners.delete(onDownload)) : modP;
}

const workers = []; // {w, ready}
const pending = new Map();
let nextId = 0;

function call(w, msg, onProgress) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ id, ...msg });
  });
}

function spawn() {
  const w = new Worker('js/sim-worker.js');
  w.onmessage = ({ data: m }) => {
    const p = pending.get(m.id);
    if (!p) return;
    if (m.progress) { p.onProgress && p.onProgress(m.progress); return; }
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
  };
  const entry = { w, ready: simModule().then(module => call(w, { module })) };
  entry.ready.catch(() => {
    w.terminate();
    const i = workers.indexOf(entry);
    if (i >= 0) workers.splice(i, 1);
  });
  return entry;
}

// Starts n workers (if they aren't running) and resolves once all of them have the engine running.
export function warm(n = THREADS, onDownload) {
  const dl = simModule(onDownload);
  while (workers.length < n) workers.push(spawn());
  return Promise.all([dl, ...workers.slice(0, n).map(x => x.ready)]);
}

// Stops every running sim. The workers are thrown away; new ones start on the next warm or sim.
export function cancel() {
  for (const { w } of workers) w.terminate();
  workers.length = 0;
  for (const p of pending.values()) { const e = new Error('Sim cancelled.'); e.cancelled = true; p.reject(e); }
  pending.clear();
}

// One sim on worker i. onProgress gets {stage: 'sim', done: 0..1}.
export async function sim(request, onProgress, i = 0) {
  await warm(i + 1);
  return call(workers[i].w, { request }, onProgress);
}

// The character sheet (active set bonuses, remaining miss chance) for a request's gear, on worker i. No sim runs.
export async function stats(request, i = 0) {
  await warm(i + 1);
  return call(workers[i].w, { stats: request });
}

// One sim split across several workers: each runs its share of the iterations with its own seed, and the
// parts are merged into one result. onProgress gets the average progress of the parts (0..1).
export async function simSplit(request, onProgress, idx = [0]) {
  const total = Math.max(1, Math.round(Number(request.simOptions.iterations)) || DEFAULT_ITERATIONS);
  const parts = Math.max(1, Math.min(idx.length, total));
  const per = Math.ceil(total / parts);
  const seed = Number(request.simOptions.randomSeed || 1);
  const done = new Array(parts).fill(0);
  const runs = await Promise.all(Array.from({ length: parts }, (_, k) =>
    sim({ ...request, simOptions: { ...request.simOptions, iterations: per, randomSeed: String(seed + k * 104729) } },
      ({ done: f }) => { done[k] = f; onProgress && onProgress(done.reduce((s, x) => s + x, 0) / parts); }, idx[k])));
  return mergeRuns(runs);
}

// Merges sim results of separate runs: DPS is the iteration-weighted mean with a pooled standard deviation, and
// action metrics are concatenated (they are sums over iterations, which the page adds up by name).
export function mergeRuns(runs) {
  if (runs.length === 1) return runs[0];
  const n = runs.map(r => r.iterations || 1), N = n.reduce((s, x) => s + x, 0);
  const players = runs.map(r => r.raidMetrics.parties[0].players[0]);
  const avg = players.reduce((s, p, i) => s + p.dps.avg * n[i], 0) / N;
  const variance = players.reduce((s, p, i) => s + n[i] * (p.dps.stdev ** 2 + (p.dps.avg - avg) ** 2), 0) / N;
  return { raidMetrics: { parties: [{ players: [{ dps: { avg, stdev: Math.sqrt(variance) }, actions: players.flatMap(p => p.actions || []) }] }] }, iterations: N };
}
