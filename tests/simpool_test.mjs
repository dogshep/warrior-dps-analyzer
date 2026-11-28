// Checks the merge of sim runs split across workers (web/js/simpool.js).
import assert from 'node:assert/strict';
import { mergeRuns } from '../web/js/simpool.js';

const run = (avg, stdev, iterations, casts) => ({ iterations, raidMetrics: { parties: [{ players: [{ dps: { avg, stdev }, actions: [{ id: { spellId: 1 }, targets: [{ casts, damage: casts * 10 }] }] }] }] } });

// One run comes back as it is.
const one = run(400, 20, 300, 5);
assert.equal(mergeRuns([one]), one);

// Two runs: iteration-weighted mean, pooled variance, actions concatenated, iterations summed.
const m = mergeRuns([run(400, 20, 100, 5), run(410, 30, 300, 7)]);
const p = m.raidMetrics.parties[0].players[0];
assert.equal(m.iterations, 400);
assert.ok(Math.abs(p.dps.avg - 407.5) < 1e-9);
const variance = (100 * (20 ** 2 + 7.5 ** 2) + 300 * (30 ** 2 + 2.5 ** 2)) / 400;
assert.ok(Math.abs(p.dps.stdev - Math.sqrt(variance)) < 1e-9);
assert.equal(p.actions.length, 2);

// Matches the direct numbers of a sample split in two.
const xs = Array.from({ length: 1000 }, (_, i) => 300 + ((i * 7919) % 201));
const stats = a => { const mu = a.reduce((s, x) => s + x, 0) / a.length; return [mu, Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / a.length)]; };
const [mu, sd] = stats(xs), [m1, s1] = stats(xs.slice(0, 400)), [m2, s2] = stats(xs.slice(400));
const mm = mergeRuns([run(m1, s1, 400, 0), run(m2, s2, 600, 0)]).raidMetrics.parties[0].players[0].dps;
assert.ok(Math.abs(mm.avg - mu) < 1e-9 && Math.abs(mm.stdev - sd) < 1e-9);

console.log('simpool tests passed');
