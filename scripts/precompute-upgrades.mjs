// Build-time prefilter for the "Gear upgrades" section. For each rotation it ranks every level 60 item a warrior
// can use, so the page only has to sim a few candidates per slot against the player's own gear.
//
// 1. Stat weights: sim the rotation's pre-raid gear with a little extra of each stat (same seed, so the
//    difference is the stat and not luck).
// 2. Every candidate gets a stat-weight score. Per slot, the best scores, plus items whose value hides in
//    procs, on-use effects, weapon skill or set bonuses, are simmed swapped into that same gear.
// 3. web/sim/upgrades.json keeps, per rotation and slot, each item's DPS change from the reference item
//    (simmed, or estimated from weights), and for the items the page may suggest [where it comes from, faction
//    (0 both, 1 Alliance, 2 Horde), phase, source kinds (see KINDS), and the date it can first be had in Forever
//    when that is still ahead (see data/forever-availability.json)].
//
// Usage: node scripts/precompute-upgrades.mjs <wowsims db.json> <web/sim dir>
// Env: UPGRADE_ITERS (item sims, default 300), UPGRADE_WEIGHT_ITERS (default 2000), UPGRADE_THREADS (default: CPU
// count), UPGRADE_PRESETS (comma list).
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { DEFAULT_TALENTS, consumesFor, DEFAULT_TARGET } from '../web/js/analyze.js';
import { SLOT_POOLS, poolFor } from '../web/js/upgrades.js';
import { HELD_ITEMS, opensOn } from './availability.mjs';

async function loadSim(simDir) {
  createRequire(import.meta.url)(new URL('wasm_exec.js', simDir).pathname);
  const wasm = gunzipSync(readFileSync(new URL('lib.wasm.gz', simDir)));
  await new Promise(res => { globalThis.wasmready = res; const go = new Go(); WebAssembly.instantiate(wasm, go.importObject).then(r => go.run(r.instance)); });
  return req => {
    const out = JSON.parse(globalThis.raidSimJson(JSON.stringify(req)));
    if (out.error?.message) throw new Error(out.error.message.split('\n')[0]);
    return out.raidMetrics.parties[0].players[0].dps.avg;
  };
}


// A pool of sim threads; sim(req) resolves to the DPS.
async function pool(simDir, n) {
  let next = 0;
  const waiting = new Map(), idle = [], queue = [];
  const workers = await Promise.all(Array.from({ length: n }, () => new Promise((res, rej) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { simDir: simDir.href } });
    w.on('error', rej);
    w.on('message', m => {
      if (m.ready) { res(w); return; }
      const p = waiting.get(m.id);
      waiting.delete(m.id);
      m.error ? p.reject(new Error(m.error)) : p.resolve(m.dps);
      const q = queue.shift();
      q ? send(w, q) : idle.push(w);
    });
  })));
  idle.push(...workers);
  function send(w, job) { waiting.set(job.id, job); w.postMessage({ id: job.id, req: job.req }); }
  return {
    sim: req => new Promise((resolve, reject) => {
      const job = { id: ++next, req, resolve, reject };
      const w = idle.pop();
      w ? send(w, job) : queue.push(job);
    }),
    close: () => workers.forEach(w => w.terminate()),
  };
}

const PROFESSIONS = { 1: 'Alchemy', 2: 'Blacksmithing', 3: 'Enchanting', 4: 'Engineering', 8: 'Leatherworking', 9: 'Mining', 11: 'Tailoring' };
const REP_LEVELS = { 4: 'Neutral', 5: 'Friendly', 6: 'Honored', 7: 'Revered', 8: 'Exalted' };
// Stats that matter to a DPS warrior, and how much of each the weight sims add. Big steps and many iterations:
// two sims with different gear drift apart in their random rolls, so a small difference drowns in noise.
const WEIGHT_STATS = { 0: 100, 1: 100, 14: 200, 17: 50, 18: 70, 19: 50, 21: 50 };
// Source kinds, as letters in upgrades.json: d dungeon or world drop, r raid, c crafted, q quest, v vendor,
// f reputation, p PvP. The page filters on them, so each kind (and each faction) gets its own picks below.
const KINDS = 'drcqvfp';
// Per slot, kind and faction, how many weapons (best by stat weights and weapon DPS) and how many items with procs,
// on-use effects or weapon skill get simmed. Stat weights price everything else, and price it well.
const SIM_TOP = 4;
// Per slot, kind and faction, how many of the best items the page may pick from (and gets sources for). Items that
// open later in Forever get their own quota, so they never crowd out what can be had now.
const KEEP_TOP = 8;

