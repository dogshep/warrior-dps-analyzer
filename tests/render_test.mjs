// Checks the HTML builders in web/js/render.js (they take data and return strings, so no page is needed).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseText } from '../web/js/logparser.js';
import { analyzeFight, suggestions } from '../web/js/analyze.js';
import { cooldownsHtml, executeView, statsHtml, tipsHtml, tablesHtml, upgradesHtml, underCapHtml, priceLine, restLine } from '../web/js/render.js';

const parser = parseText(readFileSync(new URL('./fixture-WoWCombatLog.txt', import.meta.url), 'utf8'));
const [w] = parser.warriors();
const fight = parser.fights(w.guid)[0];
const items = {};
for (const it of parser.combatants.get(w.guid).items) if (it.id) items[it.id] = [`Item <${it.id}>`, 5, 4, 60];
const names = { items, spells: {}, enchants: { 1891: { 5: 'Enchant Chest - Greater Stats' } }, enchantPhase: {}, consumes: {}, imbues: {} };
const a = analyzeFight(parser, w.guid, fight, names);

// Stats: your DPS, and the sim cells only once there is a sim.
assert.match(statsHtml(a, null), /Your DPS/);
assert.match(statsHtml(a, null), /<b>…<\/b><span>Sim DPS, your gear/);
const sim = { simDps: a.dps + 50, simCasts: new Map([['Bloodthirst', 99]]), simDmg: new Map([['Bloodthirst', 99000]]), iterations: 1 };
assert.match(statsHtml(a, sim, { simDps: sim.simDps + 10 }), /More from full consumables/);

// Cooldowns: one track per cooldown, plus the axis and legend.
const cd = cooldownsHtml(a);
assert.equal((cd.tracks.match(/class="track"/g) || []).length, a.cooldowns.length);
assert.match(cd.tracks, /class="axis"/);
assert.match(cd.note, /legend/);
assert.equal(executeView(a) === null, !a.execute);

// Tips: gear tips come after a "Gear and consumables" heading, the play list is capped at 8, and text is escaped.
const tips = [{ title: '<b>x</b>', detail: 'd', gain: 10, group: 'play', links: [['G', 'https://example.com/?a=1&b=2']] }, { title: 'Gear tip', detail: 'd', gain: null, group: 'gear' }];
const html = tipsHtml(tips, 30);
assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;') && !html.includes('<b>x</b>'));
assert.ok(html.indexOf('Gear and consumables') > html.indexOf('Play'));
assert.match(html, /Everything else.*\+20 DPS/, 'the rest of the gap, 30 - 10');
assert.match(html, /a=1&amp;b=2/);
assert.equal(restLine([{ gain: 10 }], 10), '');
assert.equal(restLine([], 0), '');
assert.match(tipsHtml([], 0), /Nothing big stands out/);
assert.equal((tipsHtml(Array.from({ length: 12 }, (_, i) => ({ title: `T${i}`, detail: '', gain: 1, group: 'play' })), 0).match(/class="t"/g) || []).length, 8);

// Tables: abilities and gear (names escaped, unknown items flagged).
const t = tablesHtml(a, names);
assert.match(t.abil, /Bloodthirst/);
assert.match(t.gear, /Item &lt;12620&gt;/);
assert.match(tablesHtml(a, { ...names, items: {} }).gear, /not in sim/);
assert.match(tablesHtml({ ...a, combatant: null }, names).gear, /No gear in this log/);

// Upgrades.
const table = { items: { 100: ['Dungeon X: Boss', 0, 1, 'dc'], 101: ['Raid', 1, 1, 'r'] } };
const rows = [{ slot: 4, id: 100, gain: 12.3, err: 2, sets: { lost: ['Set A'], gained: ['Set B'] } }, { slot: 5, id: 101, gain: 1, err: 3 }];
const now = new Date().toISOString();
const prices = { updated: now, houses: { 'us-normal-alliance': { updated: now, items: { 100: [5000, 6000, 3, 9000, 1] } } }, recipes: { 100: [[7, 2]] }, reagents: { 7: 'Bar' } };
const base = { rows, gear: [], names, cands: rows, setCost: new Map([[4, { dps: 5, err: 1 }]]), underCap: [{ slot: 6, id: 12620, miss: 2.2, est: 3 }], prices, faction: 1, table, region: 'us', market: 'normal' };
const up = upgradesHtml(base);
assert.match(up, /\+12\.3|\+12/);
assert.match(up, /Breaks Set A, worth about 5 DPS/);
assert.match(up, /Completes Set B/);
assert.match(up, /within sim noise/, 'gain 1 < 1.96 * 3');
assert.match(up, /<span class="tag">Dungeon<\/span><span class="tag">Crafted<\/span>/);
assert.match(up, /AH from 50s.*\(3 listed, median 60s\)/);
assert.match(up, /Materials at least 90s/);
assert.match(up, /hit cap for special attacks/);
assert.match(up, /US Normal Alliance auction house/);
assert.match(upgradesHtml({ ...base, prices: null }), /Auction house prices could not be loaded/);
assert.match(upgradesHtml({ ...base, prices: { houses: {}, updated: now } }), /No auction house prices for this realm type/);
assert.match(upgradesHtml({ ...base, rows: [] }), /None of the likely upgrades beat/);
assert.equal(priceLine(table, prices, 'us-normal-alliance', 101), '', 'only crafted items get a price');
assert.match(priceLine(table, prices, 'us-normal-horde', 100), /^$/, 'no data for that house');
assert.equal(underCapHtml([], names), '');
console.log('render_test: ok');
