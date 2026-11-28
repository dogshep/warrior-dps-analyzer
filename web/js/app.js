import { parseFile } from './logparser.js';
import * as wcl from './wcl.js';
import { mmss } from './cooldowns.js';
import * as pool from './simpool.js';
import { pickCandidates, budget, swapRequest, bestPerSlot, yellowMiss, breaksHitCap, setChange, withoutSetRequest } from './upgrades.js';
import { loadPrices, priceFor, materialsList, houseKey, gold, age } from './prices.js';
import { safeNames, analyzeFight, buildRequest, compareToSim, suggestions, detectConsumes, missingConsumes, aplSpellNames, auditEnchants, enchantName, SLOT_NAMES, SLOT_ITEM_TYPE, LOG_TO_SIM_SLOTS, fmt } from './analyze.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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

const MAX_ITERATIONS = 5000;
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

async function load(file) {
  cancelSim();
  report = null;
  $('progress').hidden = false;
  const bar = $('progress').firstElementChild;
  parser = await parseFile(file, f => (bar.style.width = `${Math.round(f * 100)}%`));
  const war = parser.warriors();
  if (!war.length) { alert('No warriors found in this log.'); return; }
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
  const iterations = Math.min(MAX_ITERATIONS, Math.max(50, Math.round(Number($('iters').value)) || 300));
  $('iters').value = String(iterations);
  const opts = { iterations, race: $('race').value || undefined, talents: $('talents').value.trim() || undefined };

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
    $('simnote').innerHTML = e.cancelled
      ? 'Sim cancelled. These tips come from the log alone.'
      : `<span class="warn">The sim failed: ${esc(e.message)}</span>. These tips come from the log alone.`;
  } finally {
    $('go').disabled = false;
    $('cancel').hidden = true;
  }
}

// One row per cooldown: when it was up (orange), when it sat ready but unused (red stripes), and the pulls or
// execute phase behind it.
function renderCooldowns(a) {
  const f = a.fight, span = f.end - f.start;
  const pct = t => `${(((Math.min(Math.max(t, f.start), f.end) - f.start) / span) * 100).toFixed(2)}%`;
  const box = (cls, from, to, title) => `<i class="${cls}" style="left:${pct(from)};width:calc(${pct(to)} - ${pct(from)})"${title ? ` title="${esc(title)}"` : ''}></i>`;
  const back = a.pullSpans ? a.pullSpans.map(p => box('pull', p.start, p.end)).join('')
    : a.executeKnown ? box('exec', a.executeStart, f.end, 'Execute phase') : '';
  const rows = a.cooldowns.map(r => {
    const sub = a.pullSpans ? `used on ${r.usedPulls} of ${r.possible} possible pull${r.possible === 1 ? '' : 's'}` : `${r.uses.length} of ${r.possible} possible use${r.possible === 1 ? '' : 's'}`;
    const marks = back + r.idle.map(([x, y]) => box('idle', x, y, `Ready but unused ${mmss(x - f.start)}–${mmss(y - f.start)}`)).join('') +
      r.uses.map(u => box('use', u, u + r.dur * 1000, `${r.name} at ${mmss(u - f.start)}`)).join('');
    return `<div class="lbl"><b>${esc(r.name)}</b><span class="${r.lost ? 'warn' : ''}">${esc(sub)}</span></div><div class="track">${marks}</div>`;
  }).join('');
  $('cds').innerHTML = rows + `<div class="axis"><span>0:00</span><span>${mmss(span / 2)}</span><span>${mmss(span)}</span></div>`;
  $('cdnote').innerHTML = `<span class="legend"><span><i style="background:var(--accent)"></i>Cooldown up</span><span><i style="background:repeating-linear-gradient(135deg,#d9644a99 0 3px,transparent 3px 6px)"></i>Ready but unused</span>${a.pullSpans ? '<span><i style="background:#ffffff22"></i>Pull</span>' : a.executeKnown ? '<span><i style="background:#c7802f44"></i>Execute phase</span>' : ''}</span>` +
    (a.pullSpans ? 'On a dungeon run, "possible" counts one use on each pull of 20s or more (any pull for Bloodrage) that the cooldown was back for, so a fast group is not held against you.' : 'Talent, racial and potion cooldowns only show once the log has you using them.');
}

