// The "Gear upgrades" section: picks candidates, sims each one swapped into the player's gear and shows the table.
// app.js hands over the sim state through initUpgrades; the HTML itself is built in render.js.
import { $, esc } from './format.js';
import * as pool from './simpool.js';
import { pickCandidates, refineSet, budget, swapRequest, bestPerSlot, yellowMiss, breaksHitCap, setChange, withoutSetRequest } from './upgrades.js';
import { loadPrices, houseKey, age } from './prices.js';
import { upgradesHtml, underCapHtml } from './render.js';
import { buildRequest, SLOT_ITEM_TYPE } from './analyze.js';
import { CancelledError } from './errors.js';
import { ITEM, ITEM_TYPE_WEAPON } from './fields.js';

// Set by initUpgrades: the loaded names and rotations (a promise), the cancel function, and the last analysis
// ({a, parser, opts, msPerIter}) or null.
let ctx = null;
const getLast = () => ctx.getLast();

// Gear upgrades. Each candidate is one sim of the player's gear with one item swapped, compared with a sim of their
// current gear. Two sims of different gear drift apart in their random rolls, so the fight count sets how
// precise a gain is. It runs in two passes: every candidate gets a short screening sim, whose table is shown at
// once, then only the ones that could still be the best of their slot get a longer sim that replaces its numbers.
// Each pass picks its fight count so it takes about its target time, within these bounds.
const SCREEN = { min: 100, max: 300, targetMs: 10000 };
const REFINE = { min: 200, max: 1000, targetMs: 15000, keep: 8 };
// A hard stop: whatever is done by then is shown.
const UPGRADE_TIME_CAP_MS = 120000;
const UPGRADE_WORKERS = pool.THREADS;
let upgradeTable = null;

// The ticked source kinds, as the letters upgrades.json uses.
function upgradeKinds() { return [...document.querySelectorAll('.upgKind:checked')].map(el => el.value).join(''); }

// Fights per candidate for n candidates in a pass (the current gear is simmed at twice that), and the time it takes.
function upgradePlan(n, pass) {
  const units = n + 2, msPerIter = getLast().msPerIter;
  const fit = (pass.targetMs * UPGRADE_WORKERS) / (msPerIter * units);
  const iters = Math.max(pass.min, Math.min(pass.max, Math.floor(fit / 50) * 50));
  return { iters, ms: (units * iters * msPerIter) / UPGRADE_WORKERS };
}

export function resetUpgrades() {
  lastUpgrades = null;
  $('upgOut').innerHTML = '';
  $('upgNote').textContent = '';
  const last = getLast();
  $('upgGo').disabled = !last;
  if (!last) { $('upgEta').textContent = ''; return; }
  const n = Number($('upgMax').value), ms = upgradePlan(n, SCREEN).ms + upgradePlan(Math.min(n, REFINE.keep), REFINE).ms;
  $('upgEta').textContent = `Up to ${n} items: about ${Math.max(1, Math.round(Math.min(ms, UPGRADE_TIME_CAP_MS) / 1000))}s, with a first look sooner.`;
}

