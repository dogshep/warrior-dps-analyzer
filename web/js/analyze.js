// Turns one warrior's events in one fight into metrics, a wowsims request, and ranked suggestions.

// Log inventory slots 1..19 (0-based here) in the order wowsims' EquipmentSpec wants them.
const LOG_TO_SIM_SLOTS = [0, 1, 2, 14, 4, 8, 9, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17];
const SLOT_NAMES = ['Head', 'Neck', 'Shoulder', 'Back', 'Chest', 'Wrist', 'Hands', 'Waist', 'Legs', 'Feet', 'Ring 1', 'Ring 2', 'Trinket 1', 'Trinket 2', 'Main hand', 'Off hand', 'Ranged'];
// Slots a level 60 warrior normally enchants (sim slot indexes).
// Item type of each sim slot (1 head ... 13 weapon), for slot-specific enchant names.
const SLOT_ITEM_TYPE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11, 12, 12, 13, 13, 14];
// The DPS warrior enchants per sim slot, best first, from the wowsims Forever enchant list. Any enchant not
// listed, or no enchant, is flagged. Two-hand weapons also accept the +25 Agility and +25 Strength enchants.
const ARCANUMS = [[2543, 'Arcanum of Rapidity (+1% haste)'], [1506, 'Lesser Arcanum, +8 Strength'], [1508, 'Lesser Arcanum, +8 Agility']];
const WEAPON = [[1900, 'Crusader']];
export const BEST_ENCHANTS = {
  0: ARCANUMS,
  2: [[2717, 'Might of the Scourge'], [2606, 'Zandalar Signet of Might']],
  3: [[7667, 'Agility (+5)']],
  4: [[1891, 'Greater Stats (+4 all stats)']],
  5: [[7656, 'Superior Agility (+9)'], [1885, 'Superior Strength (+9)']],
  6: [[2564, 'Superior Agility (+15)'], [2563, 'Superior Strength (+15)']],
  8: ARCANUMS,
  9: [[1887, 'Greater Agility (+7)']],
  14: WEAPON,
  15: WEAPON,
};
const TWO_HAND_EXTRA = [[2646, 'Agility (+25)'], [8215, 'Strength (+25)']];
const SLOT_LABEL = { 0: 'Head', 2: 'Shoulder', 3: 'Back', 4: 'Chest', 5: 'Wrist', 6: 'Hands', 8: 'Legs', 9: 'Feet', 14: 'Main hand', 15: 'Off hand' };