// Execute phase: DPS and casts per minute before and under 20% (single fights where the boss's health is known).
function renderExecute(a) {
  const x = a.execute;
  $('exec').hidden = !x;
  if (!x) return;
  $('execSum').textContent = `Under 20% from ${mmss(x.start - a.fight.start)} for ${Math.round(x.sec)}s. Your DPS: ${fmt(x.dps[0])} before, ${fmt(x.dps[1])} under 20%.`;
  const pm = v => (Math.round(v * 10) / 10).toFixed(1);
  $('execTable').innerHTML = '<tr><th>Ability</th><th class="n">Per minute before 20%</th><th class="n">Per minute under 20%</th></tr>' +
    x.rows.map(r => `<tr><td>${esc(r.name)}</td><td class="n">${pm(r.perMin[0])}</td><td class="n">${pm(r.perMin[1])}</td></tr>`).join('');
}

function renderStats(a, s, ideal) {
  const cons = s && ideal ? ideal.simDps - s.simDps : null;
  const cells = [
    ['Your DPS', fmt(a.dps)],
    ['Sim DPS, your gear', s ? fmt(s.simDps) : '…'],
    ['Room to grow from play', s ? (s.simDps > a.dps ? `+${fmt(s.simDps - a.dps)}` : 'at or above sim') : '…', 'gap'],
    ...(cons !== null && cons > 2 ? [['More from full consumables', `+${fmt(cons)}`, 'gap']] : []),
    a.isRun ? ['In combat', `${Math.round(a.dur / 60)} of ${Math.round((a.fight.end - a.fight.start) / 60000)} min, ${a.pulls} pulls`] : ['Fight length', `${Math.round(a.dur)}s`],
    ['Rotation', a.preset.replace('_', ' ')],
    ...(a.uptimes.flurry > 0 ? [['Flurry uptime', `${Math.round(a.uptimes.flurry * 100)}%`]] : []),
  ];
  $('stats').innerHTML = cells.map(([k, v, c]) => `<div class="stat ${c || ''}"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
}

// What the listed play tips don't cover, so the group adds up to "Room to grow" exactly (using the rounded numbers
// shown on the page).
function restLine(play, gap) {
  if (!(gap > 0)) return '';
  const rest = Math.round(gap) - play.reduce((n, t) => n + (t.gain ? Math.round(t.gain) : 0), 0);
  if (rest < 1) return '';
  return `<li><span class="t">Everything else</span><span class="g">≈ +${fmt(rest)} DPS</span><div class="d">Small differences from the sim that are too small to list or have no DPS number (like Battle Shout uptime), plus a little sim randomness. With this line, the play tips add up to your room to grow.</div></li>`;
}

// Play tips first (they share "Room to grow"), then gear and consumables (on top of it).
function renderTips(list, gap) {
  const links = t => t.links ? `<div class="src">Guide: ${t.links.map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`).join(' · ')}</div>` : '';
  const li = (t, i) => `<li${i ? '' : ' value="1"'}><span class="t">${esc(t.title)}</span>${t.gain ? `<span class="g">≈ +${fmt(t.gain)} DPS</span>` : ''}<div class="d">${esc(t.detail)}</div>${links(t)}</li>`;
  const play = list.filter(t => t.group !== 'gear').slice(0, 8), gear = list.filter(t => t.group === 'gear');
  const head = (title, note) => `<li class="grp"><b>${esc(title)}</b>${note ? `<span>${esc(note)}</span>` : ''}</li>`;
  $('tips').innerHTML =
    head('Play', gap > 0 ? `These share your room to grow (+${fmt(gap)}). Each is an estimate, and they overlap.` : '') +
    (play.length ? play.map(li).join('') : '<li>Nothing big stands out. Nice work. Push for longer uptime and cleaner cooldown timing.</li>') +
    restLine(play, gap) +
    (gear.length ? head('Gear and consumables', 'On top of your room to grow.') + gear.map(li).join('') : '');
}

function renderTables(a, names) {
  $('abil').innerHTML = '<tr><th>Ability</th><th class="n">Casts</th><th class="n">Damage</th><th class="n">%</th><th class="n">Crit</th></tr>' +
    a.abilities.filter(x => x.damage > 0 || x.casts > 0).map(x => `<tr><td>${esc(x.name)}</td><td class="n">${x.name === 'Melee' ? x.hits : x.casts}</td><td class="n">${fmt(x.damage)}</td><td class="n">${a.total ? ((x.damage / a.total) * 100).toFixed(1) : 0}</td><td class="n">${x.hits ? Math.round((x.crits / x.hits) * 100) + '%' : ''}</td></tr>`).join('');
  const gear = a.combatant?.items || [];
  const audit = new Map(auditEnchants(gear, names).map(e => [e.slot, e]));
  const enchCell = (it, si) => {
    const e = audit.get(si);
    const nm = it.enchant ? esc(enchantName(names, it.enchant, si).replace(/^Enchant [\w\s-]+? - /, '')) : '';
    if (!e || e.ok) return nm;
    return `<span class="warn">${nm || 'None'}</span><div class="hint">→ ${esc(e.best.slice(0, 2).join(' or '))}</div>`;
  };
  $('gear').innerHTML = gear.length
    ? '<tr><th>Slot</th><th>Item</th><th>Enchant</th></tr>' + LOG_TO_SIM_SLOTS.map((li, si) => {
        const it = gear[li];
        if (!it || !it.id) return '';
        const n = names.items[it.id];
        const id = Number(it.id) || 0;
        return `<tr><td>${SLOT_NAMES[si]}</td><td>${n ? `<a href="https://www.wowhead.com/forever/item=${id}" target="_blank" rel="noopener">${esc(n[0])}</a>` : `#${id} <span class="warn">(not in sim)</span>`}</td><td>${enchCell(it, si)}</td></tr>`;
      }).join('')
    : '<tr><td class="warn">No gear in this log. Turn on Advanced Combat Logging.</td></tr>';
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
  if (e.needsAuth && link) {
    const b = document.createElement('button');
    b.className = 'link';
    b.textContent = 'Sign in to Warcraft Logs';
    b.onclick = () => wcl.signIn(link).catch(wclError);
    $('wclStatus').append(' ', b);
  }
}

$('wclGo').onclick = () => loadWcl($('wcl').value);
$('wcl').onkeydown = e => { if (e.key === 'Enter') loadWcl($('wcl').value); };
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
    const dualWield = !!ohInfo && ohInfo[1] === 13;
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
      $('upgOut').innerHTML = '<p>Every likely upgrade from these sources would put you under the hit cap.</p>' + underCapLine(underCap, names);
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
        } catch (e) { if (!e.cancelled) throw e; return; }
      }
    }));
    clearTimeout(timer);
    const secs = (performance.now() - t0) / 1000;
    const b = out.get('base');
    if (!b) throw Object.assign(new Error('cancelled'), { cancelled: !capped, capped });
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
    lastUpgrades = [bestPerSlot(results, b.avg), gear, names, cands.filter((c, i) => out.has(i)), setCost, underCap, prices, a.combatant?.faction];
    renderUpgrades(...lastUpgrades);
    showPriceAge();
    $('upgNote').textContent = `Simmed ${results.length} item${results.length === 1 ? '' : 's'} (${iters} fights each) and your current gear (${iters * 2}) in ${secs.toFixed(1)}s on ${UPGRADE_WORKERS} thread${UPGRADE_WORKERS > 1 ? 's' : ''}.` +
      (capped ? ` Stopped at the ${UPGRADE_TIME_CAP_MS / 1000}s limit; ${cands.length - results.length} were not simmed.` : '') +
      ` ± is the sim's margin for each gain (95%). The candidates were picked from items ranked ahead of time in pre-raid gear.`;
  } catch (e) {
    $('upgOut').innerHTML = e.capped ? `<p class="hint">The sim of your current gear did not finish within ${UPGRADE_TIME_CAP_MS / 1000}s. Try fewer items.</p>`
      : e.cancelled ? '<p class="hint">Cancelled.</p>' : `<p class="warn">${esc(e.message || e)}</p>`;
  } finally {
    clearTimeout(timer);
    $('upgGo').disabled = !last;
    $('upgCancel').hidden = true;
  }
}