function sourceText(db, it) {
  const zone = id => db.zoneName.get(id) || '';
  const out = [];
  const drops = new Map(); // zone -> boss names
  for (const s of it.sources || []) {
    if (s.drop) {
      const d = s.drop, z = zone(d.zoneId) || 'World drop';
      const who = d.npcId ? db.npcName.get(d.npcId) : d.otherName && d.otherName !== 'World Drop' ? d.otherName : '';
      if (!drops.has(z)) drops.set(z, []);
      if (who && !drops.get(z).includes(who)) drops.get(z).push(who);
    } else if (s.quest) out.push(`Quest: ${s.quest.name}${zone(s.quest.zoneId) ? ` (${zone(s.quest.zoneId)})` : ''}`);
    else if (s.soldBy) out.push(`Sold by ${s.soldBy.npcName}${zone(s.soldBy.zoneId) ? ` (${zone(s.soldBy.zoneId)})` : ''}`);
    else if (s.crafted) out.push(`Crafted: ${PROFESSIONS[s.crafted.profession] || 'profession'}`);
    else if (s.rep) out.push(`${db.factionName.get(s.rep.repFactionId) || 'Reputation'}, ${REP_LEVELS[s.rep.repLevel] || 'reputation'}`);
    else if (s.pvp) out.push('PvP reward');
  }
  const dropText = [...drops].map(([z, who]) => (who.length ? `${z}: ${who.slice(0, 3).join(', ')}${who.length > 3 ? ` +${who.length - 3} more` : ''}` : z));
  return [...new Set([...dropText, ...out])].slice(0, 3).join(' · ');
}

// 0 = both factions, 1 = Alliance only, 2 = Horde only (a quest, vendor or reputation for one side, with no
// neutral source). PvP rank items say their side in the name.
const ALLIANCE_PVP = /^(Grand Marshal|Field Marshal|Marshal|Commander|Lieutenant Commander|Knight-Captain|Knight-Lieutenant|Stormpike)\b/;
const HORDE_PVP = /^(High Warlord|Warlord|General|Lieutenant General|Champion|Legionnaire|Blood Guard|Frostwolf)\b/;
function factionOf(it) {
  if (ALLIANCE_PVP.test(it.name)) return 1;
  if (HORDE_PVP.test(it.name)) return 2;
  const f = new Set((it.sources || []).map(s => (s.quest || s.soldBy)?.faction ?? s.rep?.factionId ?? 0));
  return f.has(0) || f.size !== 1 ? 0 : [...f][0];
}

// The kinds of source an item has (see KINDS). A PvP reward is only 'p', though rank vendors sell it. A quest that
// starts in a raid counts as a raid.
function kindsOf(it, raidZones) {
  const src = it.sources || [];
  if (src.some(s => s.pvp)) return 'p';
  const k = new Set();
  for (const s of src) {
    if (s.drop) k.add(s.drop.difficulty === 2 ? 'r' : 'd');
    else if (s.quest) k.add(raidZones.has(s.quest.zoneId) ? 'r' : 'q');
    else if (s.crafted) k.add('c');
    else if (s.soldBy) k.add('v');
    else if (s.rep) k.add('f');
  }
  return [...KINDS].filter(c => k.has(c)).join('');
}

// A level 60 rare or better a warrior can equip, with something for a DPS warrior on it, that the item database
// says how to get. Random-suffix items are skipped (their stats depend on the suffix). Only phase 1 items: wowsims
// marks an item phase 1 when it can be had in Forever now, and Unknown (2) when it can't yet: drops from every raid
// but Onyxia's Lair and Mount Hyjal, rewards of events Forever does not hold, and anything that needs those.
function usable(it) {
  const so = it.scalingOptions?.['0'] || {};
  if (it.phase !== 1 || HELD_ITEMS.has(it.id)) return false;
  if ((it.quality || 0) < 3 || (so.ilvl || 0) < 55 || !(it.sources || []).length || it.randomSuffixOptions) return false;
  if (it.classAllowlist && !it.classAllowlist.includes(1)) return false;
  const t = it.type || 0;
  if (t >= 1 && t <= 10 && t !== 4 && it.armorType === 1) return false; // cloth, except cloaks
  if (t === 13 && [5, 7].includes(it.weaponType)) return false;           // held-in-off-hand frills, shields
  if (t === 14 && ![1, 2, 3, 4].includes(it.rangedWeaponType)) return false;
  return true;
}

