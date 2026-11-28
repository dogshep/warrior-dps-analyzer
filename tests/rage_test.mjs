// Checks the rage and execute-phase reads (web/js/rage.js) on hand-made fights.
import assert from 'node:assert/strict';
import { rageBefore, rageReport, rageTips, executeReport, executeTips } from '../web/js/rage.js';

assert.equal(rageBefore([[1000, 20], [2000, 50]], 2000), 20);
assert.equal(rageBefore([[1000, 20], [2000, 50]], 2001), 50);
assert.equal(rageBefore([[1000, 20]], 9000), null); // too old
assert.equal(rageBefore([[1000, 20]], 500), null);

const fight = { start: 0, end: 120000 };
const base = { fight, isRun: false, pullSpans: null, executeKnown: false, executeStart: 96000, targetCount: 1, spec: 'fury', rageCapped: 0, died: false, deathAt: null, misses: [] };
const hs = t => ({ t, name: 'Heroic Strike', amount: 900 });
const cast = (name, t) => ({ name, t });

// Starving: Heroic Strike at ~20 rage, and Bloodthirst comes off cooldown with 10 rage and waits 2 s each time.
{
  const casts = [], dmg = [], rage = [];
  for (let i = 0; i < 12; i++) {
    const t = i * 8000; // ready at +6 s, pressed at +8 s
    casts.push(cast('Bloodthirst', t));
    rage.push([t + 5900, 10], [t + 7900, 35]);
    dmg.push(hs(t + 3000)); rage.push([t + 2900, 20]);
  }
  const a = { ...base, casts, dmg };
  const r = rageReport(a, rage);
  assert.equal(r.hs, 12);
  assert.equal(r.hsLow, 12);
  assert.equal(r.waits[0].name, 'Bloodthirst');
  assert.equal(r.waits[0].n, 11);
  assert.ok(Math.abs(r.waits[0].sec - 22) < 1e-9);
  assert.ok(r.starved && !r.overcapped);
  const tips = rageTips(r, a);
  assert.equal(tips.length, 1);
  assert.match(tips[0].title, /12 of 12 went out below 40 rage/);
  assert.equal(tips[0].gain, null);
}

// Healthy: Heroic Strike only at 60+ rage, Bloodthirst on cooldown. Capped 20% of the time.
{
  const casts = [], dmg = [], rage = [];
  for (let i = 0; i < 12; i++) { const t = i * 6000; casts.push(cast('Bloodthirst', t)); dmg.push(hs(t + 3000)); rage.push([t + 2900, 70], [t + 5900, 50]); }
  const a = { ...base, casts, dmg, rageCapped: 0.2 };
  const r = rageReport(a, rage);
  assert.equal(r.hsLow, 0);
  assert.equal(r.waits.length, 0);
  assert.ok(!r.starved && r.overcapped);
  assert.match(rageTips(r, a)[0].title, /90\+ rage 20%/);
}

// No rage data: no read.
assert.equal(rageReport({ ...base, casts: [], dmg: [] }, []), null);

// Execute phase from 96 s: Bloodthirst and Whirlwind pressed instead of Execute, Heroic Strike at low rage.
{
  const casts = [cast('Bloodthirst', 97000), cast('Bloodthirst', 103000), cast('Whirlwind', 99000), cast('Whirlwind', 109000), cast('Execute', 112000)];
  const dmg = [{ t: 10000, name: 'Melee', amount: 48000 }, { t: 100000, name: 'Melee', amount: 6000 }, hs(101000), hs(105000)];
  const rage = [[100900, 30], [104900, 45]];
  const a = { ...base, casts, dmg, executeKnown: true };
  const x = executeReport(a, rage);
  assert.equal(x.sec, 24);
  assert.equal(Math.round(x.dps[0]), 500);
  assert.equal(Math.round(x.dps[1]), 250 + 75); // 6000 + 1800 over 24 s
  assert.equal(x.executes, 1);
  assert.equal(x.others, 4);
  assert.equal(x.hsLowUnder, 2);
  const tips = executeTips(x, a);
  assert.equal(tips.length, 2);
  assert.match(tips[0].title, /Bloodthirst and Whirlwind 4 times and Execute 1/);
  // Not on dungeon runs, or when the boss's health isn't known.
  assert.equal(executeReport({ ...a, isRun: true }, rage), null);
  assert.equal(executeReport({ ...a, executeKnown: false }, rage), null);
}
console.log('rage tests passed');
