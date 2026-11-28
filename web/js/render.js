// Turns analysis results into HTML strings (and small view models). No DOM access, so tests can call them.
// app.js and upgrades-ui.js put the strings on the page.
import { esc, fmt, mmss } from './format.js';
import { houseKey, priceFor, materialsList, gold, age } from './prices.js';
import { auditEnchants, shortEnchantName, SLOT_NAMES, LOG_TO_SIM_SLOTS } from './analyze.js';
import { ITEM, SRC, isCrafted } from './fields.js';

// 95% confidence margin of a sim result, in standard errors.
const Z95 = 1.96;
const MARKET_NAMES = { normal: 'Normal', pvp: 'PvP', rp: 'RP', rppvp: 'RP PvP' };
const KIND_TAG = { d: 'Dungeon', r: 'Raid', c: 'Crafted', q: 'Quest', v: 'Vendor', f: 'Reputation', p: 'PvP' };

// One row per cooldown: when it was up (orange), when it sat ready but unused (red stripes), and the pulls or
// execute phase behind it.
export function cooldownsHtml(a) {
  const f = a.fight, span = f.end - f.start;
  const pct = t => `${(((Math.min(Math.max(t, f.start), f.end) - f.start) / span) * 100).toFixed(2)}%`;
  const box = (cls, from, to, title) => `<i class="${cls}" style="left:${pct(from)};width:calc(${pct(to)} - ${pct(from)})"${title ? ` title="${esc(title)}"` : ''}></i>`;
  const back = a.pullSpans ? a.pullSpans.map(p => box('pull', p.start, p.end)).join('')
    : a.executeKnown ? box('exec', a.executeStart, f.end, 'Execute phase') : '';
  // Only the cooldowns that were missed; ones used whenever they came up stay off the chart.
  const missed = a.cooldowns.filter(r => r.lost > 0);
  const rows = missed.map(r => {
    const sub = r.possible <= 1 ? 'not used' : a.pullSpans ? `used on ${r.usedPulls} of ${r.possible} pulls` : `${r.uses.length} of ${r.possible} uses`;
    const marks = back + r.idle.map(([x, y]) => box('idle', x, y, `Ready but unused ${mmss(x - f.start)}–${mmss(y - f.start)}`)).join('') +
      r.uses.map(u => box('use', u, u + r.dur * 1000, `${r.name} at ${mmss(u - f.start)}`)).join('');
    return `<div class="lbl"><b>${esc(r.name)}</b><span class="${r.lost ? 'warn' : ''}">${esc(sub)}</span></div><div class="track">${marks}</div>`;
  }).join('');
  const tracks = !missed.length ? '<p class="hint">Every cooldown was used when it came up.</p>' : rows + `<div class="axis"><span>0:00</span><span>${mmss(span / 2)}</span><span>${mmss(span)}</span></div>`;
  const note = !missed.length ? '' : `<span class="legend"><span><i style="background:var(--accent)"></i>Cooldown up</span><span><i style="background:repeating-linear-gradient(135deg,#d9644a99 0 3px,transparent 3px 6px)"></i>Ready but unused</span>${a.pullSpans ? '<span><i style="background:#ffffff22"></i>Pull</span>' : a.executeKnown ? '<span><i style="background:#c7802f44"></i>Execute phase</span>' : ''}</span>`;
  return { tracks, note };
}

// Execute phase: DPS and casts per minute before and under 20% (single fights where the boss's health is known).
export function executeView(a) {
  const x = a.execute;
  if (!x) return null;
  const summary = `Under 20% from ${mmss(x.start - a.fight.start)} for ${Math.round(x.sec)}s. Your DPS: ${fmt(x.dps[0])} before, ${fmt(x.dps[1])} under 20%.`;
  const pm = v => (Math.round(v * 10) / 10).toFixed(1);
  const table = '<tr><th>Ability</th><th class="n">Per minute before 20%</th><th class="n">Per minute under 20%</th></tr>' +
    x.rows.map(r => `<tr><td>${esc(r.name)}</td><td class="n">${pm(r.perMin[0])}</td><td class="n">${pm(r.perMin[1])}</td></tr>`).join('');
  return { summary, table };
}