const special = it => !!(it.itemEffects?.length || (it.pseudoStats || []).some(Boolean));

function baseRequest(preset, apl, items, iterations, bonusStats) {
  return {
    raid: {
      parties: [{ players: [{
        name: 'Warrior', race: 'RaceOrc', class: 'ClassWarrior', equipment: { items }, consumables: consumesFor(preset),
        buffs: { greaterBlessingOfKings: true, greaterBlessingOfMight: 1 }, talentsString: DEFAULT_TALENTS[preset], rotation: apl,
        ...(bonusStats ? { bonusStats } : {}),
        dpsWarrior: { options: { classOptions: { useBattleShout: true, defaultStance: 'WarriorStanceBerserker' } } },
      }], buffs: {} }],
      buffs: { markOfTheWild: true, powerWordFortitude: true },
      debuffs: { sunderArmor: true, curseOfRecklessness: true, faerieFire: true },
    },
    encounter: { duration: 120, executeProportion20: 0.2, executeProportion35: 0.35, targets: [DEFAULT_TARGET] },
    simOptions: { iterations, randomSeed: '1337' },
  };
}

async function main() {
  const [dbPath, simArg] = process.argv.slice(2);
  if (!dbPath || !simArg) { console.error('Usage: node scripts/precompute-upgrades.mjs <db.json> <web/sim dir>'); process.exit(2); }
  const simDir = new URL(simArg.replace(/\/?$/, '/'), `file://${process.cwd()}/`);
  const iterations = Number(process.env.UPGRADE_ITERS) || 300;
  const weightIters = Number(process.env.UPGRADE_WEIGHT_ITERS) || 2000;
  const threads = Number(process.env.UPGRADE_THREADS) || availableParallelism();
  const presets = (process.env.UPGRADE_PRESETS || 'fury,fury_2h,arms').split(',');
  const raw = JSON.parse(readFileSync(dbPath, 'utf8'));
  const db = {
    zoneName: new Map(raw.zones.map(z => [z.id, z.name])),
    npcName: new Map(raw.npcs.map(n => [n.id, n.name])),
    factionName: new Map(raw.factions.map(f => [f.id, f.name])),
  };
  const byId = new Map(raw.items.map(it => [it.id, it]));
  const raidZones = new Set(raw.items.flatMap(it => (it.sources || []).filter(s => s.drop?.difficulty === 2).map(s => s.drop.zoneId)));
  const kinds = new Map(raw.items.map(it => [it.id, kindsOf(it, raidZones)]));
  // The items of a kind one faction can get, best first.
  const ofKind = (scored, k, side) => scored.filter(x => kinds.get(x.it.id).includes(k) && [0, side].includes(factionOf(x.it)));
  const candidates = raw.items.filter(usable);
  const opens = new Map(candidates.map(it => [it.id, opensOn(it)]));
  const later = candidates.filter(it => opens.get(it.id));
  console.log(`${later.length} candidates open later in Forever: ${later.map(it => `${it.name} (${opens.get(it.id)})`).join(', ')}`);
  const t0 = Date.now();
  const { sim, close } = await pool(simDir, threads);
  let sims = 0;
  const count = p => (sims++, p);
  const out = { iterations, weightIterations: weightIters, presets: {}, items: {} };

  for (const preset of presets) {
    const apl = JSON.parse(readFileSync(new URL(`apls/${preset}.apl.json`, simDir)));
    const ref = JSON.parse(readFileSync(new URL(`gear_sets/prebis_${preset}.gear.json`, simDir))).items;
    const base = await count(sim(baseRequest(preset, apl, ref, weightIters)));
    // Stat weights, in DPS per point.
    const weights = {};
    await Promise.all(Object.entries(WEIGHT_STATS).map(async ([s, v]) => {
      const stats = Array.from({ length: 39 }, (_, i) => (i === Number(s) ? v : 0));
      weights[s] = ((await count(sim(baseRequest(preset, apl, ref, weightIters, { stats })))) - base) / v;
    }));
    // Main hand and off hand weapon DPS (pseudo stats 0 and 1).
    const wDps = await Promise.all([0, 1].map(async ps => {
      const pseudoStats = Array.from({ length: 40 }, (_, i) => (i === ps ? 10 : 0));
      return ((await count(sim(baseRequest(preset, apl, ref, weightIters, { pseudoStats })))) - base) / 10;
    }));
    const ep = (it, slot) => {
      const so = it.scalingOptions['0'];
      let v = 0;
      for (const [s, n] of Object.entries(so.stats || {})) v += (weights[s] || 0) * n;
      if (it.type === 13) v += (slot === 15 ? wDps[1] : wDps[0]) * (so.unroundedDps || 0);
      return v;
    };
    const slots = {};
    // All slots at once, so every thread stays busy.
    await Promise.all(Object.entries(SLOT_POOLS).map(async ([key, slot]) => {
      const pool = candidates.filter(it => poolFor(it, preset).includes(key));
      if (!pool.length) return;
      const refItem = byId.get(ref[slot]?.id);
      const refEp = refItem?.scalingOptions?.['0'] ? ep(refItem, slot) : 0;
      const scored = pool.map(it => ({ it, val: ep(it, slot) - refEp, simmed: 0 })).sort((a, b) => b.val - a.val);
      const pick = new Set();
      for (const k of KINDS) for (const side of [1, 2]) {
        const inKind = ofKind(scored, k, side);
        if (slot >= 14) for (const x of inKind.slice(0, SIM_TOP)) pick.add(x);
        for (const x of inKind.filter(y => special(y.it)).slice(0, SIM_TOP)) pick.add(x);
      }
      // The other ring, trinket or weapon in the reference gear: a unique item can't be worn twice.
      const pair = { 10: 11, 12: 13, 14: 15 }[slot];
      await Promise.all([...pick].map(async x => {
        let at = slot;
        if (pair !== undefined && ref[pair]?.id === x.it.id && x.it.unique) at = pair;
        if (ref[at]?.id === x.it.id) { x.val = 0; x.simmed = 1; return; }
        const items = ref.map((r, i) => (i === at ? { id: x.it.id, ...(r.enchant ? { enchant: r.enchant } : {}) } : r));
        try {
          x.val = (await count(sim(baseRequest(preset, apl, items, iterations)))) - base;
          x.simmed = 1;
        } catch (e) { console.warn(`${preset} ${key}: ${x.it.name} failed: ${e.message}`); }
      }));
      // Weapons are only trusted from the sim (speed and procs matter more than weights can say): the page picks
      // from simmed ones, and the rest only price what the player wears.
      scored.sort((a, b) => (slot >= 14 ? b.simmed - a.simmed : 0) || b.val - a.val);
      // [id, DPS change from the reference item, 1 if simmed else 0 (priced by stat weights)], best first.
      slots[key] = scored.map(x => [x.it.id, round(x.val), x.simmed]);
      const trusted = scored.filter(y => slot < 14 || y.simmed);
      for (const k of KINDS) for (const side of [1, 2]) for (const later of [false, true]) {
        for (const x of ofKind(trusted, k, side).filter(y => !!opens.get(y.it.id) === later).slice(0, KEEP_TOP)) {
          // Order as in web/js/fields.js SRC.
          const meta = [sourceText(db, x.it), factionOf(x.it), x.it.phase || 1, kinds.get(x.it.id)];
          if (opens.get(x.it.id)) meta.push(opens.get(x.it.id));
          out.items[x.it.id] ??= meta;
        }
      }
      const best = scored[0];
      console.log(`${preset} ${key}: ${pool.length} items, simmed ${pick.size}, best ${best.it.name} (${best.val >= 0 ? '+' : ''}${round(best.val)}${best.simmed ? ', simmed' : ''})`);
    }));
    out.presets[preset] = { ref: `prebis_${preset}`, baseDps: round(base), weights: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Math.round(v * 1000) / 1000])), slots };
  }
  close();
  out.builtIn = `${Math.round((Date.now() - t0) / 1000)}s, ${sims} sims of ${iterations} iterations on ${threads} threads`;
  writeFileSync(new URL('upgrades.json', simDir), JSON.stringify(out));
  console.log(`upgrades.json: ${Object.keys(out.items).length} items with sources; ${out.builtIn}`);
  process.exit(0);
}

export { sourceText, factionOf, kindsOf, usable, special };
const round = x => Math.round(x * 10) / 10;

// Worker thread: sims the requests it is sent.
if (!isMainThread) {
  const run = await loadSim(new URL(workerData.simDir));
  parentPort.on('message', ({ id, req }) => {
    try { parentPort.postMessage({ id, dps: run(req) }); } catch (e) { parentPort.postMessage({ id, error: String(e.message || e) }); }
  });
  parentPort.postMessage({ ready: true });
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Only when run as a script, so tests can import the helpers below.
  await main();
}
