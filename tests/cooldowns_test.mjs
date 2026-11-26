// Unit checks for cooldown timing. Usage: node tests/cooldowns_test.mjs
import assert from 'node:assert/strict';
import { cooldownReport, cooldownTips } from '../web/js/cooldowns.js';

const s = x => x * 1000;
const player = (casts) => ({ casts: casts.map(([name, t]) => ({ name, t: s(t) })), auras: [] });
const boss = { start: 0, end: s(270) };
const opts = { pulls: null, dps: 500, dur: 270, executeStart: s(220), executeKnown: true, targetCount: 1 };
const tips = (p, f, o) => cooldownTips(cooldownReport(p, f, o), f, { isRun: !!o.pulls, executeStart: o.executeStart });

// On cooldown, but the last Death Wish could have waited for execute.
let t = tips(player([['Death Wish', 0], ['Death Wish', 180], ['Recklessness', 230], ['Bloodrage', 0], ['Bloodrage', 60], ['Bloodrage', 120], ['Bloodrage', 180], ['Bloodrage', 240]]), boss, opts);
assert.deepEqual(t.map(x => x.title), ['Hold your last Death Wish for execute', 'Stack Recklessness with Death Wish']);

// A late first Death Wish costs the second use.
t = tips(player([['Death Wish', 40], ['Recklessness', 225]]), { start: 0, end: s(240) }, { ...opts, dur: 240 });
const dw = t.find(x => x.title.startsWith('Death Wish'));
assert.equal(dw.title, 'Death Wish: 1 of 2 possible uses');
assert.match(dw.detail, /sat ready for 40s/);
assert.match(dw.detail, /ready again at 3:40/);
assert.ok(dw.gain > 10);

// Recklessness used on trash 10 minutes earlier is not counted as missed on the boss.
t = tips(player([['Recklessness', -600], ['Death Wish', 0], ['Death Wish', 200]]), boss, opts);
assert.ok(!t.some(x => x.title.startsWith('Recklessness')));

// Dungeon run: a Death Wish on a tiny pull right before a big one.
const pulls = [[0, 40], [60, 68], [80, 160], [400, 460]].map(([a, b]) => ({ start: s(a), end: s(b), targets: 3 }));
const run = { start: 0, end: s(500) };
const ro = { ...opts, pulls, dur: 196, executeKnown: false };
t = tips(player([['Death Wish', 61], ['Death Wish', 401]]), run, ro);
assert.deepEqual(t.map(x => x.title), ['Save Death Wish for bigger pulls', 'Recklessness: used on 0 pulls, could have been 1', 'Bloodrage: used on 0 pulls, could have been 4']);
assert.match(t[0].detail, /At 1:01 it went on an 8s pull, so it wasn't back for the 80s pull at 1:20/);

// Group pace: Death Wish skipped on a big pull it was back for counts as a lost use.
t = tips(player([['Death Wish', 0], ['Bloodrage', 0], ['Bloodrage', 80], ['Bloodrage', 400]]), run, ro);
assert.equal(t[0].title, 'Death Wish: used on 1 pull, could have been 2');
assert.match(t[0].detail, /60s pull at 6:40/);
console.log('cooldown tests passed');
