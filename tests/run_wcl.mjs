// Runs the analysis on saved Warcraft Logs API responses: {report: <report query response>, events: <fight query response>}.
// Usage: node tests/run_wcl.mjs saved.json [iterations]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { loadReport, loadFight } from '../web/js/wcl.js';
import { aplSpellNames, analyzeFight, buildRequest, compareToSim, suggestions, detectConsumes, missingConsumes } from '../web/js/analyze.js';

const [path, itArg] = process.argv.slice(2);
const iterations = Number(itArg || 100);
const saved = JSON.parse(readFileSync(path, 'utf8'));
const mem = new Map([['wcl_token', 'saved']]);
globalThis.sessionStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
const fetchImpl = async (url, opts) => {
  const q = JSON.parse(opts.body).query;
  return { ok: true, status: 200, json: async () => (q.includes('masterData') ? saved.report : saved.events) };
};
const root = new URL('../web/sim/', import.meta.url);
const names = JSON.parse(readFileSync(new URL('names.json', root)));
const apls = Object.fromEntries(['fury', 'fury_2h', 'arms'].map(k => [k, JSON.parse(readFileSync(new URL(`apls/${k}.apl.json`, root)))]));

const report = await loadReport('x', fetchImpl);
const w = report.warriors[0];
const fight = report.fights[0];
const parser = await loadFight(report, w, fight, fetchImpl);
const a = analyzeFight(parser, w.guid, fight, names);
if (process.env.CD) { for (const r of a.cooldowns) console.log("CD", r.name, "uses", r.uses.length, "possible", r.possible, "usedPulls", r.usedPulls, "spent", r.spent?.length, "unstacked", r.unstacked); }
console.log(`${w.name} ${fight.name}: ${((fight.end - fight.start) / 1000).toFixed(0)}s total, ${a.pulls ?? 1} pulls, ${a.dur.toFixed(0)}s in combat, sim pull ${a.simDur.toFixed(0)}s x ${a.targetCount} targets, ${a.dps.toFixed(1)} dps, idle ${a.idleSec.toFixed(0)}s, rage capped ${a.rageCapped?.toFixed(2)}, preset ${a.preset}`);
console.log('abilities:', a.abilities.slice(0, 14).map(x => `${x.name}:${x.casts}/${Math.round(x.damage)}`).join(' '));
console.log('gear:', a.combatant?.items.map(i => `${names.items[i.id]?.[0] || i.id}${i.enchant ? '+' + i.enchant : ''}`).join(', '));

require: {
  const require = createRequire(import.meta.url);
  require(new URL('wasm_exec.js', root).pathname);
}
const wasm = gunzipSync(readFileSync(new URL('lib.wasm.gz', root)));
await new Promise(res => { globalThis.wasmready = res; const go = new Go(); WebAssembly.instantiate(wasm, go.importObject).then(r => go.run(r.instance)); });
const run = req => { const out = JSON.parse(globalThis.raidSimJson(JSON.stringify(req))); if (out.error?.message) throw new Error(out.error.message); return out; };
const t0 = Date.now();
const sim = compareToSim(run(buildRequest(a, parser, names, apls, { iterations })), names, iterations);
const cons = detectConsumes(a, parser, names);
const ideal = compareToSim(run(buildRequest(a, parser, names, apls, { iterations, consumes: 'ideal' })), names, iterations);
ideal.missing = missingConsumes(cons.found);
console.log(`sim ${sim.simDps.toFixed(1)} (ideal ${ideal.simDps.toFixed(1)}) in ${Date.now() - t0}ms; consumes: ${cons.found.map(f => f.name).join(', ')}`);
for (const s of suggestions(a, sim, ideal, aplSpellNames(apls[a.preset], names))) console.log(`- ${s.title}${s.gain ? ` [~${Math.round(s.gain)}]` : ''}\n    ${s.detail}`);
process.exit(0);
