// Direct checks for the combat log parser. Usage: node tests/logparser_test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitTop, parseGroup, parseText, parseFile, LogParser, makePlayer, PULL_GAP_MS } from '../web/js/logparser.js';

// --- tokenising ---
assert.deepEqual(splitTop('a,"b,c",(1,2),[3,(4,5)],d'), ['a', '"b,c"', '(1,2)', '[3,(4,5)]', 'd']);
assert.deepEqual(splitTop(''), ['']);
assert.deepEqual(parseGroup('(1,"x y",(2,3),())'), [1, 'x y', [2, 3], []]);
assert.equal(parseGroup('"quoted"'), 'quoted');
assert.equal(parseGroup('nil'), 'nil');
assert.equal(parseGroup('0x511'), 0x511);

// --- the Parsed contract: a fresh parser already has every field the analysis reads ---
const fresh = new LogParser();
assert.ok(fresh.targetHp instanceof Map && fresh.debuffs.length === 0 && fresh.fightCache instanceof Map);
assert.deepEqual(Object.keys(fresh.player('g')).sort(), Object.keys(makePlayer('g')).sort());
assert.equal(makePlayer('g').isWarrior, false);
assert.equal(makePlayer('g', true).isWarrior, true);

// --- the shared fixture ---
const text = readFileSync(new URL('./fixture-WoWCombatLog.txt', import.meta.url), 'utf8');
const parser = parseText(text);
assert.equal(parser.header.BUILD_VERSION, '1.60.1');
assert.equal(parser.advanced, true);
const [war] = parser.warriors();
assert.equal(war.name, 'Shepwar-Forever');
assert.ok(war.hasGear);
const pl = parser.players.get(war.guid);
assert.deepEqual([pl.casts.length, pl.damage.length, pl.misses.length, pl.rage.length], [39, 129, 15, 115]);
assert.equal(war.damage, 132718);
const fights = parser.fights(war.guid);
assert.equal(fights.length, 1);
assert.deepEqual([fights[0].kind, fights[0].name, fights[0].success], ['boss', 'Ragnaros', true]);
// fights() returns copies: changing one must not change the cache.
fights[0].name = 'x';
assert.equal(parser.fights(war.guid)[0].name, 'Ragnaros');
// Gear and stats from COMBATANT_INFO.
const c = parser.combatants.get(war.guid);
assert.deepEqual(c.stats, { str: 420, agi: 250, sta: 280, int: 30, spi: 60 });
assert.equal(c.items.length, 19);
assert.deepEqual(c.items[4], { id: 11604, ilvl: 63, enchant: 1891, tempEnchant: 0 });
assert.deepEqual(c.items[15], { id: 12774, ilvl: 63, enchant: 1900, tempEnchant: 2506 });
assert.deepEqual(c.auras, [25661, 17538, 25898, 21564, 9885]);
// Target health is kept for the execute phase.
assert.ok(parser.targetHp.size >= 1);

// --- hand-written lines ---
const G = 'Player-1-AAAA', T = 'Creature-0-1-1-1-1-1';
const ts = s => `11/26 20:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.000-0  `;
const adv = `${G},0000000000000000,500,1000,0,0,0,0,1,50,100,0,0,0,1,0,60`;
const advT = `${T},0000000000000000,500,1000,0,0,0,0,0,0,0,0,0,0,1,0,60`;
const swing = (s, tail) => `${ts(s)}SWING_DAMAGE,${G},"W",0x511,0x0,${T},"Boss",0x10a48,0x0,${advT},${tail}`;
const mk = lines => parseText(lines.join('\n'));

// Crit flags: the last three flags are critical, glancing, crushing.
// (A swing with a trailing isOffHand flag is not covered: critIndex reads the last 3 flags first, see the review notes.)
const spell = (s, tail) => `${ts(s)}SPELL_DAMAGE,${G},"W",0x511,0x0,${T},"Boss",0x10a48,0x0,23894,"Bloodthirst",0x1,${advT},${tail}`;
let p = mk([
  `${ts(0)}COMBAT_LOG_VERSION,9,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,1.60.1`,
  spell(1, '100,100,-1,1,0,0,0,nil,nil,nil'),
  spell(2, '200,200,-1,1,0,0,0,1,nil,nil'),
  spell(3, '300,300,-1,1,0,0,0,nil,1,nil'),
]);
const [d1, d2, d3] = p.players.get(G).damage;
assert.deepEqual([d1.amount, d1.crit, d1.glancing], [100, false, false]);
assert.deepEqual([d2.amount, d2.crit, d2.glancing], [200, true, false]);
assert.deepEqual([d3.amount, d3.crit, d3.glancing], [300, false, true]);
assert.deepEqual([d1.name, d1.spellId, d1.dst], ['Bloodthirst', 23894, T]);
assert.equal(p.names.get(T), 'Boss');
assert.equal(p.players.get(G).targets.get(T), 600);
assert.equal(mk([swing(1, '100,0,0,0,0,0,0,nil,nil,nil')]).players.get(G).damage[0].name, 'Melee');

