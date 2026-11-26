// Writes a synthetic Classic-era combat log for a fury warrior on one boss, in the advanced logging format.
// It plays a deliberately sloppy rotation (late Bloodthirsts, few Executes, rage capping) so the analyzer has
// something to find. Real logs from the game are the real test; this keeps the pipeline honest offline.
import { writeFileSync } from 'node:fs';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const P = 'Player-4395-0A1B2C3D', B = 'Creature-0-5250-409-1-11502-00001';
const pName = '"Shepwar-Forever"', bName = '"Ragnaros"';
const start = Date.UTC(2026, 10, 26, 20, 0, 0);
const lines = [];
const ts = t => { const d = new Date(start + t); const p = (n, w = 2) => String(n).padStart(w, '0'); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/2026 ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}-0`; };
const L = (t, s) => lines.push(`${ts(t)}  ${s}`);
const base = (dst = B, dn = bName) => `${P},${pName},0x511,0x0,${dst},${dn},0x10a48,0x0`;
let rage = 0, bossHp = 170000;
const BOSS_MAX = 170000;
const advP = cost => `${P},0000000000000000,7000,7000,1800,0,4000,0,1,${Math.round(rage) * 10},1000,${cost * 10},0,0,409,0.0,60`;
const advB = () => `${B},0000000000000000,${bossHp},${BOSS_MAX},0,0,0,0,0,0,0,0,0,0,409,0.0,63`;
const flags = (crit, gl = false, oh = null) => `${crit ? 1 : 'nil'},${gl ? 1 : 'nil'},nil${oh === null ? '' : ',' + (oh ? 1 : 'nil')}`;

L(0, 'COMBAT_LOG_VERSION,9,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,1.60.1,PROJECT_ID,2');
const gear = [[12620, 62, 0], [18404, 74, 0], [12625, 62, 0], [0, 0, 0], [11604, 63, 1891], [13077, 63, 0], [12619, 62, 0], [13070, 63, 911], [16735, 63, 1885], [13072, 63, 0],
  [18821, 71, 0], [15855, 60, 0], [10659, 63, 0], [10779, 63, 0], [10148, 63, 849], [12774, 63, 1900], [17016, 63, 1900], [16996, 63, 0], [0, 0, 0]];
const items = gear.map(([id, il, en], i) => `(${id},${il},(${en},${i === 15 ? 2506 : i === 16 ? 2506 : 0},0),(),())`).join(',');
L(500, `COMBATANT_INFO,${P},1,420,250,280,30,60,5.0,5.0,0.0,22.5,15.0,1.0,0,0,0,0,0,0,0,0,0,0,4100,0,(30303213002,050530045122100231,),(0,0,0,0),[${items}],[${P},25661,${P},17538,Player-4395-0000AAAA,25898,Player-4395-0000BBBB,21564,Player-4395-0000BBBB,9885]`);
L(1000, `ENCOUNTER_START,672,"Ragnaros",9,40,409`);

const FIGHT = 150000;
let t = 1000, nextMH = t, nextOH = t + 400, btReady = t, wwReady = t, gcd = t, dwUsed = false, brReady = t, lastBS = -999999, hsQueued = false;
const mhSpeed = 2600, ohSpeed = 2700;
while (t < 1000 + FIGHT && bossHp > 0) {
  const exec = bossHp / BOSS_MAX < 0.2;
  if (t >= nextMH) {
    if (hsQueued && rage >= 15) {
      rage -= 15; hsQueued = false;
      const amt = Math.round(900 + rnd() * 300), c = rnd() < 0.3;
      L(t, `SPELL_DAMAGE,${base()},25286,"Heroic Strike",0x1,${advB()},${c ? amt * 2 : amt},${amt},-1,1,0,0,0,${flags(c)}`);
      bossHp -= c ? amt * 2 : amt;
    } else {
      const r = rnd(), amt = Math.round(700 + rnd() * 250), c = r < 0.3, g = !c && r < 0.7 && r > 0.6;
      if (r > 0.95) L(t, `SWING_MISSED,${base()},MISS,nil`);
      else { const d = Math.round(c ? amt * 2 : g ? amt * 0.7 : amt); L(t, `SWING_DAMAGE,${base()},${advP(0)},${d},${d},-1,1,0,0,0,${flags(c, g, false)}`); bossHp -= d; rage = Math.min(100, rage + d / 230 * 7.5); }
    }
    nextMH = t + mhSpeed;
  }
  if (t >= nextOH) {
    const amt = Math.round(350 + rnd() * 120), c = rnd() < 0.3;
    if (rnd() > 0.25) { const d = c ? amt * 2 : amt; L(t, `SWING_DAMAGE,${base()},${advP(0)},${d},${d},-1,1,0,0,0,${flags(c, false, true)}`); bossHp -= d; rage = Math.min(100, rage + d / 230 * 7.5); }
    else L(t, `SWING_MISSED,${base()},MISS,1`);
    nextOH = t + ohSpeed;
  }
  if (t >= gcd) {
    if (t - lastBS > 120000 && rage >= 10) { rage -= 10; lastBS = t; L(t, `SPELL_CAST_SUCCESS,${P},${pName},0x511,0x0,0000000000000000,nil,0x80000000,0x80000000,25289,"Battle Shout",0x1,${advP(10)}`); L(t, `SPELL_AURA_APPLIED,${P},${pName},0x511,0x0,${P},${pName},0x511,0x0,25289,"Battle Shout",0x1,BUFF`); gcd = t + 1500; }
    else if (!dwUsed && t > 20000 && rage >= 10) { rage -= 10; dwUsed = true; L(t, `SPELL_CAST_SUCCESS,${P},${pName},0x511,0x0,0000000000000000,nil,0x80000000,0x80000000,12328,"Death Wish",0x1,${advP(10)}`); L(t, `SPELL_AURA_APPLIED,${P},${pName},0x511,0x0,${P},${pName},0x511,0x0,12328,"Death Wish",0x1,BUFF`); gcd = t + 1500; }
    else if (exec && rage >= 15 && rnd() < 0.5) { const amt = Math.round(1500 + rage * 15); L(t, `SPELL_CAST_SUCCESS,${base()},20662,"Execute",0x1,${advP(15)}`); L(t + 1, `SPELL_DAMAGE,${base()},20662,"Execute",0x1,${advB()},${amt},${amt},-1,1,0,0,0,${flags(false)}`); bossHp -= amt; rage = 0; gcd = t + 1500; }
    else if (t >= btReady + 1200 * rnd() * 3 && rage >= 30) { const c = rnd() < 0.35, amt = Math.round(1100 + rnd() * 300) * (c ? 2 : 1); rage -= 30; L(t, `SPELL_CAST_SUCCESS,${base()},23894,"Bloodthirst",0x1,${advP(30)}`); L(t + 1, `SPELL_DAMAGE,${base()},23894,"Bloodthirst",0x1,${advB()},${amt},${amt},-1,1,0,0,0,${flags(c)}`); bossHp -= amt; btReady = t + 6000; gcd = t + 1500; }
    else if (t >= wwReady + 2000 && rage >= 25 && rnd() < 0.5) { const amt = Math.round(1000 + rnd() * 300); rage -= 25; L(t, `SPELL_CAST_SUCCESS,${base()},1680,"Whirlwind",0x1,${advP(25)}`); L(t + 1, `SPELL_DAMAGE,${base()},1680,"Whirlwind",0x1,${advB()},${amt},${amt},-1,1,0,0,0,${flags(false)}`); bossHp -= amt; wwReady = t + 10000; gcd = t + 1500; }
  }
  if (t >= brReady && rnd() < 0.002) { rage = Math.min(100, rage + 10); brReady = t + 60000; L(t, `SPELL_CAST_SUCCESS,${P},${pName},0x511,0x0,0000000000000000,nil,0x80000000,0x80000000,2687,"Bloodrage",0x1,${advP(0)}`); }
  if (!hsQueued && rage > 85 && rnd() < 0.05) hsQueued = true;
  // An 8 second gap mid-fight, as if the player ran out for a mechanic.
  if (t > 70000 && t < 78000) { nextMH = nextOH = 78000; }
  t += 100;
}
L(t, `UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,${B},${bName},0x10a48,0x0,0`);
L(t + 10, `ENCOUNTER_END,672,"Ragnaros",9,40,1,${t - 1000}`);
writeFileSync(process.argv[2], lines.join('\r\n') + '\r\n');
console.log(`wrote ${lines.length} lines, fight ${(t - 1000) / 1000}s, boss hp left ${bossHp}`);
