// Runs scripts/make_names.py on a tiny made-up db.json and checks the slim lookup tables it writes.
// Skipped (with a note) when python3 is not installed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const avail = JSON.parse(readFileSync(new URL('../data/forever-availability.json', import.meta.url), 'utf8'));
const ptrId = avail.ptrOnlyEnchantItems.ids[0];
const heldEffect = Number(Object.keys(avail.enchantsNotInForever).find(k => !k.startsWith('_')));

const db = {
  items: [
    { id: 1, name: 'Sword', type: 13, quality: 4, handType: 4, weaponSpeed: 3.5, scalingOptions: { 0: { ilvl: 66 } } },
    { id: 2, name: 'Plate Chest', type: 5, quality: 3, setId: 9, scalingOptions: { 0: { ilvl: 62, stats: { 0: 20, 1: 0, 3: 15 } } }, pseudoStats: [0, 2] },
    { id: 3, name: 'Bare' },
  ],
  enchants: [
    { effectId: 1887, name: 'Greater Agility', type: 8, extraTypes: [7, 10], stats: [0, 7] },
    { effectId: 1900, name: 'Crusader', type: 13, itemId: 12345 },
    { effectId: 5000, name: 'Scroll', type: 4, itemId: ptrId },
    { effectId: heldEffect, name: 'Held', type: 5 },
    { effectId: 6000, name: 'Unknown phase', type: 3, phase: 2 },
    { effectId: 6000, name: 'Same id, other phase', type: 3, phase: 1 },
  ],
  spellIcons: [{ id: 10, name: 'Battle Shout', rank: 7 }, { id: 11, name: 'Whirlwind' }],
  consumables: [
    { id: 100, type: 11, name: 'Mongoose', itemEffects: [{ buffId: 17538 }, {}] },
    { id: 101, type: 7, name: 'Stone', temporaryEnchant: { effectId: 2506 } },
  ],
};

const dir = mkdtempSync(join(tmpdir(), 'names-'));
try {
  writeFileSync(join(dir, 'db.json'), JSON.stringify(db));
  const script = fileURLToPath(new URL('../scripts/make_names.py', import.meta.url));
  const r = spawnSync('python3', [script, join(dir, 'db.json'), join(dir, 'names.json')], { encoding: 'utf8' });
  if (r.error?.code === 'ENOENT') { console.log('make_names_test: skipped (no python3)'); process.exit(0); }
  assert.equal(r.status, 0, r.stderr);
  const n = JSON.parse(readFileSync(join(dir, 'names.json'), 'utf8'));

  // Items are [name, type, quality, ilvl, hand type, speed]; missing fields become 0.
  assert.deepEqual(n.items[1], ['Sword', 13, 4, 66, 4, 3.5]);
  assert.deepEqual(n.items[3], ['Bare', 0, 0, 0, 0, 0]);
  // Set armor keeps its stats (zeros dropped) and pseudo stats; weapons in a set are skipped.
  assert.deepEqual(n.setItems, { 2: [{ 0: 20, 3: 15 }, { 1: 2 }] });

  // One effect id can be a different enchant per slot type.
  assert.deepEqual(n.enchants[1887], { 8: 'Greater Agility', 7: 'Greater Agility', 10: 'Greater Agility' });
  assert.deepEqual(n.enchantStats[1887], { 8: { 1: 7 }, 7: { 1: 7 }, 10: { 1: 7 } });
  // Phases: 1 = in Forever now; PTR-only scrolls and held-back ids are 2; phase 1 wins over 2 for the same slot.
  assert.deepEqual(n.enchantPhase[1900], { 13: 1 });
  assert.deepEqual(n.enchantPhase[5000], { 4: 2 });
  assert.deepEqual(n.enchantPhase[heldEffect], { 5: 2 });
  assert.deepEqual(n.enchantPhase[6000], { 3: 1 });

  assert.equal(n.spells[10], 'Battle Shout (Rank 7)');
  assert.equal(n.spells[11], 'Whirlwind');
  assert.deepEqual(n.consumes, { 17538: [100, 11, 'Mongoose'] });
  assert.deepEqual(n.imbues, { 2506: [101, 7, 'Stone'] });
  console.log('make_names_test: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
