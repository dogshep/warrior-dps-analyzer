// Unit checks for picking upgrade candidates. Usage: node tests/upgrades_test.mjs
import assert from 'node:assert/strict';
import { pickCandidates, openNow, swapRequest, bestPerSlot, poolFor, budget, yellowMiss, breaksHitCap, setChange, withoutSetRequest } from '../web/js/upgrades.js';
import { auditEnchants } from '../web/js/analyze.js';

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
// Hit cap: the sheet's auto attack miss includes the 19% dual-wield penalty, special attacks don't.
assert.equal(yellowMiss(18, true), 0);
assert.equal(yellowMiss(20, true), 1);
assert.equal(yellowMiss(2, false), 2);
assert.equal(breaksHitCap(0, 1), true);   // capped, then 1% under
assert.equal(breaksHitCap(0, 0), false);  // still capped (spare hit lost only)
assert.equal(breaksHitCap(2, 2), false);  // already under, no worse
assert.equal(breaksHitCap(2, 3), true);   // already under, worse
// Set bonuses lost and gained.
assert.deepEqual(setChange(['Devilsaur Armor (2pc)'], []), { lost: ['Devilsaur Armor (2pc)'], gained: [] });
assert.deepEqual(setChange([], ['Devilsaur Armor (2pc)']), { lost: [], gained: ['Devilsaur Armor (2pc)'] });
// Without the set: the slot is emptied and its stats come back as bonus stats.
const ws = withoutSetRequest(req, 6, { 14: 28, 18: 14 }, { 12: 1 });
assert.deepEqual(ws.raid.parties[0].players[0].equipment.items[6], {});
assert.equal(ws.raid.parties[0].players[0].bonusStats.stats[14], 28);
assert.equal(ws.raid.parties[0].players[0].bonusStats.pseudoStats[12], 1);
// The budget after a check drops the best pick of a slot: the next one moves up.
const cs = [{ slot: 0, id: 1, est: 10, rank: 0 }, { slot: 0, id: 2, est: 8, rank: 1 }, { slot: 0, id: 3, est: 6, rank: 2 }, { slot: 6, id: 9, est: 4, rank: 1 }];
assert.deepEqual(budget(cs.slice(1), 3, 2).map(c => [c.id, c.rank]), [[2, 0], [9, 0], [3, 1]]);

// Enchants: only ones in Forever are suggested (no Living Stats, no Grand Crusader, no shoulder enchant that
// wowsims marks unavailable).
const names = { items: { 1: ['Chest', 5], 2: ['Sword', 13, 3, 60, 2], 3: ['Shoulders', 3] }, enchants: {}, enchantPhase: { 2717: 2, 2606: 2 } };
const eg = []; eg[4] = { id: 1, enchant: 0 }; eg[15] = { id: 2, enchant: 0 }; eg[2] = { id: 3, enchant: 0 };
const audit = auditEnchants(eg, names);
assert.deepEqual(audit.find(e => e.slot === 4).best, ['Greater Stats (+4 all stats)']);
assert.deepEqual(audit.find(e => e.slot === 14).best, ['Crusader']);
assert.ok(!audit.some(e => e.slot === 2));
// Per slot type (names.json now): +15 Strength is in Forever on weapons but only a PTR scroll on gloves, and the
// +5 Agility cloak scroll is PTR only, so the audit falls back to what can be had.
const n2 = { items: { 5: ['Gloves', 7], 6: ['Cloak', 4] }, enchants: {}, enchantPhase: { 2564: { 7: 1 }, 2563: { 7: 2, 13: 1 }, 8206: { 7: 1 }, 8207: { 7: 1 }, 7667: { 4: 2 }, 849: { 4: 1 } } };
const g2 = []; g2[9] = { id: 5, enchant: 0 }; g2[14] = { id: 6, enchant: 0 };
const a2 = auditEnchants(g2, n2);
assert.deepEqual(a2.find(e => e.slot === 6).best, ['Superior Agility (+15)']);
assert.deepEqual(a2.find(e => e.slot === 3).best, ['Lesser Agility (+3)']);

// Items that open later in Forever (the raids on 2026-12-09) stay out until that day, then come in.
const t2 = { presets: { fury: { slots: { ring: [[31, 20, 0], [32, 10, 0]] } } }, items: { 31: ['Head of Onyxia', 0, 1, 'q', '2026-12-09'], 32: ['Dungeon', 0, 1, 'd'] } };
const before = Date.parse('2026-12-01T12:00:00'), after = Date.parse('2026-12-09T12:00:00');
assert.deepEqual(pickCandidates(gear, t2, 'fury', 0, { now: before }).map(x => x.id), [32]);
assert.deepEqual(pickCandidates(gear, t2, 'fury', 0, { now: after }).map(x => x.id), [31, 32]);
assert.equal(openNow(['x', 0, 1, 'd']), true);
console.log('upgrades_test: ok');
