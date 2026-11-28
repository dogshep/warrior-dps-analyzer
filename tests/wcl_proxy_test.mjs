// The page loads a report through the Worker when not signed in, and asks for sign-in when the Worker can't.
// Usage: node tests/wcl_proxy_test.mjs
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { loadReport, loadFight, hasProxy } = await import('../web/js/wcl.js');
const { AuthRequiredError } = await import('../web/js/errors.js');

const sent = [];
let reply = { status: 200, body: { data: { reportData: { report: { title: 'UBRS', fights: [], masterData: { actors: [], abilities: [] } } } } } };
const fetchImpl = async (url, opts) => {
  if (url === 'wcl-proxy.json') return { ok: true, json: async () => ({ url: 'https://w.example.workers.dev' }) };
  sent.push({ url, body: JSON.parse(opts.body), auth: opts.headers.Authorization });
  return { ok: reply.status === 200, status: reply.status, json: async () => reply.body };
};
assert.equal(await hasProxy(fetchImpl), true);
const rep = await loadReport('83cYV91DARnwWNaj', fetchImpl);
assert.equal(rep.title, 'UBRS');
assert.deepEqual(sent[0], { url: 'https://w.example.workers.dev', body: { op: 'report', variables: { code: '83cYV91DARnwWNaj' } }, auth: undefined });

reply = { status: 404, body: { error: 'You do not have permission to view this report.' } };
await assert.rejects(loadReport('AAAAAAAAAAAAAAAA', fetchImpl), e => e instanceof AuthRequiredError);

// Any other Worker failure is reported as it is, not as a sign-in problem.
reply = { status: 502, body: { error: 'Variable "$actor" is never used.' } };
await assert.rejects(loadReport('CCCCCCCCCCCCCCCC', fetchImpl), e => !(e instanceof AuthRequiredError) && /never used/.test(e.message));
reply = { status: 429, body: { error: 'rate limited' } };
await assert.rejects(loadReport('DDDDDDDDDDDDDDDD', fetchImpl), e => e instanceof AuthRequiredError && /quota/.test(e.message));

// A long fight: each events list pages on its own, gear comes from the first answer, and a second load is cached.
const pages = { mine: 3, onMe: 2, debuffs: 1, deaths: 1, info: 1 };
const asked = [];
const pagedFetch = async (url, opts) => {
  const { op, variables } = JSON.parse(opts.body);
  asked.push({ op, variables });
  const page = Math.floor((variables.start - 1000) / 1000);
  const ev = op === 'info'
    ? [{ timestamp: 1000, faction: 1, gear: [{ id: 19019, itemLevel: 80 }], auras: [] }]
    : op === 'deaths' ? [{ timestamp: 5000, targetID: 7 }] : [{ timestamp: variables.start, type: 'cast', sourceID: 7, targetID: 9, abilityGameID: 1 }];
  const next = op !== 'info' && page + 1 < pages[op] ? variables.start + 1000 : null;
  return { ok: true, status: 200, json: async () => ({ data: { reportData: { report: { [op]: { data: ev, nextPageTimestamp: next } } } } }) };
};
const report = { code: '83cYV91DARnwWNaj', abilities: new Map([[1, 'Melee']]), actors: [{ id: 7, name: 'W' }] };
const fight = { id: 3, start: 1000, end: 9000 };
const parsed = await loadFight(report, { id: 7 }, fight, pagedFetch);
const count = op => asked.filter(a => a.op === op).length;
assert.deepEqual(Object.fromEntries(Object.keys(pages).map(op => [op, count(op)])), pages);
assert.equal(parsed.players.get('7').casts.length, 3);
assert.deepEqual(parsed.players.get('7').deaths, [5000]);
assert.equal(parsed.combatants.get('7').items[0].id, 19019);
assert.equal(asked.find(a => a.op === 'deaths').variables.actor, undefined);
const n = asked.length;
assert.equal(await loadFight(report, { id: 7 }, fight, pagedFetch), parsed);
assert.equal(asked.length, n);
console.log('wcl proxy tests passed');