// names.json tables are looked up by ids that come from the log. Without a prototype, an id like "constructor"
// finds nothing instead of a built-in function.
export function safeNames(names) {
  const out = Object.create(null);
  for (const [k, v] of Object.entries(names)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? Object.assign(Object.create(null), v) : v;
  return out;
}

export function enchantName(names, effectId, simSlot) {
  const byType = names.enchants[effectId];
  if (!byType) return effectId ? `#${effectId}` : '';
  if (typeof byType === 'string') return byType;
  return byType[SLOT_ITEM_TYPE[simSlot]] || Object.values(byType)[0];
}

// Enchants the wowsims data lists as available that WoW Forever does not have yet (Shep, 2026-11-28).
const NOT_IN_FOREVER = new Set([7645 /* Living Stats */, 7940 /* Grand Crusader */]);
// An enchant that can be had in Forever now: not on the list above, and not one wowsims marks Unknown (phase 2,
// such as the shoulder enchants from Zul'Gurub and Naxxramas). Older builds of names.json have no phases.
const inForever = (names, id) => !NOT_IN_FOREVER.has(id) && (names.enchantPhase?.[id] ?? 1) === 1;

// Per enchantable slot: {slot, label, have, haveName, ok, best: [names]}. Shields and off-hand non-weapons are
// skipped, and so is a slot with no enchant for it in Forever yet. An enchant that is not in Forever is never
// suggested, but one the player already has still counts as good.
export function auditEnchants(gear, names) {
  const out = [];
  for (const [slotStr, all] of Object.entries(BEST_ENCHANTS)) {
    const slot = Number(slotStr);
    const best = all.filter(([id]) => inForever(names, id));
    if (!best.length) continue;
    const it = gear[LOG_TO_SIM_SLOTS[slot]];
    if (!it || !it.id) continue;
    const info = names.items[it.id];
    if (slot === 15 && info && info[1] !== 13) continue;
    let list = best;
    if (slot === 14 && info && info[4] === 4) list = [...best, ...TWO_HAND_EXTRA.filter(([id]) => inForever(names, id))];
    const ok = list.some(([id]) => id === it.enchant) || all.some(([id]) => id === it.enchant);
    out.push({ slot, label: SLOT_LABEL[slot], have: it.enchant, haveName: it.enchant ? enchantName(names, it.enchant, slot).replace(/^Enchant [\w\s-]+? - /, '') : '', ok, best: list.map(([, n]) => n) });
  }
  return out;
}

export const DEFAULT_TALENTS = {
  fury: '30303213002-050530045122100231',
  fury_2h: '30303213032-050500350122110231',
  arms: '30303213132215201-55050000002-2',
};

export const DEFAULT_CONSUMES = {
  resourcePotId: 13442, foodId: 20452, explosiveId: 260814, mhImbueId: 12643, ohImbueId: 12404,
  elixirIds: [13452], extraIds: [10646, 12451, 12460, 5206, 8410],
};
const CONSUME_LABELS = { 13452: 'Elixir of the Mongoose', 12451: 'Juju Power', 12460: 'Juju Might', 20452: 'Smoked Desert Dumplings', 8410: 'R.O.I.D.S.', 13442: 'Mighty Rage Potion' };

export const DEFAULT_TARGET = { level: 63, stats: Array.from({ length: 39 }, (_, i) => (i === 14 ? 320 : i === 27 ? 3731 : 0)), minBaseDamage: 2601, damageSpread: 0.5, swingSpeed: 2, parryHaste: true, canCrush: true };

const BUFF_RULES = [
  [/Mark of the Wild|Gift of the Wild/, b => (b.raid.markOfTheWild = true)],
  [/Fortitude/, b => (b.raid.powerWordFortitude = true)],
  [/Strength of Earth/, b => (b.raid.strengthOfEarthTotem = 1)],
  [/Grace of Air/, b => (b.raid.graceOfAirTotem = 1)],
  [/Windfury Totem|Windfury Attack/, b => (b.raid.windfuryTotem = true)],
  [/Trueshot Aura/, b => (b.raid.trueshotAura = true)],
  [/Leader of the Pack/, b => (b.raid.leaderOfThePack = true)],
  [/Blessing of Kings/, b => (b.individual.greaterBlessingOfKings = true)],
  [/Blessing of Might/, b => (b.individual.greaterBlessingOfMight = 1)],
  [/Blessing of Salvation/, b => (b.individual.greaterBlessingOfSalvation = true)],
];
const DEBUFF_RULES = [
  [/Sunder Armor/, d => (d.sunderArmor = true)],
  [/Curse of Recklessness/, d => (d.curseOfRecklessness = true)],
  [/Faerie Fire/, d => (d.faerieFire = true)],
  [/Expose Armor/, d => (d.exposeArmor = true)],
  [/Hunter's Mark/, d => (d.huntersMark = true)],
  [/Judgement of the Crusader/, d => (d.judgementOfTheCrusader = 'TristateEffectRegular')],
  [/Gift of Arthas/, d => (d.giftOfArthas = true)],
  [/Thunderfury/, d => (d.thunderfury = true)],
  [/Annihilator|Armor Shatter/, d => (d.armorShatter = true)],
];

import { cooldownReport, cooldownTips } from './cooldowns.js';
import { rageReport, rageTips, executeReport, executeTips } from './rage.js';

const inFight = (f, t) => t >= f.start && t <= f.end;
const sum = a => a.reduce((s, x) => s + x, 0);
const fmt = n => Math.round(n).toLocaleString('en-US');

// Uptime (0..1) of an aura on a player over the fight, from applied/removed pairs.
function uptime(auras, re, f) {
  let on = null, total = 0;
  const ev = auras.filter(a => re.test(a.name)).sort((a, b) => a.t - b.t);
  // An aura first seen as REMOVED was up from the start.
  if (ev.length && ev[0].ev === 'REMOVED' && ev[0].t > f.start) on = f.start;
  for (const a of ev) {
    if (a.ev === 'APPLIED' || a.ev === 'REFRESH' || a.ev === 'APPLIED_DOSE') { if (on === null) on = Math.max(a.t, f.start); }
    else if (a.ev === 'REMOVED' && on !== null) { total += Math.max(0, Math.min(a.t, f.end) - on); on = null; }
  }
  if (on !== null) total += Math.max(0, f.end - on);
  return total / (f.end - f.start);
}

// Forever logs a whole dungeon run as one encounter. A fight this long is split into pulls (no damage from the
// warrior for 15s ends a pull), and DPS, downtime and the sim all use the pulls instead of the walk between them.
const LONG_FIGHT_MS = 6 * 60 * 1000;
const PULL_GAP_MS = 15000;
const MAX_SIM_SECONDS = 300;

export function splitPulls(dmg, fight) {
  const pulls = [];
  let cur = null;
  for (const d of dmg) {
    if (!cur || d.t - cur.end > PULL_GAP_MS) { cur = { start: d.t, end: d.t, dmg: 0, targets: new Map() }; pulls.push(cur); }
    cur.end = d.t;
    cur.dmg += d.amount;
    cur.targets.set(d.dst, (cur.targets.get(d.dst) || 0) + d.amount);
  }
  // A pull lasts at least a couple of swings, so a lone hit does not count as 0 seconds of combat.
  for (const pl of pulls) pl.end = Math.min(fight.end, Math.max(pl.end + 1500, pl.start + 3000));
  return pulls;
}

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export function analyzeFight(parser, guid, fight, names) {
  const p = parser.players.get(guid);
  const casts = p.casts.filter(c => inFight(fight, c.t));
  const dmg = p.damage.filter(d => inFight(fight, d.t)).sort((a, b) => a.t - b.t);
  const isRun = fight.end - fight.start > LONG_FIGHT_MS;
  const pulls = isRun ? splitPulls(dmg, fight) : null;
  const active = pulls ? sum(pulls.map(pl => pl.end - pl.start)) / 1000 : (fight.end - fight.start) / 1000;
  const dur = Math.max(1, active);
  const misses = p.misses.filter(m => inFight(fight, m.t));
  const auras = p.auras;
  const total = sum(dmg.map(d => d.amount));

  const byAbility = new Map();
  const ab = name => {
    let a = byAbility.get(name);
    if (!a) byAbility.set(name, (a = { name, casts: 0, hits: 0, damage: 0, crits: 0, misses: 0 }));
    return a;
  };
  for (const c of casts) { const x = ab(c.name); x.casts++; x.castEvents = true; }
  for (const d of dmg) { const a = ab(d.name); a.hits++; a.damage += d.amount; if (d.crit) a.crits++; }
  for (const m of misses) ab(m.name).misses++;
  // Heroic Strike, Cleave and melee have no cast event in some clients: count landed + missed instead.
  for (const a of byAbility.values()) if (!a.casts && a.name !== 'Melee') a.casts = a.hits + a.misses;

  // Main target = most damaged unit; count targets that took a real share of damage.
  const perTarget = new Map();
  for (const d of dmg) perTarget.set(d.dst, (perTarget.get(d.dst) || 0) + d.amount);
  const sortedTargets = [...perTarget.entries()].sort((a, b) => b[1] - a[1]);
  const mainTarget = sortedTargets[0]?.[0];
  const countTargets = (m, tot) => Math.max(1, Math.min(5, [...m.values()].filter(v => v > tot * 0.08).length));
  // For a run: the typical pull, by time spent, is what the sim fights.
  const targetCount = pulls ? Math.max(1, Math.min(5, Math.round(sum(pulls.map(pl => countTargets(pl.targets, pl.dmg) * (pl.end - pl.start))) / (dur * 1000))))
    : countTargets(perTarget, total);
  // The sim always fights one general fight of at most 5 minutes (a typical pull on a run), never the whole
  // log; its numbers are scaled to your time in combat. That keeps a run to seconds.
  const simDur = Math.min(MAX_SIM_SECONDS, pulls ? Math.max(20, median(pulls.map(pl => (pl.end - pl.start) / 1000))) : dur);

  // Execute phase start: first time the main target was under 20% health, else the last 20% of the fight.
  let executeStart = fight.start + (fight.end - fight.start) * 0.8, executeKnown = false;
  const hp = parser.targetHp?.get(mainTarget);
  if (hp) { const e = hp.find(([t, h]) => inFight(fight, t) && h <= 0.2); if (e) { executeStart = e[0]; executeKnown = true; } }

  // Rage samples during the fight.
  const rage = p.rage.filter(([t]) => inFight(fight, t));
  const capped = rage.length ? rage.filter(([, r]) => r >= 90).length / rage.length : null;

  // Downtime: gaps over 2.5s between any of the player's damage or casts, ignoring the time after death.
  const deathT = p.deaths.find(t => inFight(fight, t));
  const activity = [...dmg.map(d => d.t), ...casts.map(c => c.t)].sort((a, b) => a - b);
  let idle = 0;
  const windows = pulls || [{ start: fight.start, end: deathT ?? fight.end }];
  for (const w of windows) {
    let prev = w.start;
    for (const t of activity) { if (t < w.start || t > w.end) continue; if (t - prev > 2500) idle += t - prev - 2000; prev = t; }
    if (!pulls && w.end - prev > 2500) idle += w.end - prev - 2000;
  }

  const combatant = parser.combatants.get(guid);
  const spec = casts.some(c => c.name === 'Mortal Strike') ? 'arms' : 'fury';
  const mh = combatant?.items?.[15];
  const twoHand = mh && names.items[mh.id]?.[4] === 4;
  const preset = spec === 'arms' ? 'arms' : twoHand ? 'fury_2h' : 'fury';

  const pullSpans = pulls && pulls.map(pl => ({ start: pl.start, end: pl.end, targets: countTargets(pl.targets, pl.dmg) }));
  const cooldowns = cooldownReport(p, fight, { pulls: pullSpans, dps: total / dur, dur, executeStart, executeKnown, targetCount });

  const a = {
    names, guid, cooldowns, pullSpans, name: parser.names.get(guid), fight, dur, simDur, isRun, pulls: pulls ? pulls.length : null, pullStarts: pulls ? pulls.map(pl => pl.start) : null, total, dps: total / dur,
    abilities: [...byAbility.values()].sort((a, b) => b.damage - a.damage),
    casts, dmg, misses, targetCount, mainTarget, executeStart, executeKnown,
    rageCapped: capped, idleSec: idle / 1000, died: deathT !== undefined, deathAt: deathT ? (deathT - fight.start) / 1000 : null,
    combatant, spec, preset, twoHand,
    uptimes: {
      battleShout: uptime(auras, /^Battle Shout$/, fight),
      flurry: uptime(auras, /^Flurry$/, fight),
      enrage: uptime(auras, /^Enrage$/, fight),
      deathWish: uptime(auras, /^Death Wish$/, fight),
    },
    buffsSeen: [...new Set(auras.filter(a => a.t <= fight.end && a.t >= fight.start - 600000).map(a => a.name))],
  };
  a.rage = rageReport(a, p.rage);
  a.execute = executeReport(a, p.rage);
  return a;
}

// The gear, buffs and consumables the log shows, as a wowsims RaidSimRequest.
export function buildRequest(a, parser, names, apls, opts = {}) {
  const gear = a.combatant?.items || [];
  const items = LOG_TO_SIM_SLOTS.map(i => {
    const it = gear[i];
    if (!it || !it.id || !names.items[it.id]) return {};
    return it.enchant ? { id: it.id, enchant: it.enchant } : { id: it.id };
  });

  const b = { raid: {}, party: {}, individual: {} };
  const seen = new Set(a.buffsSeen);
  for (const id of a.combatant?.auras || []) if (names.spells[id]) seen.add(names.spells[id].replace(/ \(Rank \d+\)$/, ''));
  for (const name of seen) for (const [re, fn] of BUFF_RULES) if (re.test(name)) fn(b);

  const debuffs = {};
  for (const d of parser.debuffs || []) if (d.dst === a.mainTarget && inFight(a.fight, d.t)) for (const [re, fn] of DEBUFF_RULES) if (re.test(d.name)) fn(debuffs);

  const consumes = detectConsumes(a, parser, names);
  const useConsumes = opts.consumes === 'ideal' ? DEFAULT_CONSUMES : consumes.spec;

  const duration = Math.max(20, Math.round(a.simDur || a.dur));
  const player = {
    name: a.name || 'Warrior', race: opts.race || (a.combatant?.faction === 1 ? 'RaceHuman' : 'RaceOrc'), class: 'ClassWarrior',
    equipment: { items }, consumables: useConsumes, buffs: b.individual,
    talentsString: opts.talents || DEFAULT_TALENTS[a.preset],
    rotation: apls[a.preset],
    dpsWarrior: { options: { classOptions: { useBattleShout: true, defaultStance: 'WarriorStanceBerserker' } } },
  };
  return {
    raid: { parties: [{ players: [player], buffs: b.party }], buffs: b.raid, debuffs },
    encounter: { duration, executeProportion20: 0.2, executeProportion35: 0.35, targets: Array.from({ length: a.targetCount }, () => DEFAULT_TARGET) },
    simOptions: { iterations: opts.iterations || 300, randomSeed: String(opts.seed || 1337) },
  };
}

export function detectConsumes(a, parser, names) {
  const spec = { elixirIds: [], extraIds: [] };
  const found = [];
  const ids = new Set(a.combatant?.auras || []);
  for (const au of parser.players.get(a.guid).auras) if (au.t <= a.fight.end) ids.add(au.spellId);
  for (const c of a.casts) ids.add(c.spellId);
  for (const id of ids) {
    const c = names.consumes[id];
    if (!c) continue;
    const [itemId, type, name] = c;
    if (found.some(f => f.itemId === itemId)) continue;
    found.push({ itemId, name });
    if (type === 11) spec.elixirIds.push(itemId);
    else if (type === 3) spec.foodId = itemId;
    else if (type === 2) spec.flaskId = itemId;
    else if (type === 1) spec.resourcePotId = itemId;
    else if (type === 5) spec.explosiveId = itemId;
    else spec.extraIds.push(itemId);
  }
  const gear = a.combatant?.items || [];
  for (const [slot, key] of [[15, 'mhImbueId'], [16, 'ohImbueId']]) {
    const te = gear[slot]?.tempEnchant;
    const im = te && names.imbues[te];
    if (im) { spec[key] = im[0]; if (!found.some(f => f.itemId === im[0])) found.push({ itemId: im[0], name: im[2] }); }
  }
  return { spec, found };
}

// Compares your casts per minute to the sim's for each ability, and prices the gap with your own damage per cast.
// Action metrics are summed over all iterations, so `iterations` turns them into per-fight numbers.
export function compareToSim(simResult, names, iterations) {
  const p = simResult.raidMetrics.parties[0].players[0];
  const simCasts = new Map(), simDmg = new Map();
  for (const act of p.actions || []) {
    const id = act.id.spellId || act.id.itemId;
    const nm = act.id.spellId ? (names.spells[id] || String(id)).replace(/ \(Rank \d+\)$/, '') : act.id.otherId === 'OtherActionAttack' ? 'Melee' : act.id.itemId ? (names.items[id]?.[0] || String(id)) : act.id.otherId;
    const c = sum(act.targets.map(t => t.casts));
    const d = sum(act.targets.map(t => t.damage));
    simCasts.set(nm, (simCasts.get(nm) || 0) + c);
    simDmg.set(nm, (simDmg.get(nm) || 0) + d);
  }
  return { simDps: p.dps.avg, simStdev: p.dps.stdev, simCasts, simDmg, iterations };
}

// Names of the spells an APL can cast, so procs and dots (Deep Wound, Windfury) never read as missed casts.
export function aplSpellNames(apl, names) {
  const out = new Set();
  JSON.stringify(apl).replace(/"castSpell":\{"spellId":\{"spellId":(\d+)/g, (_, id) => { const n = names.spells[id]; if (n) out.add(n.replace(/ \(Rank \d+\)$/, '')); return ''; });
  return out;
}

const TIPS = {
  Execute: 'Once the boss is below 20%, Execute becomes your main button. Keep rage for it.',
  'Heroic Strike': 'Queue Heroic Strike whenever rage is above about 40 so rage never caps.',
  Overpower: 'When the target dodges, the sim swaps to Battle Stance for Overpower. Watch for the Overpower proc.',
  Rend: 'The sim weaves Rend in Battle Stance while rage is low. It is a small gain; skip it if it costs you Bloodthirst timing.',
  'Sunder Armor': 'Keep 5 stacks of Sunder Armor up when no other warrior is on it.',
};

// Abilities that are not part of a DPS priority, so "the sim never uses it" is no advice.
const UTILITY = new Set(['Melee', 'Sunder Armor', 'Battle Shout', 'Hamstring', 'Pummel', 'Shield Bash', 'Charge', 'Intercept', 'Victory Rush', 'Taunt', 'Mocking Blow', 'Demoralizing Shout', 'Intimidating Shout', 'Piercing Howl', 'Berserker Rage', 'Bloodrage', 'Thunder Clap']);

export function suggestions(a, sim, ideal, castable) {
  const out = [];
  const iters = sim?.iterations || 1;
  // Sim numbers are per simmed fight; a dungeon run sims one typical pull, so scale to the run's combat time.
  const scale = a.dur / (a.simDur || a.dur);
  const perFight = m => new Map([...m].map(([k, v]) => [k, (v / iters) * scale]));
  const simCasts = sim ? perFight(sim.simCasts) : null;
  const simDmg = sim ? perFight(sim.simDmg) : null;

  if (sim) {
    for (const [name, sc] of simCasts) {
      if (name === 'Melee' || sc < 2 || (castable && !castable.has(name))) continue;
      const mine = a.abilities.find(x => x.name === name);
      const myCasts = mine?.casts || 0;
      const missing = sc - myCasts;
      if (missing < Math.max(1.5, sc * 0.12)) continue;
      const perCast = mine && mine.hits ? mine.damage / mine.hits : (simDmg.get(name) || 0) / sc;
      const gain = (missing * perCast) / a.dur;
      if (gain < 1) continue;
      out.push({
        kind: 'rotation',
        title: `Cast ${name} more: ${myCasts} casts vs ${Math.round(sc)} in the sim`,
        detail: TIPS[name] ? TIPS[name]
          : name === 'Bloodthirst' || name === 'Mortal Strike' || name === 'Whirlwind' ? `Press ${name} the moment it comes off cooldown. It is top priority outside of execute.`
          : `The sim's priority list uses ${name} about ${Math.round((sc / a.dur) * 60 * 10) / 10} times a minute.`,
        gain,
      });
    }
    for (const mine of a.abilities) {
      const sc = simCasts.get(mine.name) ?? 0;
      if (UTILITY.has(mine.name) || mine.damage <= 0 || !mine.castEvents) continue;
      if (mine.casts - sc > Math.max(3, sc * 0.5) && sc < 1 && mine.casts > 3) {
        out.push({ kind: 'rotation', title: `The sim never uses ${mine.name} (you cast it ${mine.casts} times)`, detail: 'Those global cooldowns and rage are better spent on your main attacks.', gain: null });
      }
    }
  }

  out.push(...cooldownTips(a.cooldowns || [], a.fight, a));

  if (a.uptimes.battleShout < 0.9) out.push({ kind: 'buff', title: `Keep Battle Shout up (only ${Math.round(a.uptimes.battleShout * 100)}% uptime)`, detail: 'Refresh it before it drops; it is a lot of attack power for one global cooldown.', gain: null });
  out.push(...rageTips(a.rage, a), ...executeTips(a.execute, a));
  if (a.idleSec > 4 && !a.died) out.push({ kind: 'uptime', title: `About ${Math.round(a.idleSec)}s with no attacks or casts`, detail: 'Stay in melee range and keep auto attack going between mechanics. Charge, Intercept and pre-positioning help.', gain: (a.idleSec / a.dur) * a.dps });
  if (a.died) out.push({ kind: 'survival', title: `You died at ${Math.round(a.deathAt)}s`, detail: 'A dead warrior does 0 DPS. Check what killed you and use a healthstone, potion or Shield Wall timing.', gain: null });

  const gear = a.combatant?.items || [];
  const audit = a.combatant ? auditEnchants(gear, a.names || {}) : [];
  const missing = audit.filter(e => !e.have), weak = audit.filter(e => e.have && !e.ok);
  if (!a.combatant) out.push({ kind: 'gear', title: 'No gear in this log', detail: 'Turn on Advanced Combat Logging (System > Network) so the log records your gear and the sim can use it.', gain: null });
  const noneAtAll = audit.length >= 6 && audit.every(e => !e.have);
  if (noneAtAll) out.push({ kind: 'gear', title: 'No enchants found on your gear', detail: 'If your gear is enchanted, this log did not record enchants. If not, enchants are cheap DPS: ' + audit.filter(e => [4, 5, 6, 14].includes(e.slot)).map(e => `${e.label}: ${e.best[0]}`).join('. ') + '.', gain: null });
  else if (missing.length) out.push({ kind: 'gear', title: `Missing enchants: ${missing.map(e => e.label).join(', ')}`, detail: missing.map(e => `${e.label}: ${e.best.slice(0, 2).join(' or ')}`).join('. ') + '.', gain: null });
  if (weak.length) out.push({ kind: 'gear', title: `Upgrade enchants: ${weak.map(e => e.label).join(', ')}`, detail: weak.map(e => `${e.label}: ${e.haveName} → ${e.best.slice(0, 2).join(' or ')}`).join('. ') + '.' + (weak.some(e => e.slot === 9 && /Speed/.test(e.haveName)) ? ' Run speed on boots is fine for leveling and farming, but costs DPS in raids.' : ''), gain: null });

  if (ideal && sim) {
    const diff = ideal.simDps - sim.simDps;
    const missing = (ideal.missing || []).join(', ');
    if (diff > 2) out.push({ kind: 'consumes', title: `Full consumables are worth about ${fmt(diff)} DPS`, detail: missing ? `Not seen in your log: ${missing}.` : 'Bring the usual warrior consumables.', gain: diff });
  }

  // Two groups. "Play" tips explain the gap between you and the sim on your own gear and consumables ("Room to
  // grow"); gear and consumable tips come on top of it. Play tips are estimated one at a time and overlap, so if
  // they add up to more than the gap they are scaled down to share it.
  for (const t of out) t.group = t.kind === 'gear' || t.kind === 'consumes' ? 'gear' : 'play';
  const gap = sim ? sim.simDps - a.dps : null;
  const playSum = sum(out.filter(t => t.group === 'play' && t.gain).map(t => t.gain));
  if (gap !== null && playSum > Math.max(0, gap)) {
    const f = Math.max(0, gap) / playSum;
    for (const t of out) if (t.group === 'play' && t.gain) t.gain *= f;
  }
  out.sort((x, y) => (y.gain ?? -1) - (x.gain ?? -1));
  return out;
}

export function missingConsumes(found) {
  const have = new Set(found.map(f => f.itemId));
  return [13452, 12451, 12460, 20452, 13442].filter(id => !have.has(id)).map(id => CONSUME_LABELS[id]);
}

export { SLOT_NAMES, SLOT_ITEM_TYPE, LOG_TO_SIM_SLOTS, fmt };
