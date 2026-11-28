// Writes the made-up combat log behind "Try a sample report": one Fury warrior on one boss, in the advanced
// logging format. No real player is in it. The rotation has the usual habits the analyzer looks for (late
// Bloodthirsts, rage capping, Heroic Strike at low rage, Bloodthirst instead of Execute under 20%, a held Death
// Wish, an unused Recklessness), the boss's health is logged so the execute phase is known, and Flurry is on.
// Usage: node scripts/make-sample-log.mjs web/sample/sample-WoWCombatLog.txt
// After changing it, rebuild the precomputed page with scripts/make-sample.mjs.
import { writeFileSync } from 'node:fs';

let seed = 2026;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const P = 'Player-0000-00000001', B = 'Creature-0-0000-249-0-10184-0000000001';
const pName = '"Samplewar-Forever"', bName = '"Onyxia"';
const BUFFER = 'Player-0000-00000002', bufName = '"Samplepaladin-Forever"';
const DRUID = 'Player-0000-00000003', druName = '"Sampledruid-Forever"';
const SUNDER = 'Player-0000-00000004', sunName = '"Sampletank-Forever"';
const start = Date.UTC(2026, 10, 27, 20, 0, 0);
const lines = [];
const ts = t => { const d = new Date(start + t); const p = (n, w = 2) => String(n).padStart(w, '0'); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/2026 ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}-0`; };
const L = (t, s) => lines.push(`${ts(t)}  ${s}`);
const unit = (g, n, f = '0x511') => `${g},${n},${f},0x0`;
const base = () => `${unit(P, pName)},${unit(B, bName, '0x10a48')}`;
const self = () => `${unit(P, pName)},${unit(P, pName)}`;
const noTarget = () => `${unit(P, pName)},0000000000000000,nil,0x80000000,0x80000000`;

const FIGHT = 210000, T0 = 2000, BOSS_MAX = 1200000;
let rage = 0;
// The rest of the raid's damage is not logged; the boss's health falls with time, a little faster at the end.
const bossHp = t => Math.max(0, Math.round(BOSS_MAX * (1 - Math.pow(Math.min(1, (t - T0) / FIGHT), 1.15))));
const advP = cost => `${P},0000000000000000,7200,7200,1850,0,4100,0,1,${Math.round(rage) * 10},1000,${cost * 10},0,0,249,0.0,60`;
const advB = t => `${B},0000000000000000,${bossHp(t)},${BOSS_MAX},0,0,0,0,0,0,0,0,0,0,249,0.0,63`;
const flags = (crit, gl = false, oh = null) => `${crit ? 1 : 'nil'},${gl ? 1 : 'nil'},nil${oh === null ? '' : ',' + (oh ? 1 : 'nil')}`;
const aura = (t, ev, id, name, src = P, srcName = pName) => L(t, `SPELL_AURA_${ev},${unit(src, srcName)},${unit(P, pName)},${id},"${name}",0x1,BUFF`);
const cast = (t, id, name, cost, target = true) => L(t, `SPELL_CAST_SUCCESS,${target ? base() : noTarget()},${id},"${name}",0x1,${advP(cost)}`);
// Damage is scaled to pre-raid numbers against boss armor; rage still comes from the unscaled hit.
const DMG = 0.4;
const hit = (t, id, name, raw, crit) => { const amt = Math.round(raw * DMG); L(t, `SPELL_DAMAGE,${base()},${id},"${name}",0x1,${advB(t)},${amt},${amt},-1,1,0,0,0,${flags(crit)}`); };

L(0, 'COMBAT_LOG_VERSION,9,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,1.60.1,PROJECT_ID,2');
// Log slots 1..19: [item id, item level, permanent enchant]. Pre-raid gear from dungeons, crafting and quests,
// with no enchant on the boots, so the enchant check has something to say.
const GEAR = [
  [12640, 63, 1506], [15411, 61, 0], [12927, 62, 0], [0, 0, 0], [11726, 63, 1891], [13959, 61, 0], [14554, 62, 1885], [12555, 55, 0],
  [12936, 63, 1885], [15063, 63, 2564], [17713, 60, 0], [13098, 63, 0], [11815, 61, 0], [13965, 63, 0], [13340, 63, 849],
  [12940, 63, 1900], [12939, 63, 1900], [12651, 63, 0], [0, 0, 0],
];
// Temporary enchants (sharpening stones) on both weapons.
const items = GEAR.map(([id, il, en], i) => `(${id},${il},(${en},${i === 15 || i === 16 ? 2506 : 0},0),(),())`).join(',');
// Auras up at the pull: Elixir of the Mongoose (17538) and Battle Shout. No Juju Power, food or flask.
L(500, `COMBATANT_INFO,${P},0,420,250,280,30,60,5.0,5.0,0.0,22.5,15.0,1.0,0,0,0,0,0,0,0,0,0,0,4100,0,(30303213002,050530045122100231,),(0,0,0,0),[${items}],[${P},17538,${P},25289]`);
// Buffs from the group before the pull.
aura(600, 'APPLIED', 25291, 'Blessing of Might', BUFFER, bufName);
aura(700, 'APPLIED', 25898, 'Blessing of Kings', BUFFER, bufName);
aura(800, 'APPLIED', 21850, 'Gift of the Wild', DRUID, druName);
aura(900, 'APPLIED', 17538, 'Elixir of the Mongoose');
L(T0, `ENCOUNTER_START,1084,"Onyxia",9,40,249`);
L(T0 + 1500, `SPELL_AURA_APPLIED,${unit(SUNDER, sunName)},${unit(B, bName, '0x10a48')},11597,"Sunder Armor",0x1,DEBUFF`);

let t = T0, nextMH = t, nextOH = t + 400, btReady = t, wwReady = t, gcd = t, lastBS = t - 30000, hsQueued = false;
let brReady = t + 5000, dwAt = null, bfAt = null, potAt = null, flurry = 0;
const mhSpeed = 2700, ohSpeed = 2600;
const end = T0 + FIGHT;
const swing = (oh) => {
  const r = rnd(), base0 = oh ? 380 + rnd() * 120 : 720 + rnd() * 260;
  const mult = (dwAt !== null && t < dwAt + 30000 ? 1.2 : 1) * (bfAt !== null && t < bfAt + 15000 ? 1.08 : 1);
  if (r > (oh ? 0.8 : 0.95)) { L(t, `SWING_MISSED,${base()},MISS,${oh ? 1 : 'nil'}`); return; }
  const c = r < 0.31, g = !c && r > 0.6 && r < 0.72;
  const d = Math.round(base0 * mult * (c ? 2 : g ? 0.7 : 1)), shown = Math.round(d * DMG);
  L(t, `SWING_DAMAGE,${base()},${advP(0)},${shown},${shown},-1,1,0,0,0,${flags(c, g, oh)}`);
  rage = Math.min(100, rage + d / 230 * 7.5);
  // Flurry: three hasted swings after a crit.
  if (c) { if (!flurry) aura(t, 'APPLIED', 12970, 'Flurry'); else aura(t, 'REFRESH', 12970, 'Flurry'); flurry = 3; }
  else if (flurry && --flurry === 0) aura(t, 'REMOVED', 12970, 'Flurry');
};
const speed = s => (flurry ? s / 1.3 : s);
while (t < end) {
  const exec = bossHp(t) / BOSS_MAX < 0.2;
  if (t >= nextMH) {
    // Heroic Strike queued, sometimes at low rage (and in the execute phase, where it costs Executes).
    if (hsQueued && rage >= 15) {
      rage -= 15; hsQueued = false;
      const c = rnd() < 0.31, amt = Math.round((950 + rnd() * 300) * (c ? 2 : 1));
      hit(t, 25286, 'Heroic Strike', amt, c);
      if (c) { if (!flurry) aura(t, 'APPLIED', 12970, 'Flurry'); flurry = 3; }
    } else swing(false);
    nextMH = t + speed(mhSpeed);
  }
  if (t >= nextOH) { swing(true); nextOH = t + speed(ohSpeed); }
  if (t >= gcd) {
    const since = t - T0;
    if (t - lastBS > 120000 && rage >= 10) {
      rage -= 10; lastBS = t; cast(t, 25289, 'Battle Shout', 10, false); aura(t, 'APPLIED', 25289, 'Battle Shout'); gcd = t + 1500;
    } else if (dwAt === null && since > 45000 && rage >= 10) {
      // Death Wish held for 45 seconds, so only one use fits instead of two.
      rage -= 10; dwAt = t; cast(t, 12328, 'Death Wish', 10, false); aura(t, 'APPLIED', 12328, 'Death Wish'); aura(t + 30000, 'REMOVED', 12328, 'Death Wish'); gcd = t + 1500;
    } else if (bfAt === null && since > 8000) {
      bfAt = t; cast(t, 20572, 'Blood Fury', 0, false); aura(t, 'APPLIED', 20572, 'Blood Fury'); aura(t + 15000, 'REMOVED', 20572, 'Blood Fury');
    } else if (potAt === null && since > 50000) {
      potAt = t; rage = Math.min(100, rage + 45); cast(t, 17528, 'Mighty Rage', 0, false); aura(t, 'APPLIED', 17528, 'Mighty Rage'); aura(t + 20000, 'REMOVED', 17528, 'Mighty Rage');
    } else if (exec && rage >= 15 && rnd() < 0.3) {
      const amt = Math.round(1600 + (rage - 15) * 15); cast(t, 20662, 'Execute', 15); hit(t + 1, 20662, 'Execute', amt, rnd() < 0.3); rage = 0; gcd = t + 1500;
    } else if (t >= btReady + 2500 * rnd() && rage >= 30) {
      // Bloodthirst up to 2.5s late, and pressed over Execute under 20%.
      const c = rnd() < 0.35, amt = Math.round(1150 + rnd() * 300) * (c ? 2 : 1);
      rage -= 30; cast(t, 23894, 'Bloodthirst', 30); hit(t + 1, 23894, 'Bloodthirst', amt, c); btReady = t + 6000; gcd = t + 1500;
    } else if (t >= wwReady + 1500 && rage >= 25 && rnd() < 0.6) {
      const c = rnd() < 0.3, amt = Math.round(1050 + rnd() * 300) * (c ? 2 : 1);
      rage -= 25; cast(t, 1680, 'Whirlwind', 25); hit(t + 1, 1680, 'Whirlwind', amt, c); wwReady = t + 10000; gcd = t + 1500;
    }
  }
  if (t >= brReady && rnd() < 0.004) { rage = Math.min(100, rage + 10); brReady = t + 60000; cast(t, 2687, 'Bloodrage', 0, false); aura(t, 'APPLIED', 2687, 'Bloodrage'); }
  if (!hsQueued && ((rage > 80 && rnd() < 0.04) || (rage > 25 && rnd() < 0.004))) hsQueued = true;
  // Out of melee for 6 seconds at the deep breath phase.
  if (t > 95000 && t < 101000) { nextMH = Math.max(nextMH, 101000); nextOH = Math.max(nextOH, 101300); }
  t += 100;
}
if (flurry) aura(t, 'REMOVED', 12970, 'Flurry');
L(t, `UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,${B},${bName},0x10a48,0x0,0`);
L(t + 10, `ENCOUNTER_END,1084,"Onyxia",9,40,1,${t - T0}`);
writeFileSync(process.argv[2], lines.join('\r\n') + '\r\n');
console.log(`wrote ${lines.length} lines, fight ${(t - T0) / 1000}s`);