export function statsHtml(a, s, ideal) {
  const cons = s && ideal ? ideal.simDps - s.simDps : null;
  const cells = [
    ['Your DPS', fmt(a.dps)],
    ['DPS in the sim', s ? fmt(s.simDps) : '…'],
    ['Possible gain', s ? (s.simDps > a.dps ? `+${fmt(s.simDps - a.dps)}` : 'at or above sim') : '…', 'gap'],
    ...(cons !== null && cons > 2 ? [['More from full consumables', `+${fmt(cons)}`, 'gap']] : []),
    a.isRun ? ['In combat', `${Math.round(a.dur / 60)} of ${Math.round((a.fight.end - a.fight.start) / 60000)} min, ${a.pulls} pulls`] : ['Fight length', `${Math.round(a.dur)}s`],
    ['Rotation', a.preset.replace('_', ' ')],
    ...(a.uptimes.flurry > 0 ? [['Flurry uptime', `${Math.round(a.uptimes.flurry * 100)}%`]] : []),
  ];
  return cells.map(([k, v, c]) => `<div class="stat ${c || ''}"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
}

// What the listed play tips don't cover, so the group adds up to "Possible gain" exactly (using the rounded numbers
// shown on the page).
export function restLine(play, gap) {
  if (!(gap > 0)) return '';
  const rest = Math.round(gap) - play.reduce((n, t) => n + (t.gain ? Math.round(t.gain) : 0), 0);
  if (rest < 1) return '';
  return `<li><span class="t">Everything else</span><span class="g">≈ +${fmt(rest)} DPS</span><div class="d">Small differences from the sim that are too small to list or have no DPS number (like Battle Shout uptime), plus a little sim randomness. With this line, the play tips add up to your possible gain.</div></li>`;
}

// Play tips first (they share "Possible gain"), then gear and consumables (on top of it).
export function tipsHtml(list, gap) {
  const links = t => t.links ? `<div class="src">Guide: ${t.links.map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`).join(' · ')}</div>` : '';
  const li = (t, i) => `<li${i ? '' : ' value="1"'}><span class="t">${esc(t.title)}</span>${t.gain ? `<span class="g">≈ +${fmt(t.gain)} DPS</span>` : ''}<div class="d">${esc(t.detail)}</div>${links(t)}</li>`;
  const play = list.filter(t => t.group !== 'gear').slice(0, 8), gear = list.filter(t => t.group === 'gear');
  const head = (title, note) => `<li class="grp"><b>${esc(title)}</b>${note ? `<span>${esc(note)}</span>` : ''}</li>`;
  return head('Play', gap > 0 ? `These share your possible gain (+${fmt(gap)}). Each is an estimate, and they overlap.` : '') +
    (play.length ? play.map(li).join('') : '<li>Nothing big stands out. Nice work. Push for longer uptime and cleaner cooldown timing.</li>') +
    restLine(play, gap) +
    (gear.length ? head('Gear and consumables', 'On top of your possible gain.') + gear.map(li).join('') : '');
}

export function tablesHtml(a, names) {
  const abil = '<tr><th>Ability</th><th class="n">Casts</th><th class="n">Damage</th><th class="n">%</th><th class="n">Crit</th></tr>' +
    a.abilities.filter(x => x.damage > 0 || x.casts > 0).map(x => `<tr><td>${esc(x.name)}</td><td class="n">${x.name === 'Melee' ? x.hits : x.casts}</td><td class="n">${fmt(x.damage)}</td><td class="n">${a.total ? ((x.damage / a.total) * 100).toFixed(1) : 0}</td><td class="n">${x.hits ? Math.round((x.crits / x.hits) * 100) + '%' : ''}</td></tr>`).join('');
  const gear = a.combatant?.items || [];
  const audit = new Map(auditEnchants(gear, names).map(e => [e.slot, e]));
  const enchCell = (it, si) => {
    const e = audit.get(si);
    const nm = it.enchant ? esc(shortEnchantName(names, it.enchant, si)) : '';
    if (!e || e.ok) return nm;
    return `<span class="warn">${nm || 'None'}</span>`;
  };
  const gearHtml = gear.length
    ? '<tr><th>Slot</th><th>Item</th><th>Enchant</th></tr>' + LOG_TO_SIM_SLOTS.map((li, si) => {
        const it = gear[li];
        if (!it || !it.id) return '';
        const n = names.items[it.id];
        const id = Number(it.id) || 0;
        return `<tr><td>${SLOT_NAMES[si]}</td><td>${n ? `<a href="https://www.wowhead.com/forever/item=${id}" target="_blank" rel="noopener">${esc(n[0])}</a>` : `#${id} <span class="warn">(not in sim)</span>`}</td><td>${enchCell(it, si)}</td></tr>`;
      }).join('')
    : '<tr><td class="warn">No gear in this log. Turn on Advanced Combat Logging.</td></tr>';
  return { abil, gear: gearHtml };
}

// The candidates left out for the hit cap, best guess first, one per slot.
export function underCapHtml(underCap, names) {
  const seen = new Set(), list = [];
  for (const c of underCap.sort((x, y) => (y.est ?? 0) - (x.est ?? 0))) {
    if (seen.has(c.slot)) continue;
    seen.add(c.slot);
    list.push(`${SLOT_NAMES[c.slot]}: ${names.items[c.id]?.[ITEM.NAME] || `#${c.id}`} (${c.miss.toFixed(1)}% under)`);
  }
  return list.length ? `<p class="hint">Left out (would drop you under the hit cap): ${esc(list.join('; '))}.</p>` : '';
}

// Price line for a crafted upgrade, from the chosen auction house.
export function priceLine(table, prices, key, id) {
  if (!isCrafted(table.items[id])) return '';
  const p = priceFor(prices, key, id);
  if (p === undefined || p === null) return '';
  const ah = p.listed ? `<div class="price" title="${p.listed} listed, median ${gold(p.median)}">AH from ${gold(p.min)}</div>` : '';
  if (p.materials === undefined) return ah;
  const list = materialsList(prices, id);
  const missing = p.unpriced ? ` <span class="src">+ ${p.unpriced} not on the AH</span>` : '';
  return ah + `<div class="price" title="${esc(list ? `Materials: ${list}` : '')}">Materials ${p.unpriced ? 'at least' : 'about'} ${gold(p.materials)}${missing}</div>`;
}

// m: {rows, gear, names, cands, setCost, underCap, prices, faction, table (upgrades.json), region, market}
export function upgradesHtml(m) {
  const { rows, gear, names, cands, setCost = new Map(), underCap = [], prices = null, faction, table: upgradeTable, region, market } = m;
  const key = houseKey(region, market, faction);
  const house = prices?.houses?.[key];
  const crafted = rows.some(r => isCrafted(upgradeTable.items[r.id]));
  const tags = id => [...(upgradeTable.items[id]?.[SRC.KINDS] || '')].map(k => KIND_TAG[k] ? `<span class="tag">${KIND_TAG[k]}</span>` : '').join('');
  const link = id => `<a href="https://www.wowhead.com/forever/item=${Number(id)}" target="_blank" rel="noopener">${esc(names.items[id]?.[ITEM.NAME] || `#${id}`)}</a>`;
  // First source, then "+N more" (a small fold) for the rest.
  const where = id => {
    const [first, ...rest] = String(upgradeTable.items[id]?.[SRC.WHERE] || '').split(' · ');
    return esc(first) + (rest.length ? `<details class="more"><summary>+${rest.length} more</summary>${esc(rest.join(' · '))}</details>` : '');
  };
  const found = new Set(rows.map(r => r.slot));
  const none = [...new Set(cands.map(c => c.slot))].filter(s => !found.has(s)).map(s => SLOT_NAMES[s]);
  return (rows.length
    ? '<table><tr><th>Slot</th><th>Upgrade</th><th class="n">DPS</th><th>Where to get it</th></tr>' + rows.map(r => {
        const cur = gear[r.slot]?.id;
        const cost = setCost.get(r.slot);
        const sets = (r.sets?.lost || []).map(x => `<div class="warn small">Breaks ${esc(x)}${cost ? `, worth about ${fmt(Math.max(0, cost.dps))} DPS (±${fmt(Z95 * cost.err)}). The gain already counts that loss.` : '. The gain already counts that loss.'}</div>`).join('') +
          (r.sets?.gained || []).map(x => `<div class="src">Completes ${esc(x)}</div>`).join('');
        return `<tr><td${cur ? ` title="Replaces ${esc(names.items[cur]?.[ITEM.NAME] || `#${cur}`)}"` : ''}>${SLOT_NAMES[r.slot]}</td><td>${link(r.id)}${tags(r.id)}${sets}</td><td class="n g">+${fmt(r.gain)}<span class="src"> ±${fmt(Z95 * r.err)}</span>${r.gain < Z95 * r.err ? '<div class="src">within sim noise</div>' : ''}</td><td class="src">${where(r.id)}${priceLine(upgradeTable, prices, key, r.id)}</td></tr>`;
      }).join('') + '</table>'
    : '<p>None of the likely upgrades beat your current gear in the sim.</p>') +
    (none.length ? `<p class="hint">No upgrade found: ${esc(none.join(', '))}.</p>` : '') +
    underCapHtml(underCap, names) +
    (crafted ? `<p class="hint">${house
      ? `Crafted prices: lowest ${region.toUpperCase()} ${MARKET_NAMES[market]} ${faction === 0 ? 'Horde' : 'Alliance'} AH buyout, updated ${age(house.updated)}. <a href="#how">How this works</a>`
      : prices ? 'No auction house prices for this realm type yet.' : 'Auction house prices could not be loaded.'}</p>` : '');
}

