// Checks the hand-kept Forever availability list and how the build applies it. Usage: node tests/availability_test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AVAIL, HELD_ITEMS, opensOn } from '../scripts/availability.mjs';

// Every entry says why; dates are real days.
for (const [k, v] of Object.entries(AVAIL)) if (!k.startsWith('_') && typeof v === 'object' && !Array.isArray(v)) assert.ok(v._why, `${k} needs a _why`);
for (const e of AVAIL.opensLater) { assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/); assert.ok(e._why); }
assert.equal(HELD_ITEMS.size, 0);

const raid = AVAIL.opensLater[0].date;
// The Watchers' signets (Barrow Deeps reputation) wait for the raids.
assert.equal(opensOn({ id: 275981, sources: [{ rep: { repFactionId: 2819, repLevel: 8 } }] }), raid);
// Head of Onyxia rewards and Quel'Serrar too.
assert.equal(opensOn({ id: 18406, sources: [{ quest: { id: 7491, zoneId: 1637 } }, { quest: { id: 7496, zoneId: 1519 } }] }), raid);
assert.equal(opensOn({ id: 18348, sources: [{ quest: { id: 7509, zoneId: 2159 } }] }), raid);
// Crafted from a Scale of Onyxia.
assert.equal(opensOn({ id: 15138, sources: [{ crafted: { profession: 8, spellId: 19093 } }] }), raid);
// A dungeon drop, and an item with one open source among held ones, can be had now.
assert.equal(opensOn({ id: 13965, sources: [{ drop: { zoneId: 1583, npcId: 1 } }] }), '');
assert.equal(opensOn({ id: 1, sources: [{ quest: { id: 7491 } }, { drop: { zoneId: 1583 } }] }), '');

// make_names.py marks the PTR-only enchant scrolls not in Forever, per slot type.
const ptr = AVAIL.ptrOnlyEnchantItems;
const inPtr = id => ptr.ids.includes(id) || ptr.ranges.some(([lo, hi]) => id >= lo && id <= hi);
for (const id of [273593, 273607, 273604, 273623]) assert.ok(inPtr(id), `${id} is a PTR-only scroll`);
for (const id of [16253, 16252, 20731, 249524, 249523, 16219, 11206]) assert.ok(!inPtr(id), `${id} is in Forever`);
assert.match(readFileSync(new URL('../scripts/make_names.py', import.meta.url), 'utf8'), /forever-availability\.json/);
console.log('availability_test: ok');
