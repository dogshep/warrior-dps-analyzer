// Parses a WoW combat log (WoWCombatLog-*.txt) into per-player, per-fight data for warriors.
// Works in the browser (streaming a File) and in Node (from a string), and keeps only what the analyzer needs.

const SPELL_PREFIX = ['SPELL_', 'RANGE_'];
const ADV_FIELDS = 17;

// Splits one line's CSV payload into tokens, keeping quoted strings and (...)/[...] groups intact.
export function splitTop(s) {
  const out = [];
  let depth = 0, inQ = false, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) { if (c === '"') inQ = false; continue; }
    if (c === '"') inQ = true;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}

// Parses a (...) or [...] group into nested arrays of strings/numbers.
export function parseGroup(s) {
  s = s.trim();
  if ((s[0] === '(' && s.at(-1) === ')') || (s[0] === '[' && s.at(-1) === ']')) {
    const inner = s.slice(1, -1);
    if (!inner.trim()) return [];
    return splitTop(inner).map(parseGroup);
  }
  if (s[0] === '"') return s.slice(1, -1);
  const n = Number(s);
  return s !== '' && !Number.isNaN(n) ? n : s;
}

const unq = s => (s && s[0] === '"' ? s.slice(1, -1) : s);

// "11/26 20:14:55.123" or "11/26/2026 20:14:55.1234-5" -> ms since an arbitrary epoch (same day math is all we need).
function parseTime(ts) {
  const m = /^(\d+)\/(\d+)(?:\/(\d+))?\s+(\d+):(\d+):(\d+)\.(\d+)/.exec(ts);
  if (!m) return NaN;
  const year = m[3] ? Number(m[3]) : 2000;
  const frac = Number(('0.' + m[7]));
  return Date.UTC(year, Number(m[1]) - 1, Number(m[2]), Number(m[4]), Number(m[5]), Number(m[6])) + frac * 1000;
}

const isFlag = t => t === 'nil' || t === '1' || t === '0';

// Finds critical/glancing/crushing flags at the end of a damage suffix. Returns the index of `critical`.
function critIndex(tok) {
  for (let i = tok.length - 3; i >= 0; i--) {
    if (isFlag(tok[i]) && isFlag(tok[i + 1]) && isFlag(tok[i + 2])) {
      // A trailing isOffHand flag would make a 4-flag run; the crit flag is the first of the last 3 or 4.
      if (i + 3 === tok.length || (i + 4 === tok.length && isFlag(tok[i + 3]))) return i;
    }
  }
  return -1;
}

export class LogParser {
  constructor() {
    this.header = {};
    this.advanced = null; // unknown until the header or a line tells us
    this.names = new Map(); // guid -> name
    this.combatants = new Map(); // guid -> COMBATANT_INFO (latest)
    this.encounters = []; // {name, id, start, end, success}
    this.openEncounter = null;
    this.players = new Map(); // guid -> per-player event store
    this.unitDeaths = [];
    this.firstTime = NaN;
    this.lastTime = NaN;
    this.lines = 0;
  }

  player(guid) {
    let p = this.players.get(guid);
    if (!p) {
      p = { guid, casts: [], damage: [], misses: [], auras: [], rage: [], targets: new Map(), deaths: [], isWarrior: false };
      this.players.set(guid, p);
    }
    return p;
  }

  feedLine(line) {
    if (!line) return;
    this.lines++;
    const sp = line.indexOf('  ');
    if (sp < 0) return;
    const t = parseTime(line.slice(0, sp));
    if (Number.isNaN(t)) return;
    if (Number.isNaN(this.firstTime)) this.firstTime = t;
    this.lastTime = t;
    const payload = line.slice(sp + 2);
    const comma = payload.indexOf(',');
    const ev = comma < 0 ? payload : payload.slice(0, comma);

    if (ev === 'COMBAT_LOG_VERSION') {
      const tok = splitTop(payload);
      for (let i = 0; i + 1 < tok.length; i += 2) this.header[tok[i]] = tok[i + 1];
      if ('ADVANCED_LOG_ENABLED' in this.header) this.advanced = this.header.ADVANCED_LOG_ENABLED === '1';
      return;
    }
    if (ev === 'COMBATANT_INFO') { this.onCombatant(t, payload); return; }
    if (ev === 'ENCOUNTER_START') {
      const tok = splitTop(payload);
      this.openEncounter = { id: Number(tok[1]), name: unq(tok[2]), difficulty: Number(tok[3]), size: Number(tok[4]), start: t, end: NaN, success: false };
      this.encounters.push(this.openEncounter);
      return;
    }
    if (ev === 'ENCOUNTER_END') {
      const tok = splitTop(payload);
      const enc = this.openEncounter && this.openEncounter.id === Number(tok[1]) ? this.openEncounter : this.encounters.findLast(e => e.id === Number(tok[1]) && Number.isNaN(e.end));
      if (enc) { enc.end = t; enc.success = tok[5] === '1'; }
      this.openEncounter = null;
      return;
    }
    if (!/^(SWING_|SPELL_|RANGE_|UNIT_DIED)/.test(ev)) return;
    this.onCombatEvent(t, ev, splitTop(payload));
  }

