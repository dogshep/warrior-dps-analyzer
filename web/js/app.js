import { parseFile } from './logparser.js';
import * as wcl from './wcl.js';
import { showSample, clearSample, sampleLog } from './sample.js';
import { $, esc } from './format.js';
import * as pool from './simpool.js';
import { HS_EXECUTE_RAGE } from './rage.js';
import { DEFAULT_ITERATIONS, MIN_ITERATIONS, MAX_ITERATIONS } from './sim-config.js';
import { tidyTips } from './tips-ui.js';
import { cooldownsHtml, executeView, statsHtml, tipsHtml, tablesHtml } from './render.js';
import { initUpgrades } from './upgrades-ui.js';
import { safeNames, analyzeFight, buildRequest, compareToSim, suggestions, detectConsumes, missingConsumes, aplSpellNames } from './analyze.js';
import { AuthRequiredError, CancelledError, reportUrl } from './errors.js';

$('hsRage').textContent = HS_EXECUTE_RAGE;
// Every "How this works" link opens the fold in the footer.
document.addEventListener('click', e => { if (e.target.closest?.('a[href="#how"]')) $('how').open = true; });
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
  $('tips').innerHTML = `<li class="d prog">${esc(label)}<div class="bar"><span style="width:${Math.round(done * 100)}%"></span></div></li>`;
}

// The loaded source: a parsed log file, or a Warcraft Logs report whose fights load on demand.
let parser = null, report = null;
// The last analyzed fight, for "Find upgrades": {a, parser, opts, msPerIter}.
let last = null;
// The fights listed in the Fight picker (for the chosen warrior), in the same order.
let fights = [];
const { resetUpgrades } = initUpgrades({ data, cancelSim, getLast: () => last });

// Shows a message in a status element: kind 'warn' (red) or 'hint' (plain). Used instead of alert().
function showStatus(el, msg, kind = 'warn') {
  el.innerHTML = `<span class="${kind}">${esc(msg)}</span>${kind === 'warn' ? reportLink(msg) : ''}`;
}
// A "Report this" link that opens a bug report with the error, build and browser filled in.
function reportLink(msg) {
  return ` <a href="${esc(reportUrl(msg))}" target="_blank" rel="noopener">Report this</a>`;
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
  $('progress').hidden = true;
  $('progress').hidden = true;
  const war = parser.warriors();
  if (!war.length) { showStatus($('loadStatus'), 'No warriors found in this log.'); return; }
  $('who').innerHTML = war.map(w => `<option value="${esc(w.guid)}">${esc(w.name)}${w.hasGear ? '' : ' (no gear in log)'}</option>`).join('');
  fillFights();
  $('pickers').hidden = false;
  prewarm();
}

function fillFights() {
  // A Warcraft Logs report lists every fight; keep the ones the chosen warrior was in (when the report says).
  fights = report ? report.fights.filter(f => !f.players || f.players.includes(Number($('who').value))) : parser.fights($('who').value);
  $('go').disabled = !fights.length;
  if (!fights.length) { $('fight').innerHTML = '<option>No fights with this warrior</option>'; return; }
  $('fight').innerHTML = fights.map((f, i) => `<option value="${i}">${f.kind === 'boss' ? '⚔ ' : ''}${esc(f.name)} (${Math.round((f.end - f.start) / 1000)}s${f.kind === 'boss' && !f.success ? ', wipe' : ''})</option>`).join('');
  const boss = fights.findIndex(f => f.kind === 'boss');
  if (boss >= 0) $('fight').value = String(boss);
}

// Downloads the chosen fight of the loaded Warcraft Logs report into `parser`. False when there is nothing to
// analyze (the reason is shown under the link box).
async function loadWclFight(guid, fight) {
  $('go').disabled = true;
  $('wclStatus').textContent = 'Loading the fight from Warcraft Logs…';
  try {
    parser = await wcl.loadFight(report, report.warriors.find(w => w.guid === guid), fight);
    if (!parser.players.get(guid).casts.length && !parser.players.get(guid).damage.length) {
      $('go').disabled = false;
      $('wclStatus').innerHTML = `<span class="warn">${esc($('who').selectedOptions[0].textContent)} has no casts or damage in this fight. Pick another fight.</span>`;
      return false;
    }
    $('wclStatus').textContent = '';
    return true;
  } catch (e) {
    $('go').disabled = false;
    wclError(e);
    return false;
  }
}

// Two sims: your setup, and the same with full consumables. With 2+ workers they run side by side, each split across
// half of them; with one they run one after the other. The bar covers both. Also returns the time per fight on one
// worker, for the upgrades estimate (the engine is already running, so it is the sim alone).
async function runBothSims(a, names, apls, opts) {
  const { iterations } = opts;
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
  const perWorker = side ? Math.ceil(iterations / half) : 2 * iterations;
  return { mine, best, msPerIter: (performance.now() - t1) / perWorker };
}

async function analyze() {
  const { names, apls } = await data;
  const guid = $('who').value;
  const fight = fights[Number($('fight').value)];
  if (report && !(await loadWclFight(guid, fight))) return;
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
    const { mine, best, msPerIter } = await runBothSims(a, names, apls, opts);
    last = { a, parser, opts, msPerIter };
    resetUpgrades();
    const s = compareToSim(mine, names, mine.iterations || iterations);
    const ideal = compareToSim(best, names, best.iterations || iterations);
    ideal.missing = missingConsumes(cons.found);
    renderStats(a, s, ideal);
    renderTips(suggestions(a, s, ideal, aplSpellNames(apls[a.preset], names)), s && s.simDps - a.dps);
    $('simnote').innerHTML = `Sim: ${a.preset.replace('_', ' ')} rotation, ${iterations} fights of ${Math.round(a.simDur || a.dur)}s. <a href="#how">How this works</a>`;
  } catch (e) {
    renderTips(suggestions(a, null, null));
    $('simnote').innerHTML = e instanceof CancelledError
      ? 'Sim cancelled. These tips come from the log alone.'
      : `<span class="warn">The sim failed: ${esc(e.message)}</span>${reportLink(`The sim failed: ${e.message}`)} These tips come from the log alone.`;
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
const renderTips = (list, gap) => { $('tips').innerHTML = tipsHtml(list, gap); tidyTips($('tips')); };

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
  const fi = fights.findIndex(f => f.id === ref.fight);
  if (fi >= 0) $('fight').value = String(fi);
  $('pickers').hidden = false;
  prewarm();
}

// A private report (or one the site can't reach) asks before sending the viewer off to sign in.
function wclError(e, link) {
  $('wclStatus').innerHTML = `<span class="warn">${esc(e.message || e)}</span>${e instanceof AuthRequiredError ? '' : reportLink(e.message || e)}`;
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
$('go').onclick = analyze;
$('cancel').onclick = cancelSim;
