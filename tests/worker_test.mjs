// Unit checks for the no-sign-in Worker with Warcraft Logs and Cloudflare's cache mocked. Usage: node tests/worker_test.mjs
import assert from 'node:assert/strict';

const calls = [];
let reportReply = { data: { reportData: { report: { title: 'UBRS' } } } };
let status = 200;
globalThis.fetch = async (url, opts) => {
  calls.push({ url, opts });
  if (url.endsWith('/oauth/token')) {
    assert.equal(opts.headers.Authorization, 'Basic ' + btoa('id:secret'));
    return new Response(JSON.stringify({ access_token: 'T', expires_in: 3600 }), { status: 200 });
  }
  assert.equal(opts.headers.Authorization, 'Bearer T');
  return new Response(JSON.stringify(reportReply), { status });
};
const store = new Map();
globalThis.caches = { default: { match: async k => store.get(k.url)?.clone(), put: async (k, r) => { store.set(k.url, new Response(await r.arrayBuffer(), r)); }, delete: async k => store.delete(k.url) } };

const { default: worker } = await import('../worker/index.js');
const env = { WCL_CLIENT_ID: 'id', WCL_CLIENT_SECRET: 'secret', ALLOWED_ORIGINS: 'https://dogshep.github.io' };
const waits = [];
const ctx = { waitUntil: p => waits.push(p) };
const settle = () => Promise.all(waits.splice(0));
const req = (body, origin = 'https://dogshep.github.io') => new Request('https://w.dev/', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let r = await worker.fetch(req({ op: 'report', variables: { code: '83cYV91DARnwWNaj' } }), env, ctx);
assert.equal(r.status, 200);
assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://dogshep.github.io');
assert.equal(r.headers.get('X-Cache'), 'miss');
assert.equal(r.headers.get('Access-Control-Expose-Headers'), 'X-Cache');
assert.equal((await r.json()).data.reportData.report.title, 'UBRS');
await settle();
const sent = JSON.parse(calls.find(c => c.url.includes('/api/v2/client')).opts.body);
assert.match(sent.query, /masterData/);

// Second identical request comes from the cache, no new API call.
const before = calls.length;
r = await worker.fetch(req({ op: 'report', variables: { code: '83cYV91DARnwWNaj' } }), env, ctx);
assert.equal(r.status, 200);
assert.equal(r.headers.get('X-Cache'), 'hit');
assert.equal(calls.length, before);

// Arbitrary queries, bad codes and other origins are refused.
assert.equal((await worker.fetch(req({ op: 'whatever', query: '{ userData { currentUser { id } } }', variables: { code: '83cYV91DARnwWNaj' } }), env, ctx)).status, 400);
assert.equal((await worker.fetch(req({ op: 'report', variables: { code: 'x' } }), env, ctx)).status, 400);
assert.equal((await worker.fetch(req({ op: 'mine', variables: { code: '83cYV91DARnwWNaj', fight: 1 } }), env, ctx)).status, 400);
assert.equal((await worker.fetch(req({ op: 'constructor', variables: { code: '83cYV91DARnwWNaj' } }), env, ctx)).status, 400);
// Numbers must be whole and in range, so requests can't be varied endlessly to dodge the cache.
const ev = { code: '83cYV91DARnwWNaj', fight: 1, actor: 7, start: 1000, end: 61000 };
for (const bad of [{ start: 1000.5 }, { start: -1 }, { start: 70000 }, { end: 1e12 }, { fight: 1.5 }, { extra: 1 }])
  assert.equal((await worker.fetch(req({ op: 'mine', variables: { ...ev, ...bad } }), env, ctx)).status, 400, JSON.stringify(bad));
// Queries that don't take an actor refuse one.
assert.equal((await worker.fetch(req({ op: 'deaths', variables: ev }), env, ctx)).status, 400);
reportReply = { data: { reportData: { report: { mine: { data: [{ timestamp: 1 }], nextPageTimestamp: null } } } } };
r = await worker.fetch(req({ op: 'mine', variables: ev }), env, ctx);
assert.equal(r.status, 200);
assert.equal((await r.json()).data.reportData.report.mine.data.length, 1);
await settle();
const { actor, ...noActor } = ev;
assert.equal((await worker.fetch(req({ op: 'deaths', variables: noActor }), env, ctx)).status, 200);
assert.equal((await worker.fetch(req({ op: 'report', variables: { code: '83cYV91DARnwWNaj' } }, 'https://evil.example'), env, ctx)).status, 403);

// A private report: both API addresses return no report, so the page is told to sign in (404).
reportReply = { data: { reportData: { report: null } }, errors: [{ message: 'You do not have permission to view this report.' }] };
r = await worker.fetch(req({ op: 'report', variables: { code: 'AAAAAAAAAAAAAAAA' } }), env, ctx);
assert.equal(r.status, 404);
assert.match((await r.json()).error, /permission/);
// Both addresses were asked, and the failure is cached briefly.
let n = calls.length;
r = await worker.fetch(req({ op: 'report', variables: { code: 'AAAAAAAAAAAAAAAA' } }), env, ctx);
assert.equal(r.status, 404);
assert.equal(r.headers.get('X-Cache'), 'hit');
assert.equal(calls.length, n);

// A query error (not a missing report) isn't retried on the second address.
reportReply = { errors: [{ message: 'Variable "$start" got invalid value' }] };
n = calls.length;
r = await worker.fetch(req({ op: 'report', variables: { code: 'BBBBBBBBBBBBBBBB' } }), env, ctx);
// It's a 502, not a 404, so the page doesn't tell the viewer the report is private.
assert.equal(r.status, 502);
assert.equal(calls.length, n + 1);

// An expired token is replaced and the request retried once.
reportReply = { data: { reportData: { report: { title: 'Retry' } } } };
let first = true;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => { if (first && url.includes('/api/v2/client')) { first = false; calls.push({ url }); return new Response('{}', { status: 401 }); } return realFetch(url, opts); };
r = await worker.fetch(req({ op: 'report', variables: { code: 'CCCCCCCCCCCCCCCC' } }), env, ctx);
assert.equal(r.status, 200);
assert.equal((await r.json()).data.reportData.report.title, 'Retry');
globalThis.fetch = realFetch;

// The per-IP limit applies to cache misses only.
let allowed = 0;
const limited = { ...env, LIMITER: { limit: async ({ key }) => { assert.equal(key, '1.2.3.4'); return { success: allowed-- > 0 }; } } };
const reqIp = body => { const q = req(body); q.headers.set('CF-Connecting-IP', '1.2.3.4'); return q; };
r = await worker.fetch(reqIp({ op: 'report', variables: { code: 'DDDDDDDDDDDDDDDD' } }), limited, ctx);
assert.equal(r.status, 429);
r = await worker.fetch(reqIp({ op: 'report', variables: { code: '83cYV91DARnwWNaj' } }), limited, ctx);
assert.equal(r.status, 200);
assert.equal(r.headers.get('X-Cache'), 'hit');
await settle();

// A big events page (about 5 MB, arriving in 64 KB pieces) is streamed to the page and the cache unchanged.
const big = JSON.stringify({ data: { reportData: { report: { mine: { data: Array.from({ length: 40000 }, (_, i) => ({ timestamp: i, type: 'damage', sourceID: 7, targetID: 99, abilityGameID: 23894, amount: 512, classResources: [{ amount: 450, max: 1000, type: 1 }] })), nextPageTimestamp: null } } } } });
const chunked = text => { const bytes = new TextEncoder().encode(text); let i = 0; return new ReadableStream({ pull(c) { if (i >= bytes.length) return c.close(); c.enqueue(bytes.slice(i, i += 65536)); } }); };
globalThis.fetch = async url => url.endsWith('/oauth/token') ? new Response(JSON.stringify({ access_token: 'T', expires_in: 3600 })) : new Response(chunked(big), { status: 200 });
const bigEv = { ...ev, fight: 42 };
r = await worker.fetch(req({ op: 'mine', variables: bigEv }), env, ctx);
assert.equal(r.status, 200);
assert.equal(await r.text(), big);
await settle();
r = await worker.fetch(req({ op: 'mine', variables: bigEv }), env, ctx);
assert.equal(r.headers.get('X-Cache'), 'hit');
assert.equal(await r.text(), big);

// A page that starts well but ends in GraphQL errors still reaches the page (which reports the error), but isn't cached.
const partial = big.slice(0, -1) + ',"errors":[{"message":"Something broke"}]}';
globalThis.fetch = async url => url.endsWith('/oauth/token') ? new Response(JSON.stringify({ access_token: 'T', expires_in: 3600 })) : new Response(chunked(partial), { status: 200 });
const errEv = { ...ev, fight: 43 };
r = await worker.fetch(req({ op: 'mine', variables: errEv }), env, ctx);
assert.equal(await r.text(), partial);
await settle();
r = await worker.fetch(req({ op: 'mine', variables: errEv }), env, ctx);
assert.notEqual(r.headers.get('X-Cache'), 'hit');
await r.text();
await settle();
globalThis.fetch = realFetch;
console.log('worker tests passed');
