// The slot table (web/js/slots.js) and the source kinds (web/js/fields.js) that other files read.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SLOTS, SLOT_NAMES, SLOT_ITEM_TYPE, LOG_TO_SIM_SLOTS, SLOT_KEY, PAIR, SLOT_POOLS, SLOT_MH, SLOT_OH, poolOfItemType, isRingOrTrinket, isWeaponSlot } from '../web/js/slots.js';
import { SOURCE_KINDS, KIND_KEYS } from '../web/js/fields.js';

assert.equal(SLOTS.length, 17);
assert.equal(SLOT_NAMES[SLOT_MH], 'Main hand');
assert.equal(SLOT_NAMES[SLOT_OH], 'Off hand');
// The order wowsims' EquipmentSpec wants, and where each slot sits in the combat log's gear list.
assert.deepEqual(LOG_TO_SIM_SLOTS, [0, 1, 2, 14, 4, 8, 9, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17]);
assert.equal(new Set(LOG_TO_SIM_SLOTS).size, 17);
assert.deepEqual(SLOT_ITEM_TYPE, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11, 12, 12, 13, 13, 14]);
assert.deepEqual(PAIR, { 10: 11, 11: 10, 12: 13, 13: 12, 14: 15, 15: 14 });
assert.deepEqual(SLOT_POOLS, { head: 0, neck: 1, shoulder: 2, back: 3, chest: 4, wrist: 5, hands: 6, waist: 7, legs: 8, feet: 9, ring: 10, trinket: 12, mh: 14, oh: 15, ranged: 16 });
assert.deepEqual(Object.keys(SLOT_POOLS), [...new Set(SLOT_KEY)]);
assert.equal(poolOfItemType(11), 'ring');
assert.equal(poolOfItemType(5), 'chest');
assert.deepEqual([10, 11, 12, 13].filter(isRingOrTrinket), [10, 11, 12, 13]);
assert.equal(isRingOrTrinket(14), false);
assert.deepEqual(SLOTS.map((_, i) => i).filter(isWeaponSlot), [14, 15, 16]);

// The source checkboxes in index.html are the source kinds, in the same order.
const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const boxes = [...html.matchAll(/class="upgKind" value="(\w)"/g)].map(m => m[1]).join('');
assert.equal(boxes, KIND_KEYS);
assert.equal(SOURCE_KINDS.length, KIND_KEYS.length);
console.log('slots tests passed');
