import { parseFile } from './logparser.js';
import * as wcl from './wcl.js';
import { showSample, clearSample, sampleLog } from './sample.js';
import { $, esc } from './format.js';
import * as pool from './simpool.js';
import { HS_EXECUTE_RAGE } from './rage.js';
import { DEFAULT_ITERATIONS, MIN_ITERATIONS, MAX_ITERATIONS } from './sim-config.js';
import { pickCandidates, budget, swapRequest, bestPerSlot, yellowMiss, breaksHitCap, setChange, withoutSetRequest } from './upgrades.js';
import { loadPrices, houseKey, age } from './prices.js';
import { cooldownsHtml, executeView, statsHtml, tipsHtml, tablesHtml, upgradesHtml, underCapHtml } from './render.js';
import { safeNames, analyzeFight, buildRequest, compareToSim, suggestions, detectConsumes, missingConsumes, aplSpellNames, SLOT_ITEM_TYPE } from './analyze.js';
import { AuthRequiredError, CancelledError } from './errors.js';
import { ITEM, ITEM_TYPE_WEAPON } from './fields.js';

$('hsRage').textContent = HS_EXECUTE_RAGE;
const PRESETS = ['fury', 'fury_2h', 'arms'];

const data = (async () => {
  const [names, version, ...apls] = await Promise.all([
    fetch('sim/names.json').then(r => r.json()),
    fetch('sim/version.json').then(r => r.json()).catch(() => null),
    ...PRESETS.map(p => fetch(`sim/apls/${p}.apl.json`).then(r => r.json())),
  ]);
  if (version) $('simver').textContent = `@ ${version.commit.slice(0, 7)} (${version.commitDate.slice(0, 10)})`;
  return { names: safeNames(names), apls: Object.fromEntries(PRESETS.map((p, i) => [p, apls[i]])) };
})();

$('iters').value = DEFAULT_ITERATIONS;
$('iters').min = MIN_ITERATIONS;
$('iters').max = MAX_ITERATIONS;
// Stops running sims (Cancel buttons, a new file, the upgrade time cap).
const cancelSim = pool.cancel;
// Starts the sim workers in the background once there is something to analyze, so the engine is usually
// running by the time Analyze is pressed. A failure here shows up again, with its message, on Analyze.
const prewarm = () => pool.warm().catch(() => {});

// The progress bar under "Try this next run": label plus a 0..1 fill.
function showProgress(label, done) {
  $("tips").innerHTML = `<li class="d prog">${esc(label)}<div class="bar"><span style="width:${Math.round(done * 100)}%"></span></div></li>`;
}

// The loaded source: a parsed log file, or a Warcraft Logs report whose fights load on demand.
let parser = null, report = null;
// The last analyzed fight, for "Find upgrades": {a, parser, opts, msPerIter}.
let last = null;

// Shows a message in a status element: kind 'warn' (red) or 'hint' (plain). Used instead of alert().
function showStatus(el, msg, kind = 'warn') {
  el.innerHTML = `<span class="${kind}">${esc(msg)}</span>`;
}

async function load(file) {
  cancelSim();
  report = null;
  $('loadStatus').textContent = '';
  $('progress').hidden = false;
  const bar = $('progress').firstElementChild;
  try {
    parser = await parseFile(file, f => (bar.style.width = `${Math.round(f * 100)}%`));
  } catch (e) {
    $('progress').hidden = true;
    showStatus($('loadStatus'), `Could not read this file: ${e.message || e}`);
    return;
  }
  const war = parser.warriors();
  if (!war.length) { showStatus($('loadStatus'), 'No warriors found in this log.'); return; }
  $('who').innerHTML = war.map(w => `<option value="${esc(w.guid)}">${esc(w.name)}${w.hasGear ? '' : ' (no gear in log)'}</option>`).join('');
  fillFights();
  $('pickers').hidden = false;
  prewarm();
}

function fillFights() {
  // A Warcraft Logs report lists every fight; keep the ones the chosen warrior was in (when the report says).
  const fights = report ? report.fights.filter(f => !f.players || f.players.includes(Number($('who').value))) : parser.fights($('who').value);
  $('go').disabled = !fights.length;
  if (!fights.length) { $('fight').innerHTML = '<option>No fights with this warrior</option>'; $('fight')._fights = []; return; }
  $('fight').innerHTML = fights.map((f, i) => `<option value="${i}">${f.kind === 'boss' ? '⚔ ' : ''}${esc(f.name)} (${Math.round((f.end - f.start) / 1000)}s${f.kind === 'boss' && !f.success ? ', wipe' : ''})</option>`).join('');
  const boss = fights.findIndex(f => f.kind === 'boss');
  if (boss >= 0) $('fight').value = String(boss);
  $('fight')._fights = fights;
}

