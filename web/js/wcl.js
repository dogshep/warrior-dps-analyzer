// Loads a fight from a Warcraft Logs report link (forever.warcraftlogs.com) and turns its events into the same
// shape the combat log parser produces, so the analysis code is shared.
//
// Public reports load with no sign-in through this site's Worker (see proxy() below). Otherwise, sign-in uses OAuth
// with PKCE, the flow for pages with no server: the page holds only a public client id, and each viewer signs in
// with their own Warcraft Logs account. The token stays in this tab's sessionStorage, not localStorage: every
// project site under dogshep.github.io shares one origin, and localStorage would hand it to all of them for a week.

export const WCL_CLIENT_ID = '01a218c3-d235-70ca-8ae9-f6b8e8d40650'; // Public PKCE client, redirect https://dogshep.github.io/warrior-dps-analyzer/

import { QUERIES, QUERY_VARS } from './wcl-queries.js';

const SITE = 'https://forever.warcraftlogs.com';
const AUTHORIZE = `${SITE}/oauth/authorize`;
const TOKEN = `${SITE}/oauth/token`;
// Forever's API docs give the Classic API address with Forever's own sign-in; the token decides the game.
// The Forever address is tried second.
const APIS = ['https://classic.warcraftlogs.com/api/v2/user', `${SITE}/api/v2/user`];

const storage = kind => ({
  get: k => { try { return globalThis[kind].getItem(k); } catch { return null; } },
  set: (k, v) => { try { globalThis[kind].setItem(k, v); } catch {} },
  del: k => { try { globalThis[kind].removeItem(k); } catch {} },
});
// Settings that are not secret (a custom client id) persist; sign-in state lasts only for this tab.
const store = storage('localStorage');
const session = storage('sessionStorage');
// Earlier versions kept the token and sign-in state in localStorage. Clear those out.
for (const k of ['wcl_token', 'wcl_token_expires', 'wcl_verifier', 'wcl_state', 'wcl_pending']) store.del(k);

// v2 API client ids are UUIDs. Anything else (a v1 key, say) is ignored so it can't shadow the site's client.
const isClientId = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');

export function clientId() {
  const own = store.get('wcl_client_id');
  return isClientId(own) ? own : WCL_CLIENT_ID;
}
// Returns false (and stores nothing) when `id` is not a v2 client id.
export function setClientId(id) {
  id = (id || '').trim();
  if (!id) { store.del('wcl_client_id'); return true; }
  if (!isClientId(id)) { store.del('wcl_client_id'); return false; }
  store.set('wcl_client_id', id);
  return true;
}