  onCombatant(t, payload) {
    const tok = splitTop(payload);
    const guid = tok[1];
    const groups = tok.map((x, i) => [i, x]).filter(([, x]) => x[0] === '[' || x[0] === '(');
    let items = null, auras = [], talents = null;
    for (const [, g] of groups) {
      const v = parseGroup(g);
      if (!Array.isArray(v)) continue;
      // The equipment list: an array of tuples whose first entry is an item id and second its item level.
      if (!items && v.length >= 15 && v.every(e => Array.isArray(e) && typeof e[0] === 'number')) { items = v; continue; }
      // Auras: alternating caster guid and spell id (optionally a stack count).
      if (items && v.some(e => typeof e === 'string' && /^(Player|Creature|Pet|0000)/.test(e))) {
        for (let i = 0; i < v.length; i++) if (typeof v[i] === 'string' && typeof v[i + 1] === 'number') auras.push(v[i + 1]);
        continue;
      }
      if (!items && !talents) talents = v;
    }
    const stats = tok.slice(2, 27).map(Number);
    this.combatants.set(guid, {
      time: t, guid, faction: Number(tok[2]),
      stats: { str: stats[1], agi: stats[2], sta: stats[3], int: stats[4], spi: stats[5] },
      items: (items || []).map(e => ({ id: e[0], ilvl: e[1], enchant: Array.isArray(e[2]) ? (e[2][0] || 0) : 0, tempEnchant: Array.isArray(e[2]) ? (e[2][1] || 0) : 0 })),
      auras, talentsRaw: talents,
    });
    this.player(guid);
  }

  onCombatEvent(t, ev, tok) {
    const src = tok[1], srcName = unq(tok[2]), dst = tok[5], dstName = unq(tok[6]);
    if (src && src !== '0000000000000000' && srcName !== 'nil') this.names.set(src, srcName);
    if (dst && dst !== '0000000000000000' && dstName !== 'nil') this.names.set(dst, dstName);

    if (ev === 'UNIT_DIED') {
      this.unitDeaths.push({ t, guid: dst });
      if (this.players.has(dst)) this.players.get(dst).deaths.push(t);
      return;
    }

    const isSwing = ev.startsWith('SWING_');
    const isSpell = SPELL_PREFIX.some(p => ev.startsWith(p));
    const prefixEnd = isSwing ? 9 : isSpell ? 12 : 9;
    const spellId = isSpell ? Number(tok[9]) : 0;
    const spellName = isSpell ? unq(tok[10]) : 'Melee';

    // Advanced params follow the prefix for cast success and damage events.
    const hasAdv = this.advanced !== false && /_(DAMAGE|CAST_SUCCESS|HEAL|ENERGIZE|DRAIN|LEECH)$/.test(ev) && tok.length >= prefixEnd + ADV_FIELDS;
    if (hasAdv) {
      const a = tok.slice(prefixEnd, prefixEnd + ADV_FIELDS);
      // a: infoGUID, ownerGUID, curHP, maxHP, AP, SP, armor, absorb, powerType, curPower, maxPower, powerCost, x, y, mapID, facing, level
      if (a[0] && a[0].startsWith('Player-') && this.players.has(a[0])) {
        const pt = String(a[8]).split('|');
        const cp = String(a[9]).split('|');
        const mp = String(a[10]).split('|');
        const ri = pt.indexOf('1');
        if (ri >= 0) {
          let cur = Number(cp[ri]), max = Number(mp[ri]);
          if (max >= 1000) { cur /= 10; max /= 10; }
          this.players.get(a[0]).rage.push([t, cur]);
          this.players.get(a[0]).isWarrior = true;
        }
      } else if (a[0] && a[0] === dst && Number(a[3]) > 0) {
        // Target health, for execute phase detection.
        this.targetHp ??= new Map();
        let arr = this.targetHp.get(dst);
        if (!arr) this.targetHp.set(dst, (arr = []));
        arr.push([t, Number(a[2]) / Number(a[3])]);
      }
    }

    const srcIsPlayer = src && src.startsWith('Player-');
    if (!srcIsPlayer) {
      // Auras applied to players by others still matter (buffs).
      if (dst && dst.startsWith('Player-') && /^SPELL_AURA_(APPLIED|REMOVED|REFRESH)/.test(ev)) {
        this.player(dst).auras.push({ t, ev: ev.slice(11), spellId, name: spellName, src });
      }
      return;
    }
    const p = this.player(src);

    if (ev === 'SPELL_CAST_SUCCESS') {
      p.casts.push({ t, spellId, name: spellName, dst });
    } else if (ev.endsWith('_DAMAGE') && !ev.endsWith('_DAMAGE_LANDED') && ev !== 'SPELL_PERIODIC_DAMAGE_SUPPORT') {
      const sufStart = prefixEnd + (hasAdv ? ADV_FIELDS : 0);
      const amount = Number(tok[sufStart]);
      const ci = critIndex(tok);
      const crit = ci >= 0 && tok[ci] === '1';
      const glancing = ci >= 0 && tok[ci + 1] === '1';
      const offhand = isSwing && ci >= 0 && tok[ci + 3] === '1';
      if (!Number.isNaN(amount)) {
        p.damage.push({ t, spellId, name: spellName, amount, crit, glancing, offhand, dst, periodic: ev.includes('PERIODIC') });
        p.targets.set(dst, (p.targets.get(dst) || 0) + amount);
      }
    } else if (ev.endsWith('_MISSED')) {
      // _MISSED events carry no advanced params: the miss type follows the prefix directly.
      const missType = tok[prefixEnd];
      p.misses.push({ t, spellId, name: spellName, type: unq(missType), dst });
    } else if (/^SPELL_AURA_(APPLIED|REMOVED|REFRESH|APPLIED_DOSE)/.test(ev)) {
      if (dst === src) p.auras.push({ t, ev: ev.slice(11), spellId, name: spellName, src });
      else if (dst && dst.startsWith('Player-')) this.player(dst).auras.push({ t, ev: ev.slice(11), spellId, name: spellName, src });
      else {
        this.debuffs ??= [];
        this.debuffs.push({ t, ev: ev.slice(11), spellId, name: spellName, src, dst });
      }
    }
  }