// Spell events: rage (tenths are scaled), casts, aura on self, debuff on a creature.
// Rage is only read for players already seen, so the first line creates the player.
p = mk([
  swing(0, '1,0,0,0,0,0,0,nil,nil,nil'),
  `${ts(1)}SPELL_CAST_SUCCESS,${G},"W",0x511,0x0,0000000000000000,nil,0x80000000,0x80000000,23894,"Bloodthirst",0x1,${G},0000000000000000,500,1000,0,0,0,0,1,500,1000,0,0,0,1,0,60`,
  `${ts(2)}SPELL_AURA_APPLIED,${G},"W",0x511,0x0,${G},"W",0x511,0x0,12328,"Death Wish",0x1,BUFF`,
  `${ts(3)}SPELL_AURA_APPLIED,${G},"W",0x511,0x0,${T},"Boss",0x10a48,0x0,11597,"Sunder Armor",0x1,DEBUFF`,
  `${ts(4)}UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,${G},"W",0x511,0x0`,
]);
const q = p.players.get(G);
assert.equal(q.isWarrior, true);
assert.deepEqual(q.rage[0].slice(1), [50]); // 500/1000 -> maxPower >= 1000 is divided by 10
assert.equal(q.casts[0].name, 'Bloodthirst');
assert.equal(q.auras[0].name, 'Death Wish');
assert.equal(q.auras[0].ev, 'APPLIED');
assert.equal(p.debuffs.length, 1);
assert.equal(p.debuffs[0].name, 'Sunder Armor');
assert.equal(q.deaths.length, 1);

// Non-player events between two creatures are dropped; garbage and bad timestamps are ignored.
p = mk(['', 'no double space here', 'bad time  SWING_DAMAGE,x', `${ts(1)}SPELL_HEAL,${T},"A",0x0,0x0,${T},"B",0x0,0x0,1,"x",0x1,5`]);
assert.equal(p.players.size, 0);
assert.equal(p.lines, 3);

// --- trash pulls: gap over PULL_GAP_MS splits; short pulls (<10 s) are dropped ---
const hit = s => swing(s, '100,0,0,0,0,0,0,nil,nil,nil');
const secs = [100, 105, 112, 112 + PULL_GAP_MS / 1000 + 5, 300, 302];
p = mk(secs.map(hit));
const trash = p.fights(G);
assert.equal(trash.length, 1 + 0 + 0, 'only the 12 s first pull survives'); // [100..112], [132..132] and [300..302] too short
assert.deepEqual([trash[0].kind, trash[0].name], ['trash', 'Boss']);
// Damage inside an encounter is not trash.
p = mk([`${ts(10)}ENCOUNTER_START,672,"Rag",9,40,409`, ...[11, 12, 40].map(hit), `${ts(50)}ENCOUNTER_END,672,"Rag",9,40,1`]);
const f = p.fights(G);
assert.deepEqual(f.map(x => x.kind), ['boss']);
assert.equal(f[0].success, true);
assert.deepEqual(p.fights('nobody'), []);

// --- parseFile: streaming, split across chunks, CRLF, and over-long lines are skipped ---
const lines = [`${ts(0)}COMBAT_LOG_VERSION,9,ADVANCED_LOG_ENABLED,1`, hit(1), hit(2)];
const body = lines.join('\r\n') + '\r\n' + 'x'.repeat(70 * 1024) + '\n' + hit(3);
const bytes = new TextEncoder().encode(body);
// Small chunks, as a real stream gives: the first one ends mid-line, and the long line spans many chunks.
const file = { size: body.length, stream: () => new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 4096) c.enqueue(bytes.slice(i, i + 4096)); c.enqueue(bytes.slice(0, 0)); c.close(); } }) };
const seen = [];
p = await parseFile(file, x => seen.push(x));
assert.equal(p.players.get(G).damage.length, 3);
assert.equal(p.lines, 4); // the 70 KB line is skipped, not fed
assert.equal(seen.at(-1), 1);
assert.ok(p instanceof LogParser);
console.log('logparser_test: ok');
