// End to end in Node: parse a log, pick the top warrior and fight, run the wowsims WASM sim, print suggestions.
// Usage: node scripts/dev/run_analysis.mjs <log> [iterations]
import { readFileSync } from 'node:fs';
import { loadSim } from '../lib/node-sim.mjs';
import { parseText } from '../../web/js/logparser.js';
import { aplSpellNames, analyzeFight, buildRequest, compareToSim, suggestions, detectConsumes, missingConsumes } from '../../web/js/analyze.js';

const [logPath, itArg] = process.argv.slice(2);
const iterations = Number(itArg || 200);
const root = new URL('../../web/sim/', import.meta.url);
const names = JSON.parse(readFileSync(new URL('names.json', root)));
const apls = Object.fromEntries(['fury', 'fury_2h', 'arms'].map(k => [k, JSON.parse(readFileSync(new URL(`apls/${k}.apl.json`, root)))]));

const parser = parseText(readFileSync(logPath, 'utf8'));
const war = parser.warriors();
console.log('warriors:', war.map(w => `${w.name} (${Math.round(w.damage)} dmg, gear: ${w.hasGear})`).join('; '));
const w = war[0];
const fights = parser.fights(w.guid);
console.log('fights:', fights.map(f => `${f.kind}:${f.name} ${((f.end - f.start) / 1000).toFixed(0)}s`).join('; '));
const fight = fights.find(f => f.kind === 'boss') || fights[0];
const a = analyzeFight(parser, w.guid, fight, names);
console.log(`spec ${a.preset}, ${a.dur.toFixed(0)}s, ${a.dps.toFixed(1)} dps, targets ${a.targetCount}, rage capped ${a.rageCapped}, idle ${a.idleSec.toFixed(1)}s, exec known ${a.executeKnown}`);
console.log('abilities:', a.abilities.map(x => `${x.name}:${x.casts}/${Math.round(x.damage)}`).join(' '));

const run = await loadSim(root);
const req = buildRequest(a, parser, names, apls, { iterations });
const t0 = Date.now();
const sim = compareToSim(run(req), names, iterations);
const cons = detectConsumes(a, parser, names);
const ideal = compareToSim(run(buildRequest(a, parser, names, apls, { iterations, consumes: 'ideal' })), names, iterations);
ideal.missing = missingConsumes(cons.found);
console.log(`sim ${sim.simDps.toFixed(1)} dps (ideal consumes ${ideal.simDps.toFixed(1)}) in ${Date.now() - t0}ms; consumes found: ${cons.found.map(f => f.name).join(', ')}`);
for (const s of suggestions(a, sim, ideal, aplSpellNames(apls[a.preset], names))) console.log(`- ${s.title}${s.gain ? ` [~${Math.round(s.gain)} dps]` : ''}\n    ${s.detail}`);
process.exit(0);
