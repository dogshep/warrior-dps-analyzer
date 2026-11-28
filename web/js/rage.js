// Rage and execute-phase reads for one warrior's fight, checked against the wowsims rotation the sim uses:
// - Outside execute, the sim queues Heroic Strike on one target only at 40+ rage (Cleave on 2+ targets at 25+),
//   so Bloodthirst, Mortal Strike and Whirlwind always have rage when they come off cooldown.
// - Under 20% health, the sim presses Execute before Whirlwind and Bloodthirst, and queues Heroic Strike only
//   above 60 rage.
// Both reads explain *why* the sim comparison finds missing casts, so their tips carry no DPS number of their
// own (that would count the same loss twice).

import { joinList } from './format.js';

// Cooldown (ms) and rage cost of the main attacks, from the wowsims Forever spell data.
const MAIN_ATTACKS = {
  Bloodthirst: { cd: 6000, cost: 30 },
  'Mortal Strike': { cd: 6000, cost: 30 },
  Whirlwind: { cd: 10000, cost: 25 },
};
const HS_MIN_RAGE = 40;
export const HS_EXECUTE_RAGE = 60;
// A main attack pressed more than this after it was ready is treated as a pause (moving, a mechanic), not a wait for rage.
const MAX_WAIT_MS = 6000;
// Rage samples older than this say nothing about rage now.
const SAMPLE_MAX_AGE_MS = 3000;

// Rage just before time t (the last sample strictly earlier), or null when there is no recent sample.
export function rageBefore(samples, t) {
  let lo = 0, hi = samples.length - 1, at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid][0] < t) { at = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return at >= 0 && t - samples[at][0] <= SAMPLE_MAX_AGE_MS ? samples[at][1] : null;
}

const inSpan = (spans, t) => spans.some(s => t >= s.start && t <= s.end);

// Times the warrior swung Heroic Strike or Cleave (landed or missed: they have no cast event in some clients).
const swings = (a, name) => [...a.dmg.filter(d => d.name === name).map(d => d.t), ...a.misses.filter(m => m.name === name).map(m => m.t)].sort((x, y) => x - y);

// {capped, hs, hsLow, waits: [{name, n, sec}], starved, overcapped} or null without rage data.
export function rageReport(a, rageSamples) {
  const f = a.fight;
  const samples = rageSamples.filter(([t]) => t >= f.start && t <= f.end).sort((x, y) => x[0] - y[0]);
  if (samples.length < 10) return null;
  // Combat windows: each pull on a dungeon run, else the fight up to the execute phase (execute has its own read).
  const end = a.executeKnown && !a.isRun ? a.executeStart : f.end;
  const spans = a.pullSpans || [{ start: f.start, end }];

  const hsTimes = swings(a, 'Heroic Strike').filter(t => inSpan(spans, t));
  const hsLow = hsTimes.filter(t => { const r = rageBefore(samples, t); return r !== null && r < HS_MIN_RAGE; }).length;

  const waits = [];
  for (const [name, { cd, cost }] of Object.entries(MAIN_ATTACKS)) {
    const times = a.casts.filter(c => c.name === name).map(c => c.t).sort((x, y) => x - y);
    let n = 0, ms = 0;
    for (let i = 1; i < times.length; i++) {
      const ready = times[i - 1] + cd, late = times[i] - ready;
      if (late < 500 || late > MAX_WAIT_MS || !inSpan(spans, ready)) continue;
      const r = rageBefore(samples, ready);
      if (r !== null && r < cost) { n++; ms += late; }
    }
    if (n) waits.push({ name, n, sec: ms / 1000 });
  }
  const waitCount = waits.reduce((s, w) => s + w.n, 0);
  return {
    capped: a.rageCapped, hs: hsTimes.length, hsLow, waits,
    starved: hsLow >= 3 && hsLow >= hsTimes.length * 0.25 && waitCount >= 3,
    overcapped: a.rageCapped !== null && a.rageCapped > 0.08,
  };
}

