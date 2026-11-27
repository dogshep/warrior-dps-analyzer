// "Gear upgrades": the best next item per slot and where it comes from.
//
// The heavy ranking happens at build time (scripts/precompute-upgrades.mjs writes sim/upgrades.json): every
// candidate was priced with stat weights, or simmed when weights can't price it (weapons, procs, on-use
// effects), against a reference gear set. Here the page picks a few
// of those that beat what the player wears and sims each one swapped into the player's own gear, so the DPS
// numbers it shows are for their setup (their other items, set bonuses, enchants, buffs and fight).

// Item pools, keyed by name, with the sim slot each is simmed in. Rings and trinkets share one pool for both slots.
export const SLOT_POOLS = { head: 0, neck: 1, shoulder: 2, back: 3, chest: 4, wrist: 5, hands: 6, waist: 7, legs: 8, feet: 9, ring: 10, trinket: 12, mh: 14, oh: 15, ranged: 16 };
// The pool for each sim slot (0 head ... 16 ranged).
export const SLOT_KEY = ['head', 'neck', 'shoulder', 'back', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet', 'ring', 'ring', 'trinket', 'trinket', 'mh', 'oh', 'ranged'];
const ARMOR_KEY = [null, 'head', 'neck', 'shoulder', 'back', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet', 'ring', 'trinket'];
// The slot worn beside each paired slot: a unique item can't be in both.
const PAIR = { 10: 11, 11: 10, 12: 13, 13: 12, 14: 15, 15: 14 };

// Which pools an item from wowsims' db.json belongs to for a rotation (build time only). Fury dual wields;
// the two-hander and Arms rotations take a two-hand weapon and nothing in the off hand.
export function poolFor(it, preset) {
  const t = it.type || 0;
  if (t >= 1 && t <= 12) return [ARMOR_KEY[t]];
  if (t === 14) return ['ranged'];
  if (t !== 13) return [];
  const h = it.handType || 0;
  if (preset === 'fury') return [...(h === 1 || h === 2 ? ['mh'] : []), ...(h === 2 || h === 3 ? ['oh'] : [])];
  return h === 4 ? ['mh'] : [];
}

// Log faction (1 Alliance, 0 Horde) to the table's (1 Alliance, 2 Horde); unknown matches both.
const sideOf = f => (f === 1 ? 1 : f === 0 ? 2 : 0);

// Picks what to sim. gear: the 17 sim slots as in a RaidSimRequest ({id, enchant} or {}). Returns
// [{slot, id, est}] where est is the build-time guess at the DPS gain over the current item, best first.
// At most `perSlot` per slot and `max` in all: every slot with a likely upgrade gets its best candidate first,
// then second picks fill what is left of the budget, biggest guesses first. groups: which sources to include
// ('open' dungeons, crafting, quests, vendors and reputation; 'raid'; 'pvp').
export function pickCandidates(gear, table, preset, faction, { perSlot = 2, max = 16, minGain = 1, groups = ['open', 'raid'] } = {}) {
  const p = table?.presets?.[preset];
  if (!p) return [];
  const side = sideOf(faction);
  const bySlot = [];
  // An item outside the table is below level 60 rare quality or has no stat a DPS warrior uses.
  const valueOf = slot => {
    const cur = gear[slot]?.id, pool = p.slots[SLOT_KEY[slot]];
    const row = cur && pool && pool.find(r => r[0] === cur);
    return row ? row[1] : -Infinity;
  };
  for (let slot = 0; slot < SLOT_KEY.length; slot++) {
    const pool = p.slots[SLOT_KEY[slot]];
    if (!pool) continue;
    const cur = gear[slot]?.id;
    const other = gear[PAIR[slot]]?.id;
    const curVal = valueOf(slot);
    let limit = perSlot;
    // Rings and trinkets: a new one replaces the weaker of the two, so only that slot gets candidates (twice as many).
    if (slot >= 10 && slot <= 13) {
      const ov = valueOf(PAIR[slot]);
      if (ov < curVal || (ov === curVal && PAIR[slot] < slot)) continue;
      limit = perSlot * 2;
    }
    const picks = [];
    for (const [id, val, simmed] of pool) {
      // Weapons are only picked when the build simmed them; weights alone misjudge speed and procs.
      if (id === cur || id === other || (slot >= 14 && !simmed)) continue;
      const meta = table.items[id];
      if (!meta || (side && meta[1] && meta[1] !== side) || !groups.includes(meta[3])) continue;
      const est = val - curVal;
      if (est < minGain) continue;
      picks.push({ slot, id, est: Number.isFinite(est) ? est : null, val });
      if (picks.length >= limit) break;
    }
    if (picks.length) bySlot.push(picks);
  }
  // A null est (nothing known about the current item) sorts by the candidate's own value.
  const key = c => (c.est ?? c.val + 1000);
  const first = bySlot.map(l => l[0]).sort((a, b) => key(b) - key(a)).slice(0, max);
  const rest = bySlot.flatMap(l => l.slice(1)).sort((a, b) => key(b) - key(a)).slice(0, Math.max(0, max - first.length));
  return [...first, ...rest].map(({ slot, id, est }) => ({ slot, id, est }));
}

// The same request with one item swapped. It keeps the enchant on that slot, so the gain is the item's alone.
export function swapRequest(request, slot, id) {
  const r = structuredClone(request);
  const items = r.raid.parties[0].players[0].equipment.items;
  const old = items[slot] || {};
  items[slot] = old.enchant ? { id, enchant: old.enchant } : { id };
  return r;
}

// One row per slot from the sim results: the best candidate that is an actual gain, biggest first.
// results: [{slot, id, dps}] with dps the swap sim's DPS; base: the same-length sim of the current gear.
export function bestPerSlot(results, base, minGain = 1) {
  const best = new Map();
  for (const r of results) {
    const gain = r.dps - base;
    if (gain < minGain) continue;
    if (!best.has(r.slot) || gain > best.get(r.slot).gain) best.set(r.slot, { ...r, gain });
  }
  // A ring or trinket pool can name the same item for both slots; keep it on the slot where it gains more.
  const seen = new Map();
  for (const r of [...best.values()].sort((a, b) => b.gain - a.gain)) if (!seen.has(r.id)) seen.set(r.id, r);
  return [...seen.values()];
}
