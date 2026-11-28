// Loads the wowsims Forever sim (built by scripts/build-sim.sh into web/sim/) inside Node.
// Used by scripts/precompute-upgrades.mjs (in each worker thread) and by the tests/run_*.mjs tools.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';

// simDir: a URL of the directory with wasm_exec.js and lib.wasm.gz (with a trailing slash).
// Returns runSim(request): the parsed RaidSimResult. A sim error becomes an Error with its first line.
export async function loadSim(simDir) {
  createRequire(import.meta.url)(new URL('wasm_exec.js', simDir).pathname);
  const wasm = gunzipSync(readFileSync(new URL('lib.wasm.gz', simDir)));
  await new Promise(resolve => {
    globalThis.wasmready = resolve;
    const go = new globalThis.Go();
    WebAssembly.instantiate(wasm, go.importObject).then(r => go.run(r.instance));
  });
  return request => {
    const out = JSON.parse(globalThis.raidSimJson(JSON.stringify(request)));
    if (out.error?.message) throw new Error(out.error.message.split('\n')[0]);
    return out;
  };
}

// The same, answering with the average DPS of the first player.
export async function loadDpsSim(simDir) {
  const run = await loadSim(simDir);
  return request => run(request).raidMetrics.parties[0].players[0].dps.avg;
}
