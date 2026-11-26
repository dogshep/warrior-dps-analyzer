import { parseFile } from './logparser.js';
import * as wcl from './wcl.js';
import { mmss } from './cooldowns.js';
import { analyzeFight, buildRequest, compareToSim, suggestions, detectConsumes, missingConsumes, aplSpellNames, auditEnchants, enchantName, SLOT_NAMES, LOG_TO_SIM_SLOTS, fmt } from './analyze.js';

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
  return { names, apls: Object.fromEntries(PRESETS.map((p, i) => [p, apls[i]])) };
})();

// One worker, created on first use, so the 6 MB sim only downloads when someone analyzes a fight.
let worker, nextId = 0;
const pending = new Map();
function sim(request, onProgress) {
  if (!worker) {
    worker = new Worker('js/sim-worker.js');
    worker.onmessage = ({ data: m }) => {
      const p = pending.get(m.id);
      if (!p) return;
      if (m.progress) { p.onProgress && p.onProgress(m.progress); return; }
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
    };
  }
  return new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject, onProgress }); worker.postMessage({ id, request }); });
}

// The progress bar under "Try this next run": label plus a 0..1 fill.
function showProgress(label, done) {
  $("tips").innerHTML = `<li class="d prog">${esc(label)}<div class="bar"><span style="width:${Math.round(done * 100)}%"></span></div></li>`;
}

// The loaded source: a parsed log file, or a Warcraft Logs report whose fights load on demand.
let parser = null, report = null;

async function load(file) {
  report = null;
  $('progress').hidden = false;
  const bar = $('progress').firstElementChild;
  parser = await parseFile(file, f => (bar.style.width = `${Math.round(f * 100)}%`));
  const war = parser.warriors();
  if (!war.length) { alert('No warriors found in this log.'); return; }
  $('who').innerHTML = war.map(w => `<option value="${esc(w.guid)}">${esc(w.name)}${w.hasGear ? '' : ' (no gear in log)'}</option>`).join('');
  fillFights();
  $('pickers').hidden = false;
}