  // Splits the log into fights: encounters first, then trash pulls (player damage with gaps over 15s).
  fights(guid) {
    const p = this.players.get(guid);
    if (!p) return [];
    const out = this.encounters.filter(e => !Number.isNaN(e.end)).map(e => ({ kind: 'boss', name: e.name, start: e.start, end: e.end, success: e.success }));
    const inEnc = t => out.some(f => t >= f.start && t <= f.end);
    const dmg = p.damage.filter(d => !inEnc(d.t));
    let cur = null;
    const trash = [];
    for (const d of dmg) {
      if (!cur || d.t - cur.end > 15000) { cur = { kind: 'trash', start: d.t, end: d.t, dmg: 0 }; trash.push(cur); }
      cur.end = d.t; cur.dmg += d.amount;
    }
    for (const f of trash) {
      if (f.end - f.start < 10000) continue;
      const names = new Map();
      for (const d of dmg) if (d.t >= f.start && d.t <= f.end) names.set(this.names.get(d.dst) || '?', 1);
      f.name = [...names.keys()].slice(0, 3).join(', ') + (names.size > 3 ? ` +${names.size - 3}` : '');
      out.push(f);
    }
    return out.sort((a, b) => a.start - b.start);
  }

  warriors() {
    // Warriors: players with rage in advanced data, or who cast warrior-only abilities.
    const warriorSpells = /^(Bloodthirst|Mortal Strike|Heroic Strike|Whirlwind|Execute|Battle Shout|Bloodrage|Sunder Armor|Overpower|Cleave|Slam|Berserker Rage|Death Wish|Recklessness|Shield Slam|Revenge)$/;
    const res = [];
    for (const p of this.players.values()) {
      if (!p.isWarrior) p.isWarrior = p.casts.some(c => warriorSpells.test(c.name));
      if (p.isWarrior && (p.damage.length || this.combatants.has(p.guid))) {
        res.push({ guid: p.guid, name: this.names.get(p.guid) || p.guid, damage: p.damage.reduce((s, d) => s + d.amount, 0), hasGear: this.combatants.has(p.guid) });
      }
    }
    return res.sort((a, b) => b.damage - a.damage);
  }
}

export function parseText(text) {
  const p = new LogParser();
  let start = 0;
  while (start < text.length) {
    let nl = text.indexOf('\n', start);
    if (nl < 0) nl = text.length;
    let line = text.slice(start, nl);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    p.feedLine(line);
    start = nl + 1;
  }
  return p;
}

// Streams a browser File line by line so a large log never sits in memory as one string.
export async function parseFile(file, onProgress) {
  const p = new LogParser();
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let rest = '', read = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    read += value.length;
    const chunk = rest + value;
    const lines = chunk.split('\n');
    rest = lines.pop();
    for (const l of lines) p.feedLine(l.endsWith('\r') ? l.slice(0, -1) : l);
    onProgress && onProgress(Math.min(1, read / file.size));
  }
  if (rest) p.feedLine(rest);
  return p;
}