async function findUpgrades() {
  const last = getLast();
  if (!last) return;
  const { names, apls } = await ctx.data;
  const { a, opts } = last;
  $('upgGo').disabled = true;
  $('upgCancel').hidden = false;
  $('upgNote').textContent = '';
  const bar = (label, done) => ($('upgOut').innerHTML = `<p class="hint">${esc(label)}</p><div class="bar"><span style="width:${Math.round(done * 100)}%"></span></div>`);
  bar('Loading the upgrade list…', 0);
  let timer = null;
  try {
    upgradeTable ??= await fetch('sim/upgrades.json').then(r => { if (!r.ok) throw new Error('No upgrade list in this build of the page.'); return r.json(); });
    const probe = buildRequest(a, last.parser, names, apls, opts);
    const gear = probe.raid.parties[0].players[0].equipment.items;
    if (!gear.some(g => g.id)) throw new Error('No gear in this log, so there is nothing to compare against.');
    // Twice the usual picks per slot, so there are spares for the ones the hit cap check drops.
    const likely = pickCandidates(gear, upgradeTable, a.preset, a.combatant?.faction, { perSlot: 4, max: 200, kinds: upgradeKinds() });
    if (!likely.length) { $('upgOut').innerHTML = `<p>${upgradeKinds() ? 'Nothing in the upgrade list beats what you wear from these sources. Try ticking more of them.' : 'Tick at least one source.'}</p>`; return; }
    // The character sheet for the current gear and each swap (milliseconds each, no sim): hit and set bonuses.
    bar('Checking hit and set bonuses…', 0);
    const ohInfo = names.items[gear[15]?.id];
    const dualWield = !!ohInfo && ohInfo[ITEM.TYPE] === ITEM_TYPE_WEAPON;
    const sheetNow = await pool.stats(probe);
    const missNow = yellowMiss(sheetNow.remainingHit ?? 0, dualWield);
    const checked = [], underCap = [];
    for (const c of likely) {
      const sh = await pool.stats(swapRequest(probe, c.slot, c.id));
      const miss = yellowMiss(sh.remainingHit ?? 0, dualWield);
      const sets = setChange(sheetNow.sets, sh.sets);
      if (sheetNow.remainingHit != null && breaksHitCap(missNow, miss)) underCap.push({ ...c, miss });
      else checked.push({ ...c, sets });
    }
    const cands = budget(checked, Number($('upgMax').value), 2);
    // One sim per slot whose set bonus a candidate breaks: the gear without that item, its stats added back.
    const setJobs = [...new Set(cands.filter(c => c.sets.lost.length).map(c => c.slot))].flatMap(slot => {
      const it = gear[slot], si = names.setItems?.[it.id];
      if (!si) return [];
      const st = { ...si[0] };
      const ench = it.enchant && names.enchantStats?.[it.enchant];
      if (ench) for (const [k, v] of Object.entries(ench[SLOT_ITEM_TYPE[slot]] || Object.values(ench)[0])) st[k] = (st[k] || 0) + v;
      return [{ slot, stats: st, pseudo: si[1] }];
    });
    if (!cands.length) {
      $('upgOut').innerHTML = '<p>Every likely upgrade from these sources would put you under the hit cap.</p>' + underCapHtml(underCap, names);
      return;
    }
    const t0 = performance.now();
    let capped = false;
    timer = setTimeout(() => { capped = true; ctx.cancelSim(); }, UPGRADE_TIME_CAP_MS);
    const threads = `${UPGRADE_WORKERS} thread${UPGRADE_WORKERS > 1 ? 's' : ''}`;
    // One pass: sims the jobs [{k, req, w}] (w = weight in units of one candidate sim) across the workers and
    // returns Map k -> {avg, stdev, n}. show(elapsed, done 0..1) draws the progress.
    const runPass = async (jobs, show) => {
      const total = jobs.reduce((s, j) => s + j.w, 0), done = new Map(), queue = [...jobs], out = new Map();
      const draw = () => show(`${Math.round((performance.now() - t0) / 1000)}s`, [...done.values()].reduce((x, y) => x + y, 0) / total);
      draw();
      await Promise.all(Array.from({ length: UPGRADE_WORKERS }, async (_, w) => {
        for (let job; (job = queue.shift());) {
          try {
            const r = await pool.sim(job.req, ({ stage, done: f }) => { if (stage === 'sim') { done.set(job.k, f * job.w); draw(); } }, w);
            out.set(job.k, { ...r.raidMetrics.parties[0].players[0].dps, n: r.iterations });
          } catch (e) { if (!(e instanceof CancelledError)) throw e; return; }
        }
      }));
      return out;
    };
    // The jobs for a pass: the current gear (twice the fights), each candidate swapped in, and the set bonus sims.
    const jobsFor = (list, sets, iters) => {
      const base = buildRequest(a, last.parser, names, apls, { ...opts, iterations: iters });
      return [{ k: 'base', req: { ...base, simOptions: { ...base.simOptions, iterations: iters * 2 } }, w: 2 },
        ...list.map(c => ({ k: `${c.slot}:${c.id}`, c, req: swapRequest(base, c.slot, c.id), w: 1 })),
        ...sets.map(j => ({ k: `set${j.slot}`, req: withoutSetRequest(base, j.slot, j.stats, j.pseudo), w: 1 }))];
    };
    const resultsOf = (list, out, b) => list.flatMap(c => {
      const r = out.get(`${c.slot}:${c.id}`);
      return r ? [{ ...c, dps: r.avg, err: Math.sqrt((r.stdev ** 2) / r.n + (b.stdev ** 2) / b.n) }] : [];
    });
    const setCostOf = (out, b) => new Map(setJobs.filter(j => out.has(`set${j.slot}`)).map(j => {
      const r = out.get(`set${j.slot}`);
      return [j.slot, { dps: b.avg - r.avg, err: Math.sqrt((r.stdev ** 2) / r.n + (b.stdev ** 2) / b.n) }];
    }));
    const prices = await loadPrices();
    const show = (results, setCost, baseAvg) => {
      lastUpgrades = { rows: bestPerSlot(results, baseAvg), gear, names, cands: results, setCost, underCap, prices, faction: a.combatant?.faction };
      renderUpgrades(lastUpgrades);
      showPriceAge();
    };

    // Pass 1: every candidate, few fights each.
    const s1 = upgradePlan(cands.length + setJobs.length, SCREEN).iters;
    const out1 = await runPass(jobsFor(cands, setJobs, s1), (t, f) => bar(`Screening ${cands.length} possible upgrades, ${s1} fights each, on ${threads}… ${t}`, f));
    const b1 = out1.get('base');
    if (!b1) throw new CancelledError('cancelled', { capped });
    const res1 = resultsOf(cands, out1, b1), cost1 = setCostOf(out1, b1);
    show(res1, cost1, b1.avg);
    const keep = refineSet(res1, b1.avg, { maxKeep: REFINE.keep });
    const keepSets = setJobs.filter(j => keep.some(c => c.slot === j.slot));
    let finalN = s1, refined = 0;
    if (keep.length && !capped) {
      // Pass 2: the candidates that could still win their slot, more fights each. The first table stays up with a
      // progress strip above it, and is replaced when the longer sims finish.
      const s2 = upgradePlan(keep.length + keepSets.length, REFINE).iters;
      $('upgOut').insertAdjacentHTML('afterbegin', '<div id="upgRefine"><p class="hint"></p><div class="bar"><span></span></div></div>');
      const el = $('upgRefine');
      const out2 = await runPass(jobsFor(keep, keepSets, s2), (t, f) => {
        el.querySelector('p').textContent = `First look below. Re-simming the top ${keep.length} with ${s2} fights each… ${t}`;
        el.querySelector('span').style.width = `${Math.round(f * 100)}%`;
      });
      const b2 = out2.get('base');
      if (b2 && keep.every(c => out2.has(`${c.slot}:${c.id}`))) {
        finalN = s2; refined = keep.length;
        // Refined numbers for the top candidates; the others keep their screened gain, moved onto the new base.
        const rest = res1.filter(r => !keep.some(c => c.slot === r.slot && c.id === r.id)).map(r => ({ ...r, dps: r.dps - b1.avg + b2.avg }));
        show([...resultsOf(keep, out2, b2), ...rest], new Map([...cost1, ...setCostOf(out2, b2)]), b2.avg);
      } else el.remove(); // stopped early: the first look stays as the answer
    }
    clearTimeout(timer);
    const secs = (performance.now() - t0) / 1000;
    $('upgNote').textContent = `Screened ${res1.length} item${res1.length === 1 ? '' : 's'} (${s1} fights each)${refined ? ` and re-simmed the ${refined} that could win a slot (${finalN} fights each)` : ''}, against your current gear, in ${secs.toFixed(1)}s on ${threads}.` +
      (capped ? ` Stopped at the ${UPGRADE_TIME_CAP_MS / 1000}s limit.` : '') +
      ` ± is the sim's margin for each gain (95%). The candidates were picked from items ranked ahead of time in pre-raid gear.`;
  } catch (e) {
    $('upgOut').innerHTML = e instanceof CancelledError && e.capped ? `<p class="hint">The sim of your current gear did not finish within ${UPGRADE_TIME_CAP_MS / 1000}s. Try fewer items.</p>`
      : e instanceof CancelledError ? '<p class="hint">Cancelled.</p>' : `<p class="warn">${esc(e.message || e)}</p>`;
  } finally {
    clearTimeout(timer);
    $('upgGo').disabled = !getLast();
    $('upgCancel').hidden = true;
  }
}

