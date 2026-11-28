// Checks that tips carry guide links and that Overpower and Rend read as optional (web/js/analyze.js).
import assert from 'node:assert/strict';
import { suggestions, GUIDES } from '../web/js/analyze.js';

const a = {
  dur: 150, simDur: 150, dps: 300, fight: { start: 0, end: 150000 }, targetCount: 1, spec: 'fury', isRun: false,
  abilities: [{ name: 'Bloodthirst', casts: 10, hits: 10, damage: 15000 }, { name: 'Overpower', casts: 0, hits: 0, damage: 0 }],
  cooldowns: [], uptimes: { battleShout: 0.5 }, rageCapped: 0, idleSec: 10, died: false, combatant: { items: [] }, names: {},
  rage: { capped: 0.2, hs: 5, hsLow: 0, waits: [], starved: false, overcapped: true }, execute: null,
};
const sim = { iterations: 1, simDps: 400, simCasts: new Map([['Bloodthirst', 20], ['Overpower', 11], ['Rend', 6]]), simDmg: new Map([['Bloodthirst', 30000], ['Overpower', 5500], ['Rend', 1200]]) };
const tips = suggestions(a, sim, null, null);
const by = re => tips.find(t => re.test(t.title));

assert.deepEqual(by(/Bloodthirst more/).links, GUIDES.rotation);
const op = by(/Overpower more/);
assert.match(op.title, /^Optional: /);
assert.match(op.detail, /Tactical Mastery/);
assert.deepEqual(op.links, GUIDES.stance);
assert.match(by(/Rend more/).title, /^Optional: /);
assert.deepEqual(by(/90\+ rage/).links, GUIDES.rage);
assert.deepEqual(by(/no attacks or casts/).links, GUIDES.uptime);
assert.deepEqual(by(/Battle Shout/).links, GUIDES.buff);
// Every link is https and goes to one of the two guides.
for (const t of tips) for (const [, url] of t.links || []) assert.match(url, /^https:\/\/www\.(warcrafttavern\.com|icy-veins\.com)\//);
// Optional tips come after the core rotation tips that have a gain.
const order = tips.map(t => t.title);
assert.ok(order.findIndex(t => /Bloodthirst more/.test(t)) < order.findIndex(t => /Overpower more/.test(t)));
console.log('tips tests passed');
