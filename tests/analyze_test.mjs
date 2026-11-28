// Direct checks for analyze.js: fight metrics, pull splitting, uptimes, the sim request and consumables.
// Usage: node tests/analyze_test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseText } from '../web/js/logparser.js';
import { analyzeFight, buildRequest, detectConsumes, compareToSim, aplSpellNames, safeNames, enchantName, consumesFor, missingConsumes, suggestions, DEFAULT_TARGET } from '../web/js/analyze.js';
import { LOG_TO_SIM_SLOTS } from '../web/js/slots.js';

const text = readFileSync(new URL('./fixture-WoWCombatLog.txt', import.meta.url), 'utf8');
const parser = parseText(text);
const [war] = parser.warriors();
const fight = parser.fights(war.guid)[0];
const items = {};
for (const it of parser.combatants.get(war.guid).items) if (it.id) items[it.id] = ['Item ' + it.id, 5, 4, 60];
items[12774] = ['Sword', 13, 4, 60, 1, 2.6];
const names = { items, spells: { 25289: 'Battle Shout (Rank 7)', 20217: 'Blessing of Kings' }, enchants: {}, consumes: { 17538: [13452, 11, 'Elixir of the Mongoose'], 9999: [12451, 99, 'Juju Power'] }, imbues: { 2506: [12404, 0, 'Dense Sharpening Stone'] } };

// --- analyzeFight on the fixture ---
const a = analyzeFight(parser, war.guid, fight, names);
assert.equal(a.name, 'Shepwar-Forever');
assert.equal(a.isRun, false);
assert.equal(a.pulls, null);
assert.equal(a.dur, 150.01);
assert.equal(a.total, war.damage);
assert.ok(Math.abs(a.dps - war.damage / 150.01) < 1e-9);
assert.equal(a.spec, 'fury');
assert.equal(a.preset, 'fury');
assert.equal(a.targetCount, 1);
assert.equal(a.died, false);
assert.equal(a.abilities[0].damage >= a.abilities[1].damage, true);
assert.equal(a.abilities.find(x => x.name === 'Bloodthirst').casts > 0, true);
const melee = a.abilities.find(x => x.name === 'Melee');
assert.equal(melee.casts, 0, 'melee casts are never inferred');
for (const k of ['battleShout', 'flurry', 'enrage', 'deathWish']) assert.ok(a.uptimes[k] >= 0 && a.uptimes[k] <= 1, k);

// --- long fights are split into pulls ---
const G = 'Player-1-AAAA', T = 'Creature-0-1-1-1-1-1';
const ts = s => `11/26 ${String(20 + Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.000-0  `;
const hit = (s, dst = T) => `${ts(s)}SPELL_DAMAGE,${G},"W",0x511,0x0,${dst},"Mob",0x10a48,0x0,23894,"Bloodthirst",0x1,100,100,-1,1,0,0,0,nil,nil,nil`;
const aura = (s, ev) => `${ts(s)}SPELL_AURA_${ev},${G},"W",0x511,0x0,${G},"W",0x511,0x0,12328,"Death Wish",0x1,BUFF`;
const longLines = [`${ts(0)}ENCOUNTER_START,1,"Run",9,5,1`];
for (const base of [10, 100, 400]) for (let i = 0; i < 12; i++) longLines.push(hit(base + i * 2));
longLines.push(`${ts(7 * 60 + 1)}ENCOUNTER_END,1,"Run",9,5,1`);
const lp = parseText(longLines.join('\n'));
const lf = lp.fights(G).find(f => f.kind === 'boss');
const la = analyzeFight(lp, G, lf, { items: {}, spells: {}, enchants: {}, consumes: {}, imbues: {} });
assert.equal(la.isRun, true);
assert.equal(la.pulls, 3);
assert.equal(la.pullStarts.length, 3);
// Each pull: 22 s of swings + 1.5 s, so the active time is well under the 7 minute log time.
assert.ok(la.dur > 60 && la.dur < 90, `active seconds ${la.dur}`);
assert.ok(la.simDur >= 20 && la.simDur <= 300);

// --- uptimes: applied then removed, refresh, and an aura that is only seen ending ---
const upt = lines => {
  const pp = parseText([`${ts(0)}ENCOUNTER_START,1,"X",9,5,1`, hit(1), ...lines, `${ts(100)}ENCOUNTER_END,1,"X",9,5,1`].join('\n'));
  const f = pp.fights(G)[0];
  return analyzeFight(pp, G, f, { items: {}, spells: {}, enchants: {}, consumes: {}, imbues: {} }).uptimes;
};
// Death Wish isn't parsed as an uptime unless the name matches; it does. Fight is 0..100 s.
assert.equal(upt([aura(10, 'APPLIED'), aura(60, 'REMOVED')]).deathWish, 0.5);
assert.equal(upt([aura(50, 'REMOVED')]).deathWish, 0.5, 'first seen removed: it was up from the start');
assert.equal(upt([aura(50, 'APPLIED')]).deathWish, 0.5, 'still up at the end');
assert.equal(upt([aura(20, 'APPLIED'), aura(40, 'REFRESH'), aura(60, 'REMOVED')]).deathWish, 0.4);
assert.equal(upt([]).deathWish, 0);

