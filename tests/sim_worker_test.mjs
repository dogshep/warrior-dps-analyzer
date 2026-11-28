// Runs web/js/sim-worker.js in a vm with a stub engine: the message protocol, chunking and merge of results.
// Usage: node tests/sim_worker_test.mjs
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../web/js/sim-worker.js', import.meta.url), 'utf8');
const sent = [], calls = [];
const self = {
  postMessage: m => sent.push(JSON.parse(JSON.stringify(m))), // copied out of the vm realm
  raidSimJson(json) {
    const req = JSON.parse(json);
    calls.push(req.simOptions);
    const n = calls.length;
    if (self.fail) return JSON.stringify({ error: { message: 'bad request\nstack line' } });
    return JSON.stringify({ raidMetrics: { parties: [{ players: [{ dps: { avg: 100 * n, stdev: 10 }, actions: [{ id: { spellId: n }, targets: [] }] }] }] } });
  },
  computeStatsJson(json) {
    const r = JSON.parse(json);
    assert.equal(r.skipRotation, true);
    if (self.statsError) return JSON.stringify({ errorResult: 'no gear\nmore' });
    return JSON.stringify({ raidStats: { parties: [{ players: [{ sets: ['Set A'], meleeCritCap: { remainingHit: 2.5 } }] }] } });
  },
};
class Go { constructor() { this.importObject = {}; } run() { setTimeout(() => self.wasmready(), 0); } }
const ctx = vm.createContext({ self, importScripts() {}, Go, setTimeout, JSON, Math, Number, String, Promise, Error, Response, WebAssembly: { instantiate: async () => ({}) }, fetch: async () => ({ ok: false, status: 404 }) });
vm.runInContext(src, ctx);

const send = async data => {
  const before = sent.length;
  await self.onmessage({ data });
  while (sent.length === before) await new Promise(r => setTimeout(r));
  return sent.slice(before);
};
const req = (iterations, seed) => ({ raid: {}, encounter: {}, simOptions: { iterations, randomSeed: seed } });

// A start message with a module answers ready.
assert.deepEqual(await send({ id: 1, module: {} }), [{ id: 1, result: 'ready' }]);

// 1000 iterations run in 4 chunks of 250, with seeds spread apart, and progress after each chunk.
let out = await send({ id: 2, request: req(1000, '10') });
assert.deepEqual(calls.map(c => c.iterations), [250, 250, 250, 250]);
assert.deepEqual(calls.map(c => c.randomSeed), ['10', '7929', '15848', '23767']);
const progress = out.filter(m => m.progress).map(m => m.progress.done);
assert.deepEqual(progress, [0.25, 0.5, 0.75, 1]);
const res = out.find(m => m.result).result;
assert.equal(res.iterations, 1000);
const pl = res.raidMetrics.parties[0].players[0];
assert.equal(pl.dps.avg, 250); // mean of 100, 200, 300, 400
// pooled variance: mean of (10^2 + (avg_i - 250)^2)
assert.ok(Math.abs(pl.dps.stdev - Math.sqrt((4 * 100 + 150 ** 2 + 50 ** 2 + 50 ** 2 + 150 ** 2) / 4)) < 1e-9);
assert.equal(pl.actions.length, 4);

// Few iterations stay in one chunk; the count is clamped to 1..5000 and defaults to 300.
calls.length = 0;
await send({ id: 3, request: req(20, '1') });
assert.deepEqual(calls.map(c => c.iterations), [20]);
calls.length = 0;
await send({ id: 4, request: req(99999, '1') });
assert.equal(calls.length * calls[0].iterations, 5000);
calls.length = 0;
await send({ id: 5, request: req(undefined, undefined) });
assert.equal(calls.length * calls[0].iterations, 300);
assert.equal(calls[0].randomSeed, '1');

// Engine errors come back as {error} with only the first line.
self.fail = true;
out = await send({ id: 6, request: req(100, '1') });
assert.deepEqual(out, [{ id: 6, error: 'bad request' }]);
self.fail = false;

// Character sheet mode.
out = await send({ id: 7, stats: { raid: {}, encounter: {} } });
assert.deepEqual(out, [{ id: 7, result: { sets: ['Set A'], remainingHit: 2.5 } }]);
self.statsError = true;
out = await send({ id: 8, stats: { raid: {}, encounter: {} } });
assert.deepEqual(out, [{ id: 8, error: 'no gear' }]);
console.log('sim_worker_test: ok');
