// The pure pieces of the Gear upgrades flow (web/js/upgrades-ui.js): sim jobs, results and set bonus costs.
import assert from 'node:assert/strict';
import { jobsFor, resultsOf, setCostOf, setJobsFor } from '../web/js/upgrades-ui.js';

const base = { raid: { parties: [{ players: [{ equipment: { items: [{ id: 1 }, { id: 2, enchant: 9 }] } }] }] }, simOptions: { iterations: 100 } };
const cands = [{ slot: 0, id: 10 }, { slot: 1, id: 20 }];

// The base job gets twice the fights, each candidate one swap, each set job its own request.
const jobs = jobsFor(base, cands, [{ slot: 1, stats: { 0: 5 }, pseudo: {} }], 100);
assert.deepEqual(jobs.map(j => [j.k, j.w]), [['base', 2], ['0:10', 1], ['1:20', 1], ['set1', 1]]);
assert.equal(jobs[0].req.simOptions.iterations, 200);
assert.equal(base.simOptions.iterations, 100, 'the base request is not changed');
assert.equal(jobs[1].req.raid.parties[0].players[0].equipment.items[0].id, 10);
assert.deepEqual(jobs[2].req.raid.parties[0].players[0].equipment.items[1], { id: 20, enchant: 9 });

// Results keep only candidates whose sim finished, with the standard error against the base.
const out = new Map([['0:10', { avg: 110, stdev: 30, n: 100 }]]);
const b = { avg: 100, stdev: 40, n: 100 };
const res = resultsOf(cands, out, b);
assert.equal(res.length, 1);
assert.deepEqual([res[0].id, res[0].dps], [10, 110]);
assert.ok(Math.abs(res[0].err - 5) < 1e-9); // sqrt(30^2/100 + 40^2/100)

// A broken set bonus costs the base DPS minus the DPS without the item.
const cost = setCostOf([{ slot: 1 }, { slot: 0 }], new Map([['set1', { avg: 90, stdev: 30, n: 100 }]]), b);
assert.deepEqual([...cost.keys()], [1]);
assert.equal(cost.get(1).dps, 10);

// Set jobs: one per slot with a lost set bonus, with the item's stats and its enchant's stats added back.
const names = { setItems: { 2: [{ 1: 7 }, { 3: 1 }] }, enchantStats: { 9: { 1: { 1: 4 } } } };
const gear = [{}, { id: 2, enchant: 9 }];
const sets = setJobsFor([{ slot: 1, sets: { lost: ['X (2pc)'] } }, { slot: 0, sets: { lost: [] } }], gear, names);
assert.deepEqual(sets, [{ slot: 1, stats: { 1: 11 }, pseudo: { 3: 1 } }]);
console.log('upgrades-ui tests passed');
