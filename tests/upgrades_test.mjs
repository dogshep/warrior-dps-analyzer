// Unit checks for picking upgrade candidates. Usage: node tests/upgrades_test.mjs
import assert from 'node:assert/strict';
import { pickCandidates, swapRequest, bestPerSlot, poolFor } from '../web/js/upgrades.js';

// [id, value vs the reference item, simmed]; items: [source, faction, phase, group]
const table = {
  presets: {
    fury: {
      slots: {
        head: [[1, 20, 0], [2, 10, 0], [3, 5, 0], [4, 0, 0]],
        ring: [[11, 15, 0], [12, 12, 0], [13, 3, 0], [14, -5, 0]],
        mh: [[21, 30, 1], [22, 25, 1]],
      },
    },
  },
  items: {
    1: ['Raid boss', 0, 1, 'r'], 2: ['Quest', 1, 1, 'q'], 3: ['Crafted', 0, 1, 'c'], 4: ['x', 0, 1, 'c'],
    11: ['Vendor or rep', 2, 1, 'vf'], 12: ['Dungeon', 0, 1, 'd'], 13: ['d', 0, 1, 'd'], 14: ['d', 0, 1, 'd'],
    21: ['PvP', 0, 1, 'p'], 22: ['Dungeon', 0, 1, 'd'],
  },
};
const gear = Array.from({ length: 17 }, () => ({}));
gear[0] = { id: 3, enchant: 2543 };
gear[10] = { id: 13 };
gear[11] = { id: 14 };

// Horde (log faction 0): the Alliance-only quest helm is out, the raid helm is in.
let c = pickCandidates(gear, table, 'fury', 0, { kinds: 'drcqvf' });
assert.deepEqual(c.filter(x => x.slot === 0).map(x => x.id), [1]);
// Alliance: both helms, best first; the gain is over the worn helm (value 5).
c = pickCandidates(gear, table, 'fury', 1, { kinds: 'drcqvf' });
assert.deepEqual(c.filter(x => x.slot === 0).map(x => [x.id, x.est]), [[1, 15], [2, 5]]);
// Without raids, only the quest helm.
c = pickCandidates(gear, table, 'fury', 1, { kinds: 'dcqvf' });
assert.deepEqual(c.filter(x => x.slot === 0).map(x => x.id), [2]);
// Rings: new rings go against the weaker one (slot 11, value -5), never the other worn ring, twice the per-slot count.
c = pickCandidates(gear, table, 'fury', 0, { kinds: 'dcqvf' });
assert.deepEqual(c.filter(x => x.slot === 10 || x.slot === 11).map(x => [x.slot, x.id]), [[11, 11], [11, 12]]);
// An empty main hand: anything counts; PvP is left out unless asked for.
assert.deepEqual(c.filter(x => x.slot === 14).map(x => [x.id, x.est]), [[22, null]]);
// One source kind only: reputation finds the Horde ring sold for rep, and nothing for the head.
c = pickCandidates(gear, table, 'fury', 0, { kinds: 'f' });
assert.deepEqual(c.map(x => [x.slot, x.id]), [[11, 11]]);
assert.deepEqual(pickCandidates(gear, table, 'fury', 0, { kinds: '' }), []);
// The budget: every slot's best pick first, then second picks.
c = pickCandidates(gear, table, 'fury', 1, { kinds: 'drcqvfp', max: 3 });
assert.equal(c.length, 3);
assert.deepEqual(new Set(c.map(x => x.slot)), new Set([0, 11, 14]));

// The swap keeps the slot's enchant and leaves the original request alone.
const req = { raid: { parties: [{ players: [{ equipment: { items: gear } }] }] } };
const s = swapRequest(req, 0, 2);
assert.deepEqual(s.raid.parties[0].players[0].equipment.items[0], { id: 2, enchant: 2543 });
assert.equal(gear[0].id, 3);

// One row per slot, real gains only, and the same ring is not listed twice.
const rows = bestPerSlot([{ slot: 0, id: 1, dps: 510 }, { slot: 0, id: 2, dps: 505 }, { slot: 10, id: 11, dps: 499.5 }, { slot: 11, id: 12, dps: 507 }, { slot: 10, id: 12, dps: 503 }], 500);
assert.deepEqual(rows.map(r => [r.slot, r.id, r.gain]), [[0, 1, 10], [11, 12, 7]]);

// Pools: fury dual wields; the other rotations take two-handers only.
assert.deepEqual(poolFor({ type: 13, handType: 2 }, 'fury'), ['mh', 'oh']);
assert.deepEqual(poolFor({ type: 13, handType: 4 }, 'fury'), []);
assert.deepEqual(poolFor({ type: 13, handType: 4 }, 'arms'), ['mh']);
assert.deepEqual(poolFor({ type: 11 }, 'arms'), ['ring']);
console.log('upgrades_test: ok');
