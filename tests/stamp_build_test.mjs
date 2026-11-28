import assert from 'node:assert/strict';
import { stampSource } from '../scripts/stamp-build.mjs';

const s = (t) => stampSource(t, 'B1', 'S1');
assert.equal(s("import { a } from './format.js';"), "import { a } from './format.js?v=B1';");
assert.equal(s("fetch('sim/names.json')"), "fetch('sim/names.json?v=B1')");
assert.equal(s('fetch(`sim/apls/${p}.apl.json`)'), 'fetch(`sim/apls/${p}.apl.json?v=B1`)');
assert.equal(s("fetch('sim/lib.wasm.gz')"), "fetch('sim/lib.wasm.gz?v=S1')");
assert.equal(s("importScripts('../sim/wasm_exec.js')"), "importScripts('../sim/wasm_exec.js?v=S1')");
assert.equal(s("new Worker('js/sim-worker.js')"), "new Worker('js/sim-worker.js?v=B1')");
assert.equal(s("fetchImpl('wcl-proxy.json')"), "fetchImpl('wcl-proxy.json?v=B1')");
assert.equal(s('<link rel="stylesheet" href="style.css">'), '<link rel="stylesheet" href="style.css?v=B1">');
assert.equal(s('<script type="module" src="js/app.js"></script>'), '<script type="module" src="js/app.js?v=B1"></script>');
assert.equal(s('<meta name="build" content="dev">'), '<meta name="build" content="B1">');
// Outside links and already stamped paths are left alone.
assert.equal(s("'https://raw.githubusercontent.com/x/y.json'"), "'https://raw.githubusercontent.com/x/y.json'");
assert.equal(s("fetch('sim/names.json?v=old')"), "fetch('sim/names.json?v=old')");
console.log('stamp_build ok');
