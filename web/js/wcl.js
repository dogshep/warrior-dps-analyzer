// Loads a fight from a Warcraft Logs report link (forever.warcraftlogs.com) and turns its events into the same
// shape the combat log parser produces, so the analysis code is shared.
//
// Sign-in uses OAuth with PKCE, the flow for pages with no server: the page holds only a public client id, and
// each viewer signs in with their own Warcraft Logs account. The token stays in this browser's localStorage.

export const WCL_CLIENT_ID = '01a218c3-d235-70ca-8ae9-f6b8e8d40650'; // Public PKCE client, redirect https://dogshep.github.io/warrior-dps-analyzer/

const SITE = 'https://forever.warcraftlogs.com';
const AUTHORIZE = `${SITE}/oauth/authorize`;
const TOKEN = `${SITE}/oauth/token`;
// Forever's API docs give the Classic API address with Forever's own sign-in; the token decides the game.
// The Forever address is tried second.
const APIS = ['https://classic.warcraftlogs.com/api/v2/user', `${SITE}/api/v2/user`];

const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} },
};

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
  const exp = Number(store.get('wcl_token_expires') || 0);
  if (exp && Date.now() > exp) { store.del('wcl_token'); return null; }
  return store.get('wcl_token');
}

export function signOut() {
  store.del('wcl_token');
  store.del('wcl_token_expires');
}

// Sends the viewer to Warcraft Logs to sign in. `pending` (the pasted link) comes back after the redirect.
export async function signIn(pending) {
  const id = clientId();
  if (!id) throw new Error('This page has no Warcraft Logs client id yet.');
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const state = crypto.randomUUID();
  store.set('wcl_verifier', verifier);
  store.set('wcl_state', state);
  if (pending) store.set('wcl_pending', pending);
  const params = new URLSearchParams({
    client_id: id, response_type: 'code', redirect_uri: redirectUri(), state,
    code_challenge: await challenge(verifier), code_challenge_method: 'S256',
  });
  location.href = `${AUTHORIZE}?${params}`;
}

