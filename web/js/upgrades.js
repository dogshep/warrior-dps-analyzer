// "Gear upgrades": the best next item per slot and where it comes from.
//
// The heavy ranking happens at build time (scripts/precompute-upgrades.mjs writes sim/upgrades.json): every
// candidate was priced with stat weights, or simmed when weights can't price it (weapons, procs, on-use
// effects), against a reference gear set. Here the page picks a few of those that beat what the player wears
// and sims each one swapped into the player's own gear, so the DPS numbers it shows are for their setup
// (their other items, set bonuses, enchants, buffs and fight).

import { SRC, ITEM_TYPE_WEAPON, ITEM_TYPE_RANGED, HAND } from './fields.js';
import { SLOT_KEY, PAIR, poolOfItemType, isRingOrTrinket, isWeaponSlot } from './slots.js';

// Which pools an item from wowsims' db.json belongs to for a rotation (build time only). Fury dual wields;
// the two-hander and Arms rotations take a two-hand weapon and nothing in the off hand.
export function poolFor(it, preset) {
  const t = it.type || 0;
  if (t >= 1 && t <= 12) return [poolOfItemType(t)];
  if (t === ITEM_TYPE_RANGED) return ['ranged'];
  if (t !== ITEM_TYPE_WEAPON) return [];
  const h = it.handType || 0;
  if (preset === 'fury') return [...(h === HAND.MAIN || h === HAND.ONE ? ['mh'] : []), ...(h === HAND.ONE || h === HAND.OFF ? ['oh'] : [])];
  return h === HAND.TWO ? ['mh'] : [];
}

// Log faction (1 Alliance, 0 Horde) to the table's (1 Alliance, 2 Horde); unknown matches both.
const sideOf = f => (f === 1 ? 1 : f === 0 ? 2 : 0);

// Picks what to sim. gear: the 17 sim slots as in a RaidSimRequest ({id, enchant} or {}). Returns
// [{slot, id, est}] where est is the build-time guess at the DPS gain over the current item, best first.
// At most `perSlot` per slot and `max` in all (see budget). kinds: the sources to include, as
// letters (d dungeon or world drop, r raid, c crafted, q quest, v vendor, f reputation, p PvP); an item with
// several sources is in when any of them is. An item WoW Forever only opens later (its date, the table's 5th field,
// from data/forever-availability.json) is left out until that day in the viewer's time zone, so it shows up then
// without a rebuild.
export const openNow = (meta, now = Date.now()) => !meta[SRC.OPENS] || now >= Date.parse(`${meta[SRC.OPENS]}T00:00:00`);
export function pickCandidates(gear, table, preset, faction, { perSlot = 2, max = 16, minGain = 1, kinds = 'drcqvf', now = Date.now() } = {}) {
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
    if (isRingOrTrinket(slot)) {
      const ov = valueOf(PAIR[slot]);
      if (ov < curVal || (ov === curVal && PAIR[slot] < slot)) continue;
      limit = perSlot * 2;
    }
    const picks = [];
    for (const [id, val, simmed] of pool) {
      // Weapons are only picked when the build simmed them; weights alone misjudge speed and procs.
      if (id === cur || id === other || (isWeaponSlot(slot) && !simmed)) continue;
      const meta = table.items[id];
      if (!meta || !openNow(meta, now) || (side && meta[SRC.FACTION] && meta[SRC.FACTION] !== side) || ![...meta[SRC.KINDS]].some(k => kinds.includes(k))) continue;
      const est = val - curVal;
      if (est < minGain) continue;
      picks.push({ slot, id, est: Number.isFinite(est) ? est : null, val });
      if (picks.length >= limit) break;
    }
    picks.forEach((c, i) => (c.rank = i));
    bySlot.push(...picks);
  }
  return budget(bySlot, max, perSlot);
}

