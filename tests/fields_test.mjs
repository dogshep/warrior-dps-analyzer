// The named tuple positions in web/js/fields.js must match what the build scripts write.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ITEM, ITEM_TYPE_WEAPON, HAND_TWO, SRC, PRICE } from '../web/js/fields.js';
import { priceFor } from '../web/js/prices.js';

assert.deepEqual(Object.values(ITEM), [0, 1, 2, 3, 4, 5]);
assert.deepEqual(Object.values(SRC), [0, 1, 2, 3, 4]);

// make_names.py writes items in ITEM order.
let have = true;
const dir = mkdtempSync(join(tmpdir(), 'fields-'));
try {
  writeFileSync(join(dir, 'db.json'), JSON.stringify({ items: [{ id: 1, name: 'Sword', type: 13, quality: 4, handType: 4, weaponSpeed: 3.5, scalingOptions: { 0: { ilvl: 66 } } }] }));
  try { execFileSync('python3', ['scripts/make_names.py', join(dir, 'db.json'), join(dir, 'n.json')]); } catch (e) { if (e.code === 'ENOENT') have = false; else throw e; }
  if (have) {
    const it = JSON.parse(readFileSync(join(dir, 'n.json'), 'utf8')).items[1];
    assert.equal(it[ITEM.NAME], 'Sword');
    assert.equal(it[ITEM.TYPE], ITEM_TYPE_WEAPON);
    assert.equal(it[ITEM.QUALITY], 4);
    assert.equal(it[ITEM.ILVL], 66);
    assert.equal(it[ITEM.HAND], HAND_TWO);
    assert.equal(it[ITEM.SPEED], 3.5);
  }
} finally { rmSync(dir, { recursive: true, force: true }); }

// prices.js reads the price tuple by PRICE.
const prices = { houses: { h: { updated: 'u', items: { 1: [10, 20, 3], 2: [10, 20, 3, 500, 1] } } } };
assert.deepEqual(priceFor(prices, 'h', 1), { min: 10, median: 20, listed: 3, updated: 'u' });
assert.deepEqual(priceFor(prices, 'h', 2), { min: 10, median: 20, listed: 3, updated: 'u', materials: PRICE.MATERIALS === 3 ? 500 : 0, unpriced: 1 });
console.log('fields_test: ok');
