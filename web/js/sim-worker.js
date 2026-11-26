// Runs the wowsims Forever sim (WebAssembly) off the main thread. Messages: {id, request} -> {id, result} | {id, error}.
importScripts('../sim/wasm_exec.js');

const ready = (async () => {
  const res = await fetch('../sim/lib.wasm.gz');
  if (!res.ok) throw new Error(`Could not load the sim (${res.status}). Run scripts/build-sim.sh first.`);
  const bytes = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const go = new Go();
  const done = new Promise(r => (self.wasmready = r));
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  go.run(instance);
  await done;
})();

self.onmessage = async ({ data }) => {
  try {
    await ready;
    const out = JSON.parse(self.raidSimJson(JSON.stringify(data.request)));
    if (out.error && out.error.message) throw new Error(out.error.message.split('\n')[0]);
    self.postMessage({ id: data.id, result: out });
  } catch (e) {
    self.postMessage({ id: data.id, error: String(e.message || e) });
  }
};