// Cuts a candidate list (each with its rank within its slot, 0 = best) to `max`: every slot's best first, then
// second picks and so on, biggest guesses first. Used again after candidates that fail a check are dropped.
// perSlot (twice that for rings and trinkets, which all go against the weaker one) caps each slot.
export function budget(cands, max, perSlot = Infinity) {
  // A null est (nothing known about the current item) sorts by the candidate's own value.
  const key = c => (c.est ?? c.val + 1000);
  const bySlot = new Map();
  for (const c of cands) bySlot.set(c.slot, [...(bySlot.get(c.slot) || []), c]);
  const kept = [];
  for (const [slot, l] of bySlot) {
    const limit = isRingOrTrinket(slot) ? perSlot * 2 : perSlot;
    l.sort((a, b) => a.rank - b.rank).slice(0, limit).forEach((c, i) => kept.push({ ...c, rank: i }));
  }
  return kept.sort((a, b) => a.rank - b.rank || key(b) - key(a)).slice(0, max);
}

// The yellow (special attack) miss chance left after hit, in percent, from the sheet's main-hand auto attack miss
// chance: dual wielding adds 19% to auto attacks only.
export const yellowMiss = (remainingHit, dualWield) => Math.max(0, remainingHit - (dualWield ? 19 : 0));

// Whether a swap takes the player below the hit cap: special attacks would miss after it, and more often than now.
// A player already under the cap may still swap to an item that doesn't lose hit.
export const breaksHitCap = (missBefore, missAfter) => missAfter > 0.05 && missAfter > missBefore + 0.05;

// Set bonuses a swap loses and gains, from the sheet's active set lists ("Devilsaur Armor (2pc)").
export function setChange(before, after) {
  return { lost: before.filter(x => !after.includes(x)), gained: after.filter(x => !before.includes(x)) };
}

// The current gear with the item in `slot` taken out and its stats (and its enchant's) added back as bonus stats:
// the same character without that item's set bonus. Comparing it with the current gear prices the bonus.
// stats: {statIndex: value}, pseudo: {pseudoStatIndex: value}.
export function withoutSetRequest(request, slot, stats, pseudo = {}) {
  const r = structuredClone(request);
  const player = r.raid.parties[0].players[0];
  player.equipment.items[slot] = {};
  const bonus = player.bonusStats || {};
  const arr = (a, n) => Array.from({ length: n }, (_, i) => a?.[i] || 0);
  const st = arr(bonus.stats, 39), ps = arr(bonus.pseudoStats, 40);
  for (const [k, v] of Object.entries(stats)) st[k] += v;
  for (const [k, v] of Object.entries(pseudo)) ps[k] += v;
  player.bonusStats = { stats: st, pseudoStats: ps };
  return r;
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

// Which screened candidates are worth a longer sim. results: [{slot, id, dps, err}] with err the sim's standard
// error of the gain, base: the current gear's DPS. A candidate is dropped when it can't be a gain (its best case is
// under minGain) or can't beat the best of its slot (its best case is under that one's worst case). The slot leaders
// come first, then the rest by gain, so the cut to maxKeep drops the long shots first. What is cut keeps its screened gain.
export function refineSet(results, base, { maxKeep = 8, minGain = 1, z = 2 } = {}) {
  const rows = results.map(r => ({ r, gain: r.dps - base, hi: r.dps - base + z * r.err, lo: r.dps - base - z * r.err }));
  const bestLo = new Map();
  for (const x of rows) bestLo.set(x.r.slot, Math.max(bestLo.get(x.r.slot) ?? -Infinity, x.lo));
  const live = rows.filter(x => x.hi >= minGain && x.hi >= bestLo.get(x.r.slot)).sort((a, b) => b.gain - a.gain);
  const seen = new Set();
  const leaders = live.filter(x => !seen.has(x.r.slot) && seen.add(x.r.slot));
  return [...leaders, ...live.filter(x => !leaders.includes(x))].slice(0, maxKeep).map(x => x.r);
}
