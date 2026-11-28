// Checks the "Try a sample report" files: the made-up log still shows the features the sample is for, nobody real
// is in it, and the precomputed page has every part sample.js fills in.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseText } from '../web/js/logparser.js';
import { SAMPLE_PARTS } from '../web/js/sample.js';

const text = readFileSync(new URL('../web/sample/sample-WoWCombatLog.txt', import.meta.url), 'utf8');
// Only the made-up Sample* players and placeholder guids.
for (const m of text.matchAll(/Player-[\w-]+,"([^"]+)"/g)) assert.match(m[1], /^Sample\w+-Forever$/);
for (const m of text.matchAll(/Player-(\d+)-/g)) assert.equal(m[1], '0000');

const parser = parseText(text);
const [war] = parser.warriors();
assert.equal(war.name, 'Samplewar-Forever');
assert.ok(war.hasGear);
const fights = parser.fights(war.guid);
assert.equal(fights.length, 1);
assert.equal(fights[0].kind, 'boss');
// Boss health is logged (for the execute card) and Flurry is on the warrior.
const hp = parser.targetHp.get('Creature-0-0000-249-0-10184-0000000001');
assert.ok(hp && hp.some(([, h]) => h <= 0.2), 'boss health under 20% is in the log');
assert.ok(parser.players.get(war.guid).auras.some(a => a.name === 'Flurry'), 'Flurry is in the log');

const snap = JSON.parse(readFileSync(new URL('../web/sample/sample-report.json', import.meta.url), 'utf8'));
for (const id of SAMPLE_PARTS) assert.equal(typeof snap.html[id], 'string', `${id} is in the snapshot`);
for (const id of ['stats', 'tips', 'cds', 'execSum', 'execTable', 'upgOut', 'abil', 'gear']) assert.ok(snap.html[id].length > 20, `${id} has content`);
assert.match(snap.html.stats, /Flurry uptime/);
assert.match(snap.html.upgOut, /<table>/);
// The snapshot is page HTML from our own render code: no scripts or inline handlers.
assert.doesNotMatch(JSON.stringify(snap.html), /<script|\son\w+=/i);
console.log('sample ok');