async function analyze() {
  const { names, apls } = await data;
  const guid = $('who').value;
  const fight = $('fight')._fights[Number($('fight').value)];
  if (report) {
    $('go').disabled = true;
    $('wclStatus').textContent = 'Loading the fight from Warcraft Logs…';
    try {
      parser = await wcl.loadFight(report, report.warriors.find(w => w.guid === guid), fight);
      const p = parser.players.get(guid);
      if (!p.casts.length && !p.damage.length) {
        $('go').disabled = false;
        $('wclStatus').innerHTML = `<span class="warn">${esc($('who').selectedOptions[0].textContent)} has no casts or damage in this fight. Pick another fight.</span>`;
        return;
      }
      $('wclStatus').textContent = '';
    } catch (e) {
      $('go').disabled = false;
      return wclError(e);
    }
  }
  const a = analyzeFight(parser, guid, fight, names);
  if ($('preset').value) a.preset = $('preset').value;
  const iterations = Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, Math.round(Number($('iters').value)) || DEFAULT_ITERATIONS));
  $('iters').value = String(iterations);
  const opts = { iterations, race: $('race').value || undefined, talents: $('talents').value.trim() || undefined };

  clearSample();
  $('out').hidden = false;
  last = null;
  resetUpgrades();
  renderStats(a, null);
  renderTables(a, names);
  renderCooldowns(a);
  renderExecute(a);
  showProgress('Starting the sim…', 0);
  $('go').disabled = true;
  $('cancel').hidden = false;
  try {
    const cons = detectConsumes(a, parser, names);
    // Starts the engine if it isn't running yet (usually it is, from when the log loaded).
    await pool.warm(pool.THREADS, done => showProgress(done >= 1 ? 'Starting the sim engine…' : `Downloading the sim (first run only)… ${Math.round(done * 100)}%`, done));
    // Two runs: your setup, and the same with full consumables. With 2+ workers they run side by side, each
    // split across half of them; with one they run one after the other. The bar covers both.
    const half = Math.max(1, Math.floor(pool.THREADS / 2));
    const side = pool.THREADS >= 2;
    const idxMine = Array.from({ length: half }, (_, i) => i), idxBest = side ? idxMine.map(i => i + half) : idxMine;
    const prog = [0, 0];
    const tick = run => done => { prog[run] = done; const f = (prog[0] + prog[1]) / 2; showProgress(`Simming your gear and with full consumables (${iterations} fights each)… ${Math.round(f * 100)}%`, f); };
    const reqMine = buildRequest(a, parser, names, apls, opts), reqBest = buildRequest(a, parser, names, apls, { ...opts, consumes: 'ideal' });
    const t1 = performance.now();
    const [mine, best] = side
      ? await Promise.all([pool.simSplit(reqMine, tick(0), idxMine), pool.simSplit(reqBest, tick(1), idxBest)])
      : [await pool.simSplit(reqMine, tick(0), idxMine), await pool.simSplit(reqBest, tick(1), idxBest)];
    // Time per fight on one worker, for the upgrades estimate. The engine was already running, so this is the sim alone.
    const perWorker = side ? Math.ceil(iterations / half) : 2 * iterations;
    last = { a, parser, opts, msPerIter: (performance.now() - t1) / perWorker };
    resetUpgrades();
    const s = compareToSim(mine, names, mine.iterations || iterations);
    const ideal = compareToSim(best, names, best.iterations || iterations);
    ideal.missing = missingConsumes(cons.found);
    renderStats(a, s, ideal);
    renderTips(suggestions(a, s, ideal, aplSpellNames(apls[a.preset], names)), s && s.simDps - a.dps);
    $('simnote').textContent = `${a.isRun ? `Dungeon run: your DPS counts only time in combat, and the sim fights a typical ${Math.round(a.simDur)}s pull, scaled to your ${a.pulls} pulls. ` : ''}Sim: ${a.preset.replace('_', ' ')} rotation, ${iterations} iterations of a ${Math.round(a.simDur || a.dur)}s fight against ${a.targetCount} target${a.targetCount > 1 ? 's' : ''}, with the buffs and consumables seen in your log. Consumables seen: ${cons.found.map(f => f.name).join(', ') || 'none'}.`;
  } catch (e) {
    renderTips(suggestions(a, null, null));
    $('simnote').innerHTML = e instanceof CancelledError
      ? 'Sim cancelled. These tips come from the log alone.'
      : `<span class="warn">The sim failed: ${esc(e.message)}</span>. These tips come from the log alone.`;
  } finally {
    $('go').disabled = false;
    $('cancel').hidden = true;
  }
}

function renderCooldowns(a) {
  const { tracks, note } = cooldownsHtml(a);
  $('cds').innerHTML = tracks;
  $('cdnote').innerHTML = note;
}