function fillFights() {
  const fights = report ? report.fights : parser.fights($('who').value);
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
      $('wclStatus').textContent = '';
    } catch (e) {
      $('go').disabled = false;
      return wclError(e);
    }
  }
  const a = analyzeFight(parser, guid, fight, names);
  if ($('preset').value) a.preset = $('preset').value;
  const iterations = Math.max(50, Number($('iters').value) || 300);
  const opts = { iterations, race: $('race').value || undefined, talents: $('talents').value.trim() || undefined };

  $('out').hidden = false;
  renderStats(a, null);
  renderTables(a, names);
  renderCooldowns(a);
  showProgress('Starting the sim…', 0);
  $('go').disabled = true;
  try {
    const cons = detectConsumes(a, parser, names);
    // Two runs, one after the other: your setup, then the same with full consumables. The bar covers both.
    const step = (run, label) => ({ stage, done }) => stage === 'download'
      ? (done >= 1 ? showProgress('Starting the sim engine…', 1) : showProgress(`Downloading the sim (first run only)… ${Math.round(done * 100)}%`, done))
      : showProgress(`${label}… ${Math.round(((run + done) / 2) * 100)}%`, (run + done) / 2);
    const mine = await sim(buildRequest(a, parser, names, apls, opts), step(0, `Simming your gear (${iterations} fights)`));
    const best = await sim(buildRequest(a, parser, names, apls, { ...opts, consumes: 'ideal' }), step(1, 'Simming with full consumables'));
    const s = compareToSim(mine, names, mine.iterations || iterations);
    const ideal = compareToSim(best, names, best.iterations || iterations);
    ideal.missing = missingConsumes(cons.found);
    renderStats(a, s, ideal);
    renderTips(suggestions(a, s, ideal, aplSpellNames(apls[a.preset], names)), s && s.simDps - a.dps);
    $('simnote').textContent = `${a.isRun ? `Dungeon run: your DPS counts only time in combat, and the sim fights a typical ${Math.round(a.simDur)}s pull, scaled to your ${a.pulls} pulls. ` : ''}Sim: ${a.preset.replace('_', ' ')} rotation, ${iterations} iterations of a ${Math.round(a.simDur || a.dur)}s fight against ${a.targetCount} target${a.targetCount > 1 ? 's' : ''}, with the buffs and consumables seen in your log. Consumables seen: ${cons.found.map(f => f.name).join(', ') || 'none'}.`;
  } catch (e) {
    renderTips(suggestions(a, null, null));
    $('simnote').innerHTML = `<span class="warn">The sim failed: ${esc(e.message)}</span>. These tips come from the log alone.`;
  } finally {
    $('go').disabled = false;
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

function renderStats(a, s, ideal) {
  const cons = s && ideal ? ideal.simDps - s.simDps : null;
  const cells = [
    ['Your DPS', fmt(a.dps)],
    ['Sim DPS, your gear', s ? fmt(s.simDps) : '…'],
    ['Room to grow from play', s ? (s.simDps > a.dps ? `+${fmt(s.simDps - a.dps)}` : 'at or above sim') : '…', 'gap'],
    ...(cons !== null && cons > 2 ? [['More from full consumables', `+${fmt(cons)}`, 'gap']] : []),
    a.isRun ? ['In combat', `${Math.round(a.dur / 60)} of ${Math.round((a.fight.end - a.fight.start) / 60000)} min, ${a.pulls} pulls`] : ['Fight length', `${Math.round(a.dur)}s`],
    ['Rotation', a.preset.replace('_', ' ')],
  ];
  $('stats').innerHTML = cells.map(([k, v, c]) => `<div class="stat ${c || ''}"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
}

// Play tips first (they share "Room to grow"), then gear and consumables (on top of it).
function renderTips(list, gap) {
  const li = (t, i) => `<li${i ? '' : ' value="1"'}><span class="t">${esc(t.title)}</span>${t.gain ? `<span class="g">≈ +${fmt(t.gain)} DPS</span>` : ''}<div class="d">${esc(t.detail)}</div></li>`;
  const play = list.filter(t => t.group !== 'gear').slice(0, 8), gear = list.filter(t => t.group === 'gear');
  const head = (title, note) => `<li class="grp"><b>${esc(title)}</b>${note ? `<span>${esc(note)}</span>` : ''}</li>`;
  $('tips').innerHTML =
    head('Play', gap > 0 ? `These share your room to grow (+${fmt(gap)}). Each is an estimate, and they overlap.` : '') +
    (play.length ? play.map(li).join('') : '<li>Nothing big stands out. Nice work. Push for longer uptime and cleaner cooldown timing.</li>') +
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
        return `<tr><td>${SLOT_NAMES[si]}</td><td>${n ? `<a href="https://www.wowhead.com/classic/item=${it.id}" target="_blank" rel="noopener">${esc(n[0])}</a>` : `#${it.id} <span class="warn">(not in sim)</span>`}</td><td>${enchCell(it, si)}</td></tr>`;
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
  if (!wcl.token()) return wcl.signIn(link).catch(wclError);
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
  const fi = report.fights.findIndex(f => f.id === ref.fight);
  if (fi >= 0) $('fight').value = String(fi);
  $('pickers').hidden = false;
}

function wclError(e, link) {
  if (e.needsAuth && link) return wcl.signIn(link);
  $('wclStatus').innerHTML = `<span class="warn">${esc(e.message || e)}</span>`;
}

$('wclGo').onclick = () => loadWcl($('wcl').value);
$('wcl').onkeydown = e => { if (e.key === 'Enter') loadWcl($('wcl').value); };
$('wclClient').value = wcl.clientId() === wcl.WCL_CLIENT_ID ? '' : wcl.clientId();
$('wclClient').onchange = () => {
  if (!wcl.setClientId($('wclClient').value)) {
    $('wclStatus').innerHTML = '<span class="warn">That is not a v2 API client id (it looks like 01a2b3c4-…). Using this site\'s client.</span>';
    $('wclClient').value = '';
  }
};
$('wclOut').onclick = () => { wcl.signOut(); $('wclStatus').textContent = 'Signed out of Warcraft Logs.'; };
wcl.finishSignIn().then(link => { if (link) { $('wcl').value = link; loadWcl(link); } }).catch(wclError);
$('go').onclick = analyze;