export function rageTips(r, a) {
  if (!r) return [];
  const out = [];
  if (r.starved) {
    const w = r.waits.map(x => `${x.name} ${x.n} time${x.n === 1 ? '' : 's'}`);
    const sec = r.waits.reduce((s, x) => s + x.sec, 0);
    out.push({
      kind: 'rage', gain: null,
      title: `Heroic Strike is starving your main attacks (${r.hsLow} of ${r.hs} went out below ${HS_MIN_RAGE} rage)`,
      detail: `Your ${joinList(w)} came off cooldown without the rage to cast it, about ${Math.round(sec)}s of waiting in all. ` +
        `The sim queues Heroic Strike only at ${HS_MIN_RAGE}+ rage${a.targetCount > 1 ? ' (Cleave at 25+ on packs)' : ''}, so ${a.spec === 'arms' ? 'Mortal Strike' : 'Bloodthirst'} and Whirlwind always have rage. These waits are part of why the sim casts them more.`,
    });
  }
  if (r.overcapped) {
    out.push({
      kind: 'rage', gain: null,
      title: `You sat at 90+ rage ${Math.round(r.capped * 100)}% of the fight`,
      detail: `Capped rage is wasted. ${r.hs ? `You used Heroic Strike ${r.hs} times; queue it` : 'Queue Heroic Strike'} whenever you are above ${HS_MIN_RAGE} rage${a.targetCount > 1 ? ', or Cleave on packs' : ''}.`,
    });
  }
  return out;
}

// The execute phase on a single fight (not a dungeon run): DPS before and under 20%, and casts per minute of the
// main buttons in each. Null when the boss's health isn't known or the phase is too short to judge.
export function executeReport(a, rageSamples) {
  if (a.isRun || !a.executeKnown) return null;
  const f = a.fight;
  const start = a.executeStart, end = a.died ? Math.min(f.end, f.start + a.deathAt * 1000) : f.end;
  if (end - start < 5000 || start - f.start < 5000) return null;
  const phases = [{ from: f.start, to: start }, { from: start, to: end }];
  const dmgIn = (x, y) => a.dmg.filter(d => d.t >= x && d.t < y).reduce((s, d) => s + d.amount, 0);
  const dps = phases.map(({ from, to }) => dmgIn(from, to) / ((to - from) / 1000));
  const count = (name, x, y) => name === 'Heroic Strike' ? swings(a, name).filter(t => t >= x && t < y).length : a.casts.filter(c => c.name === name && c.t >= x && c.t < y).length;
  const names = ['Execute', a.spec === 'arms' ? 'Mortal Strike' : 'Bloodthirst', 'Whirlwind', 'Heroic Strike'];
  const rows = names.map(name => {
    const n = phases.map(({ from, to }) => count(name, from, to));
    return { name, before: n[0], under: n[1], perMin: phases.map(({ from, to }, i) => n[i] / ((to - from) / 60000)) };
  }).filter(r => r.before || r.under || r.name === 'Execute');

  const samples = rageSamples.filter(([t]) => t >= start && t <= end).sort((x, y) => x[0] - y[0]);
  const hsUnder = swings(a, 'Heroic Strike').filter(t => t >= start && t < end);
  const hsLowUnder = samples.length ? hsUnder.filter(t => { const r = rageBefore(samples, t); return r !== null && r <= HS_EXECUTE_RAGE; }).length : null;
  const ex = rows.find(r => r.name === 'Execute').under;
  const others = rows.filter(r => r.name !== 'Execute' && r.name !== 'Heroic Strike').reduce((s, r) => s + r.under, 0);
  return { start, end, sec: (end - start) / 1000, dps, rows, executes: ex, others, hsUnder: hsUnder.length, hsLowUnder };
}

export function executeTips(x, a) {
  if (!x) return [];
  const out = [];
  const main = a.spec === 'arms' ? 'Mortal Strike' : 'Bloodthirst';
  if (x.sec >= 8 && x.others > x.executes) {
    out.push({
      kind: 'execute', gain: null,
      title: `Under 20%, you pressed ${main} and Whirlwind ${x.others} times and Execute ${x.executes}`,
      detail: `In the execute phase the sim presses Execute before ${main} and Whirlwind, and spends its rage there. Your DPS went from ${Math.round(x.dps[0])} before 20% to ${Math.round(x.dps[1])} under it.`,
    });
  }
  if (x.hsLowUnder >= 2) {
    out.push({
      kind: 'execute', gain: null,
      title: `${x.hsLowUnder} Heroic Strike${x.hsLowUnder === 1 ? '' : 's'} in the execute phase at ${HS_EXECUTE_RAGE} rage or less`,
      detail: `Under 20%, rage is worth more as Execute. The sim queues Heroic Strike there only above ${HS_EXECUTE_RAGE} rage.`,
    });
  }
  return out;
}