// Finishes sign-in when Warcraft Logs redirects back with ?code=. Returns the pending link, if any.
export async function finishSignIn() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code');
  if (!code) return null;
  history.replaceState(null, '', redirectUri());
  if (q.get('state') !== store.get('wcl_state')) throw new Error('Warcraft Logs sign-in did not match this page. Try again.');
  const body = new URLSearchParams({
    grant_type: 'authorization_code', client_id: clientId(), code, redirect_uri: redirectUri(),
    code_verifier: store.get('wcl_verifier') || '',
  });
  store.del('wcl_verifier');
  store.del('wcl_state');
  const res = await fetch(TOKEN, { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Warcraft Logs sign-in failed (${res.status}).`);
  store.set('wcl_token', data.access_token);
  // Expire a day early to be safe.
  store.set('wcl_token_expires', String(Date.now() + Math.max(3600, (data.expires_in || 86400 * 7) - 86400) * 1000));
  const pending = store.get('wcl_pending');
  store.del('wcl_pending');
  return pending;
}

let apiUrl = null;
async function gql(query, variables, fetchImpl = fetch) {
  const t = token();
  if (!t) { const e = new Error('Sign in to Warcraft Logs first.'); e.needsAuth = true; throw e; }
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

const REPORT_QUERY = `query($code: String!) { reportData { report(code: $code) {
  title startTime
  fights { id encounterID name startTime endTime kill }
  masterData { actors(type: "Player") { id name subType server } abilities { gameID name } }
} } }`;

const EVENTS_QUERY = `query($code: String!, $fight: Int!, $actor: Int!, $start: Float!, $end: Float!) { reportData { report(code: $code) {
  mine: events(fightIDs: [$fight], sourceID: $actor, startTime: $start, endTime: $end, includeResources: true, limit: 10000) { data nextPageTimestamp }
  onMe: events(fightIDs: [$fight], targetID: $actor, startTime: $start, endTime: $end, dataType: Buffs, limit: 10000) { data nextPageTimestamp }
  debuffs: events(fightIDs: [$fight], startTime: $start, endTime: $end, dataType: Debuffs, hostilityType: Enemies, limit: 10000) { data nextPageTimestamp }
  deaths: events(fightIDs: [$fight], startTime: $start, endTime: $end, dataType: Deaths, limit: 10000) { data nextPageTimestamp }
  info: events(fightIDs: [$fight], sourceID: $actor, startTime: $start, endTime: $end, dataType: CombatantInfo, limit: 100) { data }
} } }`;

const HIT_MISS = { 0: 'MISS', 7: 'DODGE', 8: 'PARRY', 10: 'IMMUNE', 14: 'RESIST' };

// Report metadata: warriors and fights, in the shapes the page's pickers use.
export async function loadReport(code, fetchImpl) {
  const r = (await gql(REPORT_QUERY, { code }, fetchImpl)).reportData.report;
  const warriors = r.masterData.actors.filter(a => a.subType === 'Warrior').map(a => ({ guid: String(a.id), id: a.id, name: a.name, hasGear: true }));
  const fights = r.fights.filter(f => f.endTime - f.startTime > 10000).map(f => ({
    id: f.id, kind: f.encounterID ? 'boss' : 'trash', name: f.name, start: f.startTime, end: f.endTime, success: !!f.kill,
  }));
  const abilities = new Map(r.masterData.abilities.map(a => [a.gameID, a.name]));
  return { code, title: r.title, warriors, fights, abilities, actors: r.masterData.actors };
}

// Pages through one events field until Warcraft Logs says there are no more.
async function allEvents(code, fight, actor, field, fetchImpl) {
  let start = fight.start, out = [];
  for (let page = 0; page < 30; page++) {
    const r = (await gql(EVENTS_QUERY, { code, fight: fight.id, actor, start, end: fight.end }, fetchImpl)).reportData.report;
    out = out.concat(r[field].data);
    if (!r[field].nextPageTimestamp) return { first: r, events: out };
    start = r[field].nextPageTimestamp;
  }
  return { events: out };
}

// Fetches one warrior's fight and returns a parser-shaped object for analyzeFight / buildRequest.
export async function loadFight(report, warrior, fight, fetchImpl) {
  const actor = warrior.id;
  const { first, events: mine } = await allEvents(report.code, fight, actor, 'mine', fetchImpl);
  const r = first;
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
  for (const e of r.onMe.data) {
    if (e.sourceID === actor) continue; // already in `mine`
    p.auras.push({ t: e.timestamp, ev: auraEv(e.type), spellId: e.abilityGameID, name: name(e.abilityGameID), src: String(e.sourceID) });
  }
  for (const e of r.debuffs.data) debuffs.push({ t: e.timestamp, ev: auraEv(e.type), spellId: e.abilityGameID, name: name(e.abilityGameID), src: String(e.sourceID), dst: String(e.targetID) });
  for (const e of r.deaths.data) if (e.targetID === actor) p.deaths.push(e.timestamp);

  const combatants = new Map();
  const info = r.info.data[0];
  if (info) {
    combatants.set(guid, {
      time: info.timestamp, guid, faction: info.faction,
      items: (info.gear || []).map(g => ({ id: g.id || 0, ilvl: g.itemLevel || 0, enchant: g.permanentEnchant || 0, tempEnchant: g.temporaryEnchant || 0 })),
      auras: (info.auras || []).map(a => a.ability),
    });
  }
  return { players: new Map([[guid, p]]), names, combatants, targetHp, debuffs, source: 'wcl' };
}

function auraEv(type) {
  if (type.startsWith('apply')) return type.endsWith('stack') ? 'APPLIED_DOSE' : 'APPLIED';
  if (type.startsWith('remove')) return 'REMOVED';
  return 'REFRESH';
}