// AH price choices (region and realm type), remembered in this browser.
const PRICE_PREFS = 'warriorAnalyzer.ahHouse';
function readPricePrefs() {
  try {
    const v = JSON.parse(localStorage.getItem(PRICE_PREFS) || '{}');
    if (['us', 'eu'].includes(v.region)) $('ahRegion').value = v.region;
    if (['normal', 'pvp', 'rp', 'rppvp'].includes(v.market)) $('ahMarket').value = v.market;
  } catch { /* storage blocked: keep the defaults */ }
}
function savePricePrefs() {
  try { localStorage.setItem(PRICE_PREFS, JSON.stringify({ region: $('ahRegion').value, market: $('ahMarket').value })); } catch { /* ignore */ }
  if (lastUpgrades) renderUpgrades(lastUpgrades);
  showPriceAge();
}
let lastUpgrades = null;

function renderUpgrades(m) {
  $('upgOut').innerHTML = upgradesHtml({ ...m, table: upgradeTable, region: $('ahRegion').value, market: $('ahMarket').value });
}

// When the chosen house's prices were last pulled from Blizzard, shown beside the AH choices.
async function showPriceAge(faction = lastUpgrades?.faction) {
  const prices = await loadPrices();
  const el = $('ahUpdated');
  if (!prices) { el.textContent = 'Prices unavailable right now.'; return; }
  const h = prices.houses?.[houseKey($('ahRegion').value, $('ahMarket').value, faction)] ||
    prices.houses?.[houseKey($('ahRegion').value, $('ahMarket').value, faction === 0 ? 1 : 0)];
  const ts = h?.updated || prices.updated;
  const when = new Date(ts);
  el.textContent = h ? `Blizzard AH data updated ${age(ts)} (${when.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}).` : 'No prices for this realm type yet.';
  el.title = `Last price pull: ${new Date(prices.updated).toLocaleString()}. Prices are refreshed about every 3 hours.`;
}

export function initUpgrades(c) {
  ctx = c;
  $('upgGo').onclick = findUpgrades;
  readPricePrefs();
  showPriceAge();
  $('ahRegion').onchange = savePricePrefs;
  $('ahMarket').onchange = savePricePrefs;
  $('upgCancel').onclick = ctx.cancelSim;
  $('upgMax').onchange = () => { if (getLast() && !$('upgOut').innerHTML) resetUpgrades(); };
  return { resetUpgrades };
}