// "https://forever.warcraftlogs.com/reports/83cYV91DARnwWNaj?fight=1&source=5" -> {code, fight, source}
export function parseReportUrl(text) {
  const m = /reports\/([A-Za-z0-9]{16})/.exec(text || '') || /^\s*([A-Za-z0-9]{16})\s*$/.exec(text || '');
  if (!m) return null;
  const q = new URLSearchParams((/\?(.*)$/.exec(text) || [])[1] || '');
  const hash = new URLSearchParams((/#(.*)$/.exec(text) || [])[1] || '');
  const fight = q.get('fight') || hash.get('fight');
  const source = q.get('source') || hash.get('source');
  return { code: m[1], fight: fight && fight !== 'last' ? Number(fight) : fight, source: source ? Number(source) : null };
}

function redirectUri() {
  return location.origin + location.pathname;
}

async function challenge(verifier) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function token() {
  const exp = Number(session.get('wcl_token_expires') || 0);
  if (exp && Date.now() > exp) { signOut(); return null; }
  return session.get('wcl_token');
}

export function signOut() {
  session.del('wcl_token');
  session.del('wcl_token_expires');
}

// Sends the viewer to Warcraft Logs to sign in. `pending` (the pasted link) comes back after the redirect.
export async function signIn(pending) {
  const id = clientId();
  if (!id) throw new Error('This page has no Warcraft Logs client id yet.');
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const state = crypto.randomUUID();
  session.set('wcl_verifier', verifier);
  session.set('wcl_state', state);
  if (pending) session.set('wcl_pending', pending); else session.del('wcl_pending');
  const params = new URLSearchParams({
    client_id: id, response_type: 'code', redirect_uri: redirectUri(), state,
    code_challenge: await challenge(verifier), code_challenge_method: 'S256',
  });
  location.href = `${AUTHORIZE}?${params}`;
}

// Finishes sign-in when Warcraft Logs redirects back with ?code= (or ?error=). Returns the pending link, if any.
export async function finishSignIn() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code'), error = q.get('error');
  if (!code && !error) return null;
  history.replaceState(null, '', redirectUri());
  // Read and clear the sign-in state first, so it can be used only once.
  const state = session.get('wcl_state'), verifier = session.get('wcl_verifier'), pending = session.get('wcl_pending');
  for (const k of ['wcl_state', 'wcl_verifier', 'wcl_pending']) session.del(k);
  // The state must match one this tab started; a link someone else made has none (or the wrong one).
  if (!state || !verifier || q.get('state') !== state) throw new Error('Warcraft Logs sign-in did not match this page. Try again.');
  if (error) throw new Error(error === 'access_denied' ? 'Warcraft Logs sign-in was cancelled.' : 'Warcraft Logs sign-in failed. Try again.');
  const body = new URLSearchParams({
    grant_type: 'authorization_code', client_id: clientId(), code, redirect_uri: redirectUri(), code_verifier: verifier,
  });
  const res = await fetch(TOKEN, { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Warcraft Logs sign-in failed (${res.status}).`);
  session.set('wcl_token', data.access_token);
  // Expire a day early to be safe.
  session.set('wcl_token_expires', String(Date.now() + Math.max(3600, (data.expires_in || 86400 * 7) - 86400) * 1000));
  return pending;
}

// Without a sign-in, public reports load through this site's Worker (worker/), which holds a Warcraft Logs
// client secret. Its address is written to wcl-proxy.json at deploy time; no file means sign-in only.
let proxyUrl;
export async function hasProxy(fetchImpl = fetch) { return !!(await proxy(fetchImpl)); }
async function proxy(fetchImpl = fetch) {
  if (proxyUrl === undefined) {
    proxyUrl = null;
    try { const r = await fetchImpl('wcl-proxy.json'); if (r.ok) proxyUrl = (await r.json()).url || null; } catch {}
  }
  return proxyUrl;
}

async function viaProxy(url, op, variables, fetchImpl) {
  const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, variables }) });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.data?.reportData?.report) return data.data;
  // Private reports (and an exhausted shared quota) need the viewer's own sign-in.
  const e = new Error(res.status === 429 ? 'The shared Warcraft Logs quota is used up for now. Sign in to use your own.' : 'This report needs a Warcraft Logs sign-in (it may be private).');
  e.needsAuth = true;
  throw e;
}

let apiUrl = null;
async function gql(op, variables, fetchImpl = fetch) {
  const query = QUERIES[op];
  const t = token();
  if (!t) {
    const url = await proxy(fetchImpl);
    if (url) return viaProxy(url, op, variables, fetchImpl);
    const e = new Error('Sign in to Warcraft Logs first.'); e.needsAuth = true; throw e;
  }
  const urls = apiUrl ? [apiUrl] : APIS;
  let lastErr;
  for (const url of urls) {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ query, variables }) });
    if (res.status === 401) { signOut(); const e = new Error('Your Warcraft Logs sign-in expired. Sign in again.'); e.needsAuth = true; throw e; }
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.data && !data.errors && (!variables?.code || data.data.reportData?.report)) { apiUrl = url; return data.data; }
    lastErr = new Error(data.errors?.[0]?.message || `Warcraft Logs answered ${res.status}.`);
  }
  throw lastErr;
}

const HIT_MISS = { 0: 'MISS', 7: 'DODGE', 8: 'PARRY', 10: 'IMMUNE', 14: 'RESIST' };

// Report metadata: warriors and fights, in the shapes the page's pickers use.
export async function loadReport(code, fetchImpl) {
  const r = (await gql('report', { code }, fetchImpl)).reportData.report;
  const warriors = r.masterData.actors.filter(a => a.subType === 'Warrior').map(a => ({ guid: String(a.id), id: a.id, name: a.name, hasGear: true }));
  const fights = r.fights.filter(f => f.endTime - f.startTime > 10000).map(f => ({
    id: f.id, kind: f.encounterID ? 'boss' : 'trash', name: f.name, start: f.startTime, end: f.endTime, success: !!f.kill,
  }));
  const abilities = new Map(r.masterData.abilities.map(a => [a.gameID, a.name]));
  return { code, title: r.title, warriors, fights, abilities, actors: r.masterData.actors };
}

// Only the variables a query declares (GraphQL refuses extras, and so does the Worker).
const varsFor = (op, v) => Object.fromEntries(QUERY_VARS[op].map(k => [k, v[k]]));

// Most pages one events list follows before giving up. 50 pages is 500,000 events.
const MAX_PAGES = 50;

// Pages through one events list until Warcraft Logs says there are no more.
async function allEvents(op, vars, fetchImpl, maxPages = MAX_PAGES) {
  let start = vars.start;
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const list = (await gql(op, varsFor(op, { ...vars, start }), fetchImpl)).reportData.report[op];
    for (const e of list.data) out.push(e);
    const next = list.nextPageTimestamp;
    if (!next || next <= start) return out;
    start = next;
  }
  if (maxPages === MAX_PAGES) console.warn(`Warcraft Logs: stopped ${op} after ${maxPages} pages; the rest of the fight is left out.`);
  return out;
}

// Fights already downloaded this visit, so pressing Analyze again doesn't fetch them again.
const fightCache = new Map();
const FIGHT_CACHE_SIZE = 8;

// Fetches one warrior's fight and returns a parser-shaped object for analyzeFight / buildRequest.
export async function loadFight(report, warrior, fight, fetchImpl) {
  const key = `${report.code}|${warrior.id}|${fight.id}|${fight.start}|${fight.end}`;
  if (!fightCache.has(key)) {
    const p = fetchFight(report, warrior, fight, fetchImpl);
    fightCache.set(key, p);
    p.catch(() => fightCache.delete(key));
    if (fightCache.size > FIGHT_CACHE_SIZE) fightCache.delete(fightCache.keys().next().value);
  }
  return fightCache.get(key);
}

async function fetchFight(report, warrior, fight, fetchImpl) {
  const actor = warrior.id;
  const vars = { code: report.code, fight: fight.id, actor, start: fight.start, end: fight.end };
  // The lists are independent, so they download side by side.
  const [mine, onMe, debuffList, deaths, info] = await Promise.all([
    allEvents('mine', vars, fetchImpl),
    allEvents('onMe', vars, fetchImpl),
    allEvents('debuffs', vars, fetchImpl),
    allEvents('deaths', vars, fetchImpl),
    allEvents('info', vars, fetchImpl, 1),
  ]);
  const name = id => report.abilities.get(id) || `Spell ${id}`;
  const guid = String(actor);

  const p = { guid, casts: [], damage: [], misses: [], auras: [], rage: [], targets: new Map(), deaths: [], isWarrior: true };
  const names = new Map(report.actors.map(a => [String(a.id), a.name]));
  const targetHp = new Map();
  const debuffs = [];

  for (const e of mine) {
    const t = e.timestamp, dst = String(e.targetID ?? '');
    // `mine` holds every event that involves the warrior, including heals and buffs others cast on them.
    // Resources belong to the source (resourceActor 1) or the target (2); keep only the warrior's own rage.
    const res = (e.classResources || []).find(c => c.type === 1);
    const resOwner = e.resourceActor === 2 ? e.targetID : e.sourceID;
    if (res && resOwner === actor) p.rage.push([t, res.max >= 1000 ? res.amount / 10 : res.amount]);
    if (e.resourceActor === 2 && e.maxHitPoints && e.targetID !== actor) {
      let arr = targetHp.get(dst);
      if (!arr) targetHp.set(dst, (arr = []));
      arr.push([t, e.hitPoints / e.maxHitPoints]);
    }
    if (e.sourceID !== actor) continue;
    if (e.type === 'cast') p.casts.push({ t, spellId: e.abilityGameID, name: name(e.abilityGameID), dst });
    else if (e.type === 'damage') {
      if (HIT_MISS[e.hitType] !== undefined && !e.amount) { p.misses.push({ t, spellId: e.abilityGameID, name: e.abilityGameID === 1 ? 'Melee' : name(e.abilityGameID), type: HIT_MISS[e.hitType], dst }); continue; }
      const amount = (e.amount || 0) + (e.absorbed || 0);
      p.damage.push({ t, spellId: e.abilityGameID, name: e.abilityGameID === 1 ? 'Melee' : name(e.abilityGameID), amount, crit: e.hitType === 2 || e.hitType === 5, glancing: e.hitType === 6, offhand: false, dst, periodic: !!e.tick });
      p.targets.set(dst, (p.targets.get(dst) || 0) + amount);
    } else if (/^(apply|remove|refresh)buff/.test(e.type) && e.targetID === actor) {
      p.auras.push({ t, ev: auraEv(e.type), spellId: e.abilityGameID, name: name(e.abilityGameID), src: guid });
    }
  }
  for (const e of onMe) {
    if (e.sourceID === actor) continue; // already in `mine`
    p.auras.push({ t: e.timestamp, ev: auraEv(e.type), spellId: e.abilityGameID, name: name(e.abilityGameID), src: String(e.sourceID) });
  }
  for (const e of debuffList) debuffs.push({ t: e.timestamp, ev: auraEv(e.type), spellId: e.abilityGameID, name: name(e.abilityGameID), src: String(e.sourceID), dst: String(e.targetID) });
  for (const e of deaths) if (e.targetID === actor) p.deaths.push(e.timestamp);

  const combatants = new Map();
  const first = info[0];
  if (first) {
    combatants.set(guid, {
      time: first.timestamp, guid, faction: first.faction,
      items: (first.gear || []).map(g => ({ id: Number(g.id) || 0, ilvl: Number(g.itemLevel) || 0, enchant: Number(g.permanentEnchant) || 0, tempEnchant: Number(g.temporaryEnchant) || 0 })),
      auras: (first.auras || []).map(a => a.ability),
    });
  }
  return { players: new Map([[guid, p]]), names, combatants, targetHp, debuffs, source: 'wcl' };
}

function auraEv(type) {
  if (type.startsWith('apply')) return type.endsWith('stack') ? 'APPLIED_DOSE' : 'APPLIED';
  if (type.startsWith('remove')) return 'REMOVED';
  return 'REFRESH';
}
