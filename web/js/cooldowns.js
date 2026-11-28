// Cooldown timing: when each cooldown was used, when it was ready but sat unused, and what that cost.
// Boss fights get a per-fight plan (missed uses, holding the last use for execute, stacking burst).
// Dungeon runs get a per-pull view, because how fast the group pulls decides whether a cooldown is back.

// cd and dur in seconds, as in wowsims/forever's spell data (Sweeping Strikes lasts 20s there, 5 charges). `value` is the rough share of your damage the cooldown adds while it is up.
// `always`: every warrior has it, so it counts even when never pressed. Others count only once seen in the log
// (talents, racials and potions the log cannot otherwise confirm).
export const COOLDOWNS = [
  { name: 'Death Wish', cd: 180, dur: 30, value: 0.2, burst: true },
  { name: 'Recklessness', cd: 1800, dur: 15, value: 0.4, burst: true, always: true },
  { name: 'Blood Fury', cd: 120, dur: 15, value: 0.08, burst: true },
  { name: 'Berserking', cd: 180, dur: 10, value: 0.12, burst: true },
  { name: 'Mighty Rage Potion', aura: 'Mighty Rage', cd: 120, dur: 20, value: 0.06, burst: true },
  { name: 'Sweeping Strikes', cd: 30, dur: 20, value: 0.15, minPull: 10, multi: true },
  { name: 'Bloodrage', cd: 60, dur: 10, value: 0.02, always: true, minPull: 0 },
];

const PREPULL_MS = 30000;   // a cooldown pressed up to 30s before the pull counts as used on the pull
const LATE_MS = 5000;       // a cooldown that comes back with under 5s left is not a missed use
const BIG_PULL_S = 20;      // on a run, pulls at least this long are worth a burst cooldown
const SMALL_PULL_S = 15;

const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// Every use of a cooldown in the loaded data, from cast events, else from the buff it puts on you.
function usesOf(p, cd) {
  let ts = cd.aura ? [] : p.casts.filter(c => c.name === cd.name).map(c => c.t);
  if (!ts.length) ts = p.auras.filter(x => x.name === (cd.aura || cd.name) && x.ev === 'APPLIED').map(x => x.t);
  ts.sort((a, b) => a - b);
  return ts.filter((t, i) => i === 0 || t - ts[i - 1] > 1500);
}

// pulls: [{start, end}] for a dungeon run, else null. dps: the player's DPS over active time.
export function cooldownReport(p, fight, { pulls, dps, dur, executeStart, executeKnown, targetCount }) {
  const rows = [];
  for (const cd of COOLDOWNS) {
    const all = usesOf(p, cd);
    if (!cd.always && !all.length) continue;
    if (cd.multi && !pulls && targetCount < 2) continue;
    const cdMs = cd.cd * 1000, durMs = cd.dur * 1000;
    // Used before this fight (on trash, or a previous pull): not ready again until it comes back.
    const prior = all.filter(t => t < fight.start - PREPULL_MS).pop();
    const avail = Math.max(fight.start, prior !== undefined ? prior + cdMs : -Infinity);
    const uses = all.filter(t => t >= fight.start - PREPULL_MS && t <= fight.end).map(t => Math.max(t, fight.start));
    const row = { name: cd.name, cd: cd.cd, dur: cd.dur, burst: !!cd.burst, uses, availableAt: avail, idle: [] };
    const valueOf = ms => (cd.value * dps * Math.min(durMs, ms)) / 1000 / dur;
    if (!pulls) {
      // Boss fight: how many uses fit if pressed on cooldown, and the ready-but-unused stretches.
      let possible = 0;
      for (let t = avail; t <= fight.end - LATE_MS; t += cdMs) possible++;
      let ready = avail;
      for (const u of uses) { if (u - ready > 2000) row.idle.push([ready, u]); ready = Math.max(ready, u) + cdMs; }
      if (ready <= fight.end - LATE_MS) row.idle.push([ready, fight.end]);
      row.possible = possible;
      row.lost = Math.max(0, possible - uses.length);
      row.gain = row.lost * valueOf(durMs);
      row.heldSec = row.idle.filter(([, b]) => b < fight.end).reduce((s, [a, b]) => s + (b - a), 0) / 1000;
      // Could the last use have gone into the execute phase without losing a use?
      if (executeKnown && cd.burst && possible > 0 && uses.length === possible) {
        const last = uses[uses.length - 1];
        const earliest = avail + (possible - 1) * cdMs;
        if (last + durMs < executeStart && executeStart >= earliest && executeStart <= fight.end - LATE_MS) row.holdForExecute = true;
      }
    } else {
      // Dungeon run: for each pull, was it ready, and was it used?
      const minPull = cd.minPull ?? BIG_PULL_S;
      row.pulls = pulls.map((pl, i) => {
        // A use in the 15s before a pull (after the last one ended) counts for that pull: Bloodrage on the way in.
        const from = Math.max(pl.start - 15000, i ? pulls[i - 1].end : -Infinity);
        const before = uses.filter(t => t < from).pop();
        const readyAt = Math.max(avail, before !== undefined ? before + cdMs : -Infinity);
        const used = uses.find(t => t >= from && t <= pl.end);
        const len = (pl.end - pl.start) / 1000;
        const left = pl.end - Math.max(readyAt, pl.start);
        return { i, start: pl.start, end: pl.end, len, readyAt, used, targets: pl.targets, missed: used === undefined && left > 8000 && len >= minPull && !(cd.multi && pl.targets < 2), left };
      });
      const missed = row.pulls.filter(x => x.missed);
      row.missed = missed.length;
      row.readyPulls = row.pulls.filter(x => x.used !== undefined || x.missed).length;
      row.usedPulls = row.pulls.filter(x => x.used !== undefined).length;
      // What pressing it at the start of every worthwhile pull it was back for would have given, against what you got.
      let ready = avail, got = 0, best = 0;
      row.possible = 0;
      for (const x of row.pulls) {
        if (x.len < minPull || (cd.multi && x.targets < 2) || ready > x.end - 8000) continue;
        row.possible++;
        best += valueOf(x.end - Math.max(ready, x.start));
        ready = Math.max(ready, x.start) + cdMs;
      }
      for (const x of row.pulls) if (x.used !== undefined) got += valueOf(x.end - Math.max(x.used, x.start));
      row.lost = Math.max(0, row.possible - row.usedPulls);
      row.gain = Math.max(0, best - got);
      for (const x of missed) row.idle.push([Math.max(x.readyAt, x.start), x.end]);
      // Spent on a small pull right before a much bigger one it was then not back for.
      row.spent = [];
      if (cd.burst) for (const x of row.pulls) {
        if (x.used === undefined || x.len >= SMALL_PULL_S) continue;
        const next = row.pulls.find(y => y.i > x.i && y.start < x.used + cdMs && y.len >= 30 && y.len >= 2 * x.len && y.used === undefined);
        if (next) row.spent.push({ at: x.used, len: x.len, next });
      }
    }
    rows.push(row);
  }

  // Burst stacking: which burst cooldowns were pressed while Death Wish was not up.
  const dw = rows.find(r => r.name === 'Death Wish');
  if (dw && dw.uses.length) for (const r of rows) {
    if (!r.burst || r === dw) continue;
    r.unstacked = r.uses.filter(u => !dw.uses.some(d => u >= d - 3000 && u <= d + dw.dur * 1000)).length;
  }
  return rows;
}

