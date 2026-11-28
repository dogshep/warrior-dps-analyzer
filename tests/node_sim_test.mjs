// The Node sim loader, with a fake wasm_exec.js and an empty wasm module standing in for the real sim.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const dir = mkdtempSync(join(tmpdir(), 'sim-'));
try {
  // Stands in for Go's wasm_exec.js: defines Go, whose run() installs raidSimJson and announces the engine is ready.
  writeFileSync(join(dir, 'wasm_exec.js'), `
    globalThis.Go = class { constructor() { this.importObject = {}; }
      run() { globalThis.raidSimJson = j => { const r = JSON.parse(j); return JSON.stringify(r.fail ? { error: { message: 'bad\\nmore' } } : { raidMetrics: { parties: [{ players: [{ dps: { avg: r.dps } }] }] } }); }; setTimeout(globalThis.wasmready, 0); } };`);
  writeFileSync(join(dir, 'lib.wasm.gz'), gzipSync(Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])));
  const { loadSim, loadDpsSim } = await import('../scripts/lib/node-sim.mjs');
  const url = pathToFileURL(dir + '/');
  const run = await loadSim(url);
  assert.equal(run({ dps: 123 }).raidMetrics.parties[0].players[0].dps.avg, 123);
  assert.throws(() => run({ fail: true }), /^Error: bad$/);
  const dps = await loadDpsSim(url);
  assert.equal(dps({ dps: 456 }), 456);
  console.log('node_sim_test: ok');
} finally { rmSync(dir, { recursive: true, force: true }); }
