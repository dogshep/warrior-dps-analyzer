// Builds Warcraft Logs API responses from the sample log, so the link import can be tested offline.
// Usage: node tests/wcl_mock.mjs tests/fixture-WoWCombatLog.txt > out.json
import { readFileSync } from 'node:fs';
import { parseText } from '../web/js/logparser.js';

const parser = parseText(readFileSync(process.argv[2], 'utf8'));
const [w] = parser.warriors();
const p = parser.players.get(w.guid);
const f = parser.fights(w.guid)[0];
const ids = new Map([[w.guid, 7]]);
const id = g => { if (!ids.has(g)) ids.set(g, 100 + ids.size); return ids.get(g); };
const abilities = new Map([[1, 'Melee']]);
const ab = (sid, name) => { if (sid) abilities.set(sid, name); return sid || 1; };
const mine = [];
for (const c of p.casts) mine.push({ timestamp: c.t, type: 'cast', sourceID: 7, targetID: id(c.dst), abilityGameID: ab(c.spellId, c.name), resourceActor: 1, classResources: [{ amount: 500, max: 1000, type: 1 }] });
for (const d of p.damage) mine.push({ timestamp: d.t, type: 'damage', sourceID: 7, targetID: id(d.dst), abilityGameID: ab(d.spellId, d.name), amount: d.amount, hitType: d.crit ? 2 : d.glancing ? 6 : 1, resourceActor: 2, hitPoints: 50, maxHitPoints: 100 });
for (const m of p.misses) mine.push({ timestamp: m.t, type: 'damage', sourceID: 7, targetID: id(m.dst), abilityGameID: ab(m.spellId, m.name), amount: 0, hitType: 0 });
for (const a of p.auras) mine.push({ timestamp: a.t, type: a.ev === 'REMOVED' ? 'removebuff' : 'applybuff', sourceID: 7, targetID: 7, abilityGameID: ab(a.spellId, a.name) });
mine.sort((a, b) => a.timestamp - b.timestamp);
const c = parser.combatants.get(w.guid);
const info = [{ timestamp: f.start, type: 'combatantinfo', sourceID: 7, faction: 1, gear: c.items.map(i => ({ id: i.id, itemLevel: i.ilvl, permanentEnchant: i.enchant || undefined, temporaryEnchant: i.tempEnchant || undefined })), auras: c.auras.map(a => ({ source: 7, ability: a })) }];
console.log(JSON.stringify({
  report: { title: 'Molten Core test', startTime: 0, fights: [{ id: 1, encounterID: 672, name: 'Ragnaros', startTime: f.start, endTime: f.end, kill: true }],
    masterData: { actors: [{ id: 7, name: w.name, subType: 'Warrior', server: 'Test' }, { id: 8, name: 'Healbot', subType: 'Priest', server: 'Test' }], abilities: [...abilities].map(([gameID, name]) => ({ gameID, name })) } },
  events: { mine: { data: mine, nextPageTimestamp: null }, onMe: { data: [], nextPageTimestamp: null }, debuffs: { data: [], nextPageTimestamp: null }, deaths: { data: [], nextPageTimestamp: null }, info: { data: info } },
}));