// The candidates left out for the hit cap, best guess first, one per slot.
function underCapLine(underCap, names) {
  const seen = new Set(), list = [];
  for (const c of underCap.sort((x, y) => (y.est ?? 0) - (x.est ?? 0))) {
    if (seen.has(c.slot)) continue;
    seen.add(c.slot);
    list.push(`${SLOT_NAMES[c.slot]}: ${names.items[c.id]?.[0] || `#${c.id}`} (${c.miss.toFixed(1)}% under)`);
  }
  return list.length ? `<p class="hint">Left out because they would put you under the hit cap for special attacks: ${esc(list.join('; '))}.</p>` : '';
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
  if (lastUpgrades) renderUpgrades(...lastUpgrades);
  showPriceAge();
}
let lastUpgrades = null;

// Price line for a crafted upgrade, from the chosen auction house.
function priceLine(prices, key, id) {
  if (!String(upgradeTable.items[id]?.[3] || '').includes('c')) return '';
  const p = priceFor(prices, key, id);
  if (p === undefined) return '';
  if (p === null) return '<div class="src">Not on the auction house right now</div>';
  const ah = p.listed
    ? `<div class="price">AH from ${gold(p.min)}${p.listed > 1 ? ` <span class="src">(${p.listed} listed, median ${gold(p.median)})</span>` : ''}</div>`
    : '<div class="src">Not on the auction house right now</div>';
  if (p.materials === undefined) return ah;
  const list = materialsList(prices, id);
  const missing = p.unpriced ? ` <span class="src">+ ${p.unpriced} not on the AH</span>` : '';
  return ah + `<div class="price" title="${esc(list ? `Materials: ${list}` : '')}">Materials ${p.unpriced ? 'at least' : 'about'} ${gold(p.materials)}${missing}</div>`;
}

function renderUpgrades(rows, gear, names, cands, setCost = new Map(), underCap = [], prices = null, faction) {
  const MARKET_NAMES = { normal: 'Normal', pvp: 'PvP', rp: 'RP', rppvp: 'RP PvP' };
  const key = houseKey($('ahRegion').value, $('ahMarket').value, faction);
  const house = prices?.houses?.[key];
  const crafted = rows.some(r => String(upgradeTable.items[r.id]?.[3] || '').includes('c'));
  const KIND_TAG = { d: 'Dungeon', r: 'Raid', c: 'Crafted', q: 'Quest', v: 'Vendor', f: 'Reputation', p: 'PvP' };
  const tags = id => [...(upgradeTable.items[id]?.[3] || '')].map(k => KIND_TAG[k] ? `<span class="tag">${KIND_TAG[k]}</span>` : '').join('');
  const link = id => `<a href="https://www.wowhead.com/forever/item=${Number(id)}" target="_blank" rel="noopener">${esc(names.items[id]?.[0] || `#${id}`)}</a>`;
  const found = new Set(rows.map(r => r.slot));
  const none = [...new Set(cands.map(c => c.slot))].filter(s => !found.has(s)).map(s => SLOT_NAMES[s]);
  $('upgOut').innerHTML = (rows.length
    ? '<table><tr><th>Slot</th><th>Upgrade</th><th class="n">DPS</th><th>Where to get it</th></tr>' + rows.map(r => {
        const cur = gear[r.slot]?.id;
        const cost = setCost.get(r.slot);
        const sets = (r.sets?.lost || []).map(x => `<div class="warn small">Breaks ${esc(x)}${cost ? `, worth about ${fmt(Math.max(0, cost.dps))} DPS (±${fmt(1.96 * cost.err)}). The gain already counts that loss.` : '. The gain already counts that loss.'}</div>`).join('') +
          (r.sets?.gained || []).map(x => `<div class="src">Completes ${esc(x)}</div>`).join('');
        return `<tr><td>${SLOT_NAMES[r.slot]}</td><td>${link(r.id)}${tags(r.id)}${cur ? `<div class="src">instead of ${esc(names.items[cur]?.[0] || `#${cur}`)}</div>` : ''}${sets}</td><td class="n g">+${fmt(r.gain)}<span class="src"> ±${fmt(1.96 * r.err)}</span>${r.gain < 1.96 * r.err ? '<div class="src">within sim noise</div>' : ''}</td><td class="src">${esc(upgradeTable.items[r.id]?.[0] || '')}${priceLine(prices, key, r.id)}</td></tr>`;
      }).join('') + '</table>'
    : '<p>None of the likely upgrades beat your current gear in the sim.</p>') +
    (none.length ? `<p class="hint">Simmed but not an upgrade in your gear: ${esc(none.join(', '))}.</p>` : '') +
    underCapLine(underCap, names) +
    (crafted ? `<p class="hint">${house
      ? `Crafted item prices: lowest buyout on the ${$('ahRegion').value.toUpperCase()} ${MARKET_NAMES[$('ahMarket').value]} ${faction === 0 ? 'Horde' : 'Alliance'} auction house, from Blizzard's auction data, updated ${age(house.updated)}. Materials: what one craft's reagents cost from the cheapest listings there (hover for the list). Prices move; check in game.`
      : prices ? 'No auction house prices for this realm type yet.' : 'Auction house prices could not be loaded.'}</p>` : '');
}

$('upgGo').onclick = findUpgrades;
readPricePrefs();
showPriceAge();

// When the chosen house's prices were last pulled from Blizzard, shown beside the AH choices.
async function showPriceAge(faction = lastUpgrades?.[7]) {
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
