import { parseFile } from './logparser.js';
import * as wcl from './wcl.js';
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
function sim(request) {
  if (!worker) {
    worker = new Worker('js/sim-worker.js');
    worker.onmessage = ({ data: m }) => { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); };
  }
  return new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); worker.postMessage({ id, request }); });
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
  $('tips').innerHTML = '<li class="d">Running the sim on your gear…</li>';
  $('go').disabled = true;
  try {
    const cons = detectConsumes(a, parser, names);
    const [mine, best] = await Promise.all([
      sim(buildRequest(a, parser, names, apls, opts)),
      sim(buildRequest(a, parser, names, apls, { ...opts, consumes: 'ideal' })),
    ]);
    const s = compareToSim(mine, names, iterations);
    const ideal = compareToSim(best, names, iterations);
    ideal.missing = missingConsumes(cons.found);
    renderStats(a, s);
    renderTips(suggestions(a, s, ideal, aplSpellNames(apls[a.preset], names)));
    $('simnote').textContent = `Sim: ${a.preset.replace('_', ' ')} rotation, ${iterations} iterations of a ${Math.round(a.dur)}s fight against ${a.targetCount} target${a.targetCount > 1 ? 's' : ''}, with the buffs and consumables seen in your log. Consumables seen: ${cons.found.map(f => f.name).join(', ') || 'none'}.`;
  } catch (e) {
    renderTips(suggestions(a, null, null));
    $('simnote').innerHTML = `<span class="warn">The sim failed: ${esc(e.message)}</span>. These tips come from the log alone.`;
  } finally {
    $('go').disabled = false;
  }
}

function renderStats(a, s) {
  const cells = [
    ['Your DPS', fmt(a.dps)],
    ['Sim DPS, your gear', s ? fmt(s.simDps) : '…'],
    ['Room to grow', s ? (s.simDps > a.dps ? `+${fmt(s.simDps - a.dps)}` : 'at or above sim') : '…', 'gap'],
    ['Fight length', `${Math.round(a.dur)}s`],
    ['Rotation', a.preset.replace('_', ' ')],
  ];
  $('stats').innerHTML = cells.map(([k, v, c]) => `<div class="stat ${c || ''}"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
}

function renderTips(list) {
  $('tips').innerHTML = list.length
    ? list.slice(0, 8).map(t => `<li><span class="t">${esc(t.title)}</span>${t.gain ? `<span class="g">≈ +${fmt(t.gain)} DPS</span>` : ''}<div class="d">${esc(t.detail)}</div></li>`).join('')
    : '<li>Nothing big stands out. Nice work. Push for longer uptime and cleaner cooldown timing.</li>';
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