const list = xs => xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

// Suggestions from the report, in the same shape as the other tips.
export function cooldownTips(rows, fight, { isRun, executeStart }) {
  const out = [];
  const at = t => mmss(t - fight.start);
  for (const r of rows) {
    if (!isRun) {
      if (r.lost > 0) {
        const tail = r.uses.length ? r.idle.find(([, b]) => b === fight.end) : null;
        const detail = [
          r.uses.length ? `You used it at ${list(r.uses.map(at))}.` : 'You never used it this fight.',
          r.availableAt > fight.start ? `It was not ready until ${at(r.availableAt)} because you used it before the pull.` : '',
          r.heldSec > 10 ? `It sat ready for ${Math.round(r.heldSec)}s before you pressed it, which pushed every later use back.` : '',
          tail ? `It was ready again at ${at(tail[0])} and the fight ended at ${at(fight.end)}. Even a short window is worth pressing it.` : '',
          r.name === 'Recklessness' && r.availableAt > fight.start ? 'Save it for bosses, since it has a 30 minute cooldown.' : '',
        ].filter(Boolean).join(' ');
        out.push({ kind: 'cooldown', title: `${r.name}: ${r.uses.length} of ${r.possible} possible uses`, detail, gain: r.gain });
      } else if (r.holdForExecute) {
        out.push({ kind: 'cooldown', title: `Hold your last ${r.name} for execute`, detail: `Your last ${r.name} was at ${at(r.uses[r.uses.length - 1])}, and execute started at ${at(executeStart)}. Pressing it then would not have cost a use, and it hits harder with Execute.`, gain: null });
      }
    } else {
      if (r.lost > 0) {
        const big = r.pulls.filter(x => x.missed && x.len >= 30);
        out.push({
          kind: 'cooldown',
          title: `${r.name}: used on ${r.usedPulls} pull${r.usedPulls === 1 ? '' : 's'}, could have been ${r.possible}`,
          detail: (big.length ? `It was ready and unused on ${big.length} pull${big.length > 1 ? 's' : ''} of 30s or more, like the ${Math.round(big[0].len)}s pull at ${at(big[0].start)}. ` : '') +
            (r.name === 'Bloodrage' ? 'Bloodrage is free rage. Press it at the start of every pull.'
              : r.name === 'Sweeping Strikes' ? 'Only pulls with 2 or more targets count. Press it as the pack is grouped up, before Whirlwind or Cleave.'
              : `When the group moves fast it won't be back for every pack, so press it at the start of the first big pull after it comes back. That's how "could have been" is counted.`),
          gain: r.gain,
        });
      }
      if (r.spent?.length) {
        const s = r.spent[0];
        out.push({
          kind: 'cooldown',
          title: `Save ${r.name} for bigger pulls`,
          detail: `At ${at(s.at)} it went on ${/^(8|11|18)/.test(String(Math.round(s.len))) ? 'an' : 'a'} ${Math.round(s.len)}s pull, so it wasn't back for the ${Math.round(s.next.len)}s pull at ${at(s.next.start)}.${r.spent.length > 1 ? ` That happened ${r.spent.length} times.` : ''} If the next pack is bigger and coming soon, hold it.`,
          gain: null,
        });
      }
    }
    if (r.unstacked > 0 && r.uses.length) {
      out.push({ kind: 'cooldown', title: `Stack ${r.name} with Death Wish`, detail: `${r.unstacked} of your ${r.uses.length} ${r.name} use${r.uses.length > 1 ? 's were' : ' was'} outside Death Wish. Burst cooldowns multiply each other, so press them together.`, gain: null });
    }
  }
  return out;
}

export { mmss };