function renderExecute(a) {
  const x = executeView(a);
  $('exec').hidden = !x;
  if (!x) return;
  $('execSum').textContent = x.summary;
  $('execTable').innerHTML = x.table;
}

const renderStats = (a, s, ideal) => ($('stats').innerHTML = statsHtml(a, s, ideal));
const renderTips = (list, gap) => ($('tips').innerHTML = tipsHtml(list, gap));

function renderTables(a, names) {
  const t = tablesHtml(a, names);
  $('abil').innerHTML = t.abil;
  $('gear').innerHTML = t.gear;
}

const drop = $('drop');
$('pick').onclick = () => $('file').click();
$('file').onchange = e => e.target.files[0] && load(e.target.files[0]);
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && load(e.dataTransfer.files[0]); };
$('who').onchange = fillFights;

// Warcraft Logs links.
async function loadWcl(link) {
  const ref = wcl.parseReportUrl(link);
  if (!ref) { $('wclStatus').textContent = 'That does not look like a Warcraft Logs report link.'; return; }
  $('wclStatus').textContent = 'Loading the report…';
  try {
    report = await wcl.loadReport(ref.code);
  } catch (e) {
    return wclError(e, link);
  }
  parser = null;
  if (!report.warriors.length) { $('wclStatus').textContent = 'No warriors in this report.'; return; }
  $('wclStatus').textContent = `Loaded “${report.title}”.`;
  $('who').innerHTML = report.warriors.map(w => `<option value="${esc(w.guid)}">${esc(w.name)}</option>`).join('');
  if (ref.source && report.warriors.some(w => w.id === ref.source)) $('who').value = String(ref.source);
  fillFights();
  const fi = $('fight')._fights.findIndex(f => f.id === ref.fight);
  if (fi >= 0) $('fight').value = String(fi);
  $('pickers').hidden = false;
  prewarm();
}

// A private report (or one the site can't reach) asks before sending the viewer off to sign in.
function wclError(e, link) {
  $('wclStatus').innerHTML = `<span class="warn">${esc(e.message || e)}</span>`;
  if (e instanceof AuthRequiredError && link) {
    const b = document.createElement('button');
    b.className = 'link';
    b.textContent = 'Sign in to Warcraft Logs';
    b.onclick = () => wcl.signIn(link).catch(wclError);
    $('wclStatus').append(' ', b);
  }
}

$('wclGo').onclick = () => loadWcl($('wcl').value);
$('wcl').onkeydown = e => { if (e.key === 'Enter') loadWcl($('wcl').value); };
// The sample report: finished results for a made-up fight, shown without running the sim (see sample.js).
async function trySample() {
  if (!(await showSample())) showStatus($('loadStatus'), 'The sample report could not be loaded. Try again in a moment.');
}
$('sampleGo').onclick = trySample;
// The same log through the real analyzer: it loads like a dropped file, then Analyze runs the sim as usual.
$('sampleReal').onclick = () => sampleLog().then(load).then(() => $('pickers').scrollIntoView({ behavior: 'smooth' })).catch(e => showStatus($('loadStatus'), e.message));
// A link to the page with #sample opens the sample right away.
if (location.hash === '#sample') trySample();
wcl.finishSignIn().then(link => { if (link) { $('wcl').value = link; loadWcl(link); } }).catch(wclError);
// Gear upgrades. Each candidate is one sim of the player's gear with one item swapped, compared with a sim of their
// current gear. Two sims of different gear drift apart in their random rolls, so the fight count sets how
// precise a gain is: it is picked so the whole run takes about UPGRADE_TARGET_MS, within these bounds.
const UPGRADE_ITERS = { min: 200, max: 1000 };
const UPGRADE_TARGET_MS = 60000;
// A hard stop: whatever is done by then is shown.
const UPGRADE_TIME_CAP_MS = 120000;
const UPGRADE_WORKERS = pool.THREADS;
let upgradeTable = null;

// The ticked source kinds, as the letters upgrades.json uses.
function upgradeKinds() { return [...document.querySelectorAll('.upgKind:checked')].map(el => el.value).join(''); }

// Fights per candidate for n candidates (the current gear is simmed at twice that), and the time it should take.
function upgradePlan(n) {
  const units = n + 2;
  const fit = (UPGRADE_TARGET_MS * UPGRADE_WORKERS) / (last.msPerIter * units);
  const iters = Math.max(UPGRADE_ITERS.min, Math.min(UPGRADE_ITERS.max, Math.floor(fit / 100) * 100));
  return { iters, ms: (units * iters * last.msPerIter) / UPGRADE_WORKERS };
}

function resetUpgrades() {
  lastUpgrades = null;
  $('upgOut').innerHTML = '';
  $('upgNote').textContent = '';
  $('upgGo').disabled = !last;
  if (!last) { $('upgEta').textContent = ''; return; }
  const n = Number($('upgMax').value), plan = upgradePlan(n);
  $('upgEta').textContent = `Up to ${n} items, ${plan.iters} fights each: about ${Math.max(1, Math.round(Math.min(plan.ms, UPGRADE_TIME_CAP_MS) / 1000))}s.`;
}