// --- buildRequest ---
const req = buildRequest(a, parser, names, { fury: { rotation: 'apl' } });
const player = req.raid.parties[0].players[0];
assert.equal(player.equipment.items.length, LOG_TO_SIM_SLOTS.length);
// The chest (log slot index 4) is sim slot 4; the crusader weapon (log index 15) is sim slot 14.
assert.deepEqual(player.equipment.items[4], { id: 11604, enchant: 1891 });
assert.deepEqual(player.equipment.items[14], { id: 12774, enchant: 1900 });
assert.deepEqual(player.equipment.items[3], { id: 10148, enchant: 849 }, 'sim slot 3 (back) is log slot 14');
// An item the name data doesn't know is sent as an empty slot.
const unknown = buildRequest(a, parser, { ...names, items: { ...items, 10148: undefined } }, { fury: {} });
assert.deepEqual(unknown.raid.parties[0].players[0].equipment.items[3], {});
assert.equal(player.class, 'ClassWarrior');
assert.equal(player.race, 'RaceHuman'); // faction 1 in the fixture's COMBATANT_INFO
assert.equal(player.rotation.rotation, 'apl');
assert.equal(player.talentsString, '30303213002-050530045122100231');
assert.equal(req.encounter.targets.length, 1);
assert.equal(req.encounter.targets[0], DEFAULT_TARGET);
assert.equal(req.simOptions.randomSeed, '1337');
assert.equal(req.simOptions.iterations, 300);
const req2 = buildRequest(a, parser, names, { fury: {} }, { iterations: 50, seed: 7, race: 'RaceHuman', talents: 'T', consumes: 'ideal' });
assert.equal(req2.simOptions.iterations, 50);
assert.equal(req2.simOptions.randomSeed, '7');
assert.equal(req2.raid.parties[0].players[0].race, 'RaceHuman');
assert.equal(req2.raid.parties[0].players[0].talentsString, 'T');
assert.equal(req2.raid.parties[0].players[0].consumables, consumesFor('fury'));
assert.notEqual(consumesFor('arms'), consumesFor('fury'));
assert.equal(consumesFor('arms').ohImbueId, 0);

// --- consumes from the aura list and the temp enchant ---
const dc = detectConsumes(a, parser, names);
assert.deepEqual(dc.spec.elixirIds, [13452]);
assert.equal(dc.spec.mhImbueId, 12404);
assert.deepEqual(dc.found.map(f => f.itemId).sort(), [12404, 13452]);
assert.deepEqual(missingConsumes(dc.found), ['Juju Power', 'Juju Might', 'Smoked Desert Dumplings', 'Mighty Rage Potion']);

// --- buffs and debuffs are read from the log ---
const dp = parseText(text);
dp.debuffs = [{ t: fight.start + 5, ev: 'AURA_APPLIED', name: 'Sunder Armor', dst: a.mainTarget }, { t: fight.start + 5, name: 'Faerie Fire', dst: 'other' }];
const r3 = buildRequest(a, dp, names, {});
assert.equal(r3.raid.debuffs.sunderArmor, true);
assert.equal(r3.raid.debuffs.faerieFire, undefined);

// --- sim comparison helpers ---
const simResult = { raidMetrics: { parties: [{ players: [{ dps: { avg: 500, stdev: 5 }, actions: [
  { id: { spellId: 25289 }, targets: [{ casts: 10, damage: 0 }, { casts: 5, damage: 0 }] },
  { id: { otherId: 'OtherActionAttack' }, targets: [{ casts: 100, damage: 9000 }] },
  { id: { itemId: 12774 }, targets: [{ casts: 1, damage: 50 }] },
] }] }] } };
const cmp = compareToSim(simResult, names, 10);
assert.equal(cmp.simDps, 500);
assert.equal(cmp.simCasts.get('Battle Shout'), 15);
assert.equal(cmp.simCasts.get('Melee'), 100);
assert.equal(cmp.simDmg.get('Sword'), 50);
assert.equal(cmp.iterations, 10);
assert.deepEqual([...aplSpellNames({ a: '"castSpell":{"spellId":{"spellId":25289}}' }, names)], []);
assert.deepEqual([...aplSpellNames(JSON.parse('{"x":[{"castSpell":{"spellId":{"spellId":25289}}}]}'), names)], ['Battle Shout']);

// --- names and enchant text ---
assert.equal(enchantName({ enchants: {} }, 0, 0), '');
assert.equal(enchantName({ enchants: {} }, 123, 0), '#123');
assert.equal(enchantName({ enchants: { 5: 'Plain' } }, 5, 0), 'Plain');
assert.equal(enchantName({ enchants: { 5: { 1: 'Head one', 5: 'Chest one' } } }, 5, 4), 'Chest one');
assert.equal(typeof safeNames, 'function');

// --- suggestions: a sim that casts far more Bloodthirst than the log gives a rotation tip, sorted by gain ---
const bt = a.abilities.find(x => x.name === 'Bloodthirst');
const sim = { simDps: a.dps + 100, simCasts: new Map([['Bloodthirst', bt.casts * 3 * 10]]), simDmg: new Map([['Bloodthirst', bt.casts * 3 * 10 * 1000]]), iterations: 10 };
const tips = suggestions(a, sim, null, null);
const btTip = tips.find(t => t.ability === 'Bloodthirst');
assert.ok(btTip, 'rotation tip for missing Bloodthirst casts');
assert.equal(btTip.group, 'play');
assert.ok(btTip.links.length > 0);
assert.ok(btTip.gain > 0 && btTip.gain <= 100, 'play gains are scaled to fit inside the gap');
const gains = tips.filter(t => t.gain != null).map(t => t.gain);
assert.deepEqual(gains, [...gains].sort((x, y) => y - x));
// Without a sim there are no rotation tips.
assert.equal(suggestions(a, null, null, null).some(t => t.kind === 'rotation'), false);
console.log('analyze_test: ok');
