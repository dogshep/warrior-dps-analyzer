// Checks the item helpers of scripts/precompute-upgrades.mjs (importing it does not start the build).
import assert from 'node:assert/strict';
import { sourceText, factionOf, kindsOf, usable, special } from '../scripts/precompute-upgrades.mjs';

const db = { zoneName: new Map([[1, 'Blackrock Spire'], [2, 'Molten Core']]), npcName: new Map([[10, 'Rend'], [11, 'Drakkisath'], [12, 'Gyth'], [13, 'Beast'], [14, 'Omokk']]), factionName: new Map([[529, 'Argent Dawn']]) };

// --- sourceText ---
assert.equal(sourceText(db, { sources: [{ drop: { zoneId: 1, npcId: 10 } }] }), 'Blackrock Spire: Rend');
assert.equal(sourceText(db, { sources: [{ drop: { zoneId: 1, npcId: 10 } }, { drop: { zoneId: 1, npcId: 10 } }] }), 'Blackrock Spire: Rend', 'duplicate bosses collapse');
assert.equal(sourceText(db, { sources: [10, 11, 12, 13, 14].map(npcId => ({ drop: { zoneId: 1, npcId } })) }), 'Blackrock Spire: Rend, Drakkisath, Gyth +2 more');
assert.equal(sourceText(db, { sources: [{ drop: { otherName: 'World Drop' } }] }), 'World drop');
assert.equal(sourceText(db, { sources: [{ quest: { name: 'Q', zoneId: 2 } }, { soldBy: { npcName: 'Vendor' } }, { crafted: { profession: 2 } }, { rep: { repFactionId: 529, repLevel: 7 } }, { pvp: {} }] }), 'Quest: Q (Molten Core) · Sold by Vendor · Crafted: Blacksmithing', 'at most 3 entries');
assert.equal(sourceText(db, { sources: [{ rep: { repFactionId: 529, repLevel: 7 } }] }), 'Argent Dawn, Revered');
assert.equal(sourceText(db, {}), '');

// --- factionOf ---
assert.equal(factionOf({ name: 'Grand Marshal\'s Sword' }), 1);
assert.equal(factionOf({ name: 'High Warlord\'s Axe' }), 2);
assert.equal(factionOf({ name: 'X', sources: [{ quest: { faction: 2 } }] }), 2);
assert.equal(factionOf({ name: 'X', sources: [{ quest: { faction: 2 } }, { drop: {} }] }), 0, 'a neutral source makes it both');
assert.equal(factionOf({ name: 'X', sources: [{ quest: { faction: 1 } }, { soldBy: { faction: 2 } }] }), 0, 'two sides: both');
assert.equal(factionOf({ name: 'X', sources: [{ rep: { factionId: 1 } }] }), 1);
assert.equal(factionOf({ name: 'X' }), 0);

// --- kindsOf ---
const raid = new Set([2]);
assert.equal(kindsOf({ sources: [{ pvp: {} }, { soldBy: {} }] }, raid), 'p');
assert.equal(kindsOf({ sources: [{ drop: { difficulty: 2 } }, { drop: { difficulty: 1 } }] }, raid), 'dr', 'kinds come out in KINDS order');
assert.equal(kindsOf({ sources: [{ quest: { zoneId: 2 } }] }, raid), 'r', 'a quest from a raid counts as a raid');
assert.equal(kindsOf({ sources: [{ quest: { zoneId: 1 } }, { crafted: {} }, { soldBy: {} }, { rep: {} }] }, raid), 'cqvf');
assert.equal(kindsOf({}, raid), '');

// --- usable ---
const good = { id: 1, phase: 1, quality: 4, scalingOptions: { 0: { ilvl: 66 } }, sources: [{ drop: {} }], type: 1, armorType: 3 };
assert.equal(usable(good), true);
assert.equal(usable({ ...good, phase: 2 }), false);
assert.equal(usable({ ...good, quality: 2 }), false);
assert.equal(usable({ ...good, scalingOptions: { 0: { ilvl: 50 } } }), false);
assert.equal(usable({ ...good, sources: [] }), false);
assert.equal(usable({ ...good, randomSuffixOptions: [1] }), false);
assert.equal(usable({ ...good, classAllowlist: [2, 3] }), false);
assert.equal(usable({ ...good, classAllowlist: [1, 2] }), true);
assert.equal(usable({ ...good, armorType: 1 }), false, 'cloth');
assert.equal(usable({ ...good, type: 4, armorType: 1 }), true, 'cloaks are cloth but fine');
assert.equal(usable({ ...good, type: 13, weaponType: 7 }), false, 'shield');
assert.equal(usable({ ...good, type: 14, rangedWeaponType: 5 }), false, 'wand');
assert.equal(usable({ ...good, type: 14, rangedWeaponType: 2 }), true);

// --- special ---
assert.equal(special({ itemEffects: [{}] }), true);
assert.equal(special({ pseudoStats: [0, 1] }), true);
assert.equal(special({ pseudoStats: [0, 0] }), false);
assert.equal(special({}), false);
console.log('precompute_test: ok');