async function findUpgrades() {
  if (!last) return;
  const { names, apls } = await data;
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
    const { iters } = upgradePlan(cands.length + setJobs.length);
    const base = buildRequest(a, last.parser, names, apls, { ...opts, iterations: iters });
    const t0 = performance.now();
    // Progress in units of one candidate sim; the current gear counts twice.
    const total = cands.length + setJobs.length + 2, done = new Map();
    const tick = (k, w) => ({ stage, done: f }) => {
      if (stage !== 'sim') return;
      done.set(k, f * w);
      const sum = [...done.values()].reduce((x, y) => x + y, 0);
      bar(`Simming ${cands.length} possible upgrades and your current gear, ${iters} fights each, on ${UPGRADE_WORKERS} thread${UPGRADE_WORKERS > 1 ? 's' : ''}… ${Math.round((performance.now() - t0) / 1000)}s`, sum / total);
    };
    let capped = false;
    timer = setTimeout(() => { capped = true; cancelSim(); }, UPGRADE_TIME_CAP_MS);
    const queue = [{ k: 'base', req: { ...base, simOptions: { ...base.simOptions, iterations: iters * 2 } }, w: 2 }, ...cands.map((c, i) => ({ k: i, c, req: swapRequest(base, c.slot, c.id), w: 1 })),
      ...setJobs.map(j => ({ k: `set${j.slot}`, req: withoutSetRequest(base, j.slot, j.stats, j.pseudo), w: 1 }))];
    const out = new Map();
    await Promise.all(Array.from({ length: UPGRADE_WORKERS }, async (_, w) => {
      for (let job; (job = queue.shift());) {
        try {
          const r = await pool.sim(job.req, tick(job.k, job.w), w);
          out.set(job.k, { ...r.raidMetrics.parties[0].players[0].dps, n: r.iterations });
        } catch (e) { if (!(e instanceof CancelledError)) throw e; return; }
      }
    }));
    clearTimeout(timer);
    const secs = (performance.now() - t0) / 1000;
    const b = out.get('base');
    if (!b) throw new CancelledError('cancelled', { capped });
    const results = cands.flatMap((c, i) => {
      const r = out.get(i);
      return r ? [{ ...c, dps: r.avg, err: Math.sqrt((r.stdev ** 2) / r.n + (b.stdev ** 2) / b.n) }] : [];
    });
    // What each broken set bonus is worth: the current gear minus the same gear without the bonus.
    const setCost = new Map(setJobs.filter(j => out.has(`set${j.slot}`)).map(j => {
      const r = out.get(`set${j.slot}`);
      return [j.slot, { dps: b.avg - r.avg, err: Math.sqrt((r.stdev ** 2) / r.n + (b.stdev ** 2) / b.n) }];
    }));
    const prices = await loadPrices();
    lastUpgrades = { rows: bestPerSlot(results, b.avg), gear, names, cands: cands.filter((c, i) => out.has(i)), setCost, underCap, prices, faction: a.combatant?.faction };
    renderUpgrades(lastUpgrades);
    showPriceAge();
    $('upgNote').textContent = `Simmed ${results.length} item${results.length === 1 ? '' : 's'} (${iters} fights each) and your current gear (${iters * 2}) in ${secs.toFixed(1)}s on ${UPGRADE_WORKERS} thread${UPGRADE_WORKERS > 1 ? 's' : ''}.` +
      (capped ? ` Stopped at the ${UPGRADE_TIME_CAP_MS / 1000}s limit; ${cands.length - results.length} were not simmed.` : '') +
      ` ± is the sim's margin for each gain (95%). The candidates were picked from items ranked ahead of time in pre-raid gear.`;
  } catch (e) {
    $('upgOut').innerHTML = e instanceof CancelledError && e.capped ? `<p class="hint">The sim of your current gear did not finish within ${UPGRADE_TIME_CAP_MS / 1000}s. Try fewer items.</p>`
      : e instanceof CancelledError ? '<p class="hint">Cancelled.</p>' : `<p class="warn">${esc(e.message || e)}</p>`;
  } finally {
    clearTimeout(timer);
    $('upgGo').disabled = !last;
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

$('upgGo').onclick = findUpgrades;
readPricePrefs();
showPriceAge();

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
$('ahRegion').onchange = savePricePrefs;
$('ahMarket').onchange = savePricePrefs;
$('upgCancel').onclick = cancelSim;
$('upgMax').onchange = () => { if (last && !$('upgOut').innerHTML) resetUpgrades(); };
$('go').onclick = analyze;
$('cancel').onclick = cancelSim;
