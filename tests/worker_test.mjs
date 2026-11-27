// Unit checks for the no-sign-in Worker with Warcraft Logs and Cloudflare's cache mocked. Usage: node tests/worker_test.mjs
import assert from 'node:assert/strict';

const calls = [];
let reportReply = { data: { reportData: { report: { title: 'UBRS' } } } };
globalThis.fetch = async (url, opts) => {
  calls.push({ url, opts });
  if (url.endsWith('/oauth/token')) {
    assert.equal(opts.headers.Authorization, 'Basic ' + btoa('id:secret'));
    return new Response(JSON.stringify({ access_token: 'T', expires_in: 3600 }), { status: 200 });
  }
  assert.equal(opts.headers.Authorization, 'Bearer T');
  return new Response(JSON.stringify(reportReply), { status: 200 });
};
const store = new Map();
globalThis.caches = { default: { match: async k => store.get(k.url)?.clone(), put: async (k, r) => { store.set(k.url, r); } } };

const { default: worker } = await import('../worker/index.js');
const env = { WCL_CLIENT_ID: 'id', WCL_CLIENT_SECRET: 'secret', ALLOWED_ORIGINS: 'https://dogshep.github.io' };
const ctx = { waitUntil: p => p };
const req = (body, origin = 'https://dogshep.github.io') => new Request('https://w.dev/', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let r = await worker.fetch(req({ op: 'report', variables: { code: '83cYV91DARnwWNaj' } }), env, ctx);
assert.equal(r.status, 200);
assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://dogshep.github.io');
assert.equal((await r.json()).data.reportData.report.title, 'UBRS');
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
assert.equal((await worker.fetch(req({ op: 'events', variables: { code: '83cYV91DARnwWNaj', fight: 1 } }), env, ctx)).status, 400);
assert.equal((await worker.fetch(req({ op: 'report', variables: { code: '83cYV91DARnwWNaj' } }, 'https://evil.example'), env, ctx)).status, 403);

// A private report: both API addresses return no report, so the page is told to sign in (404).
reportReply = { data: { reportData: { report: null } }, errors: [{ message: 'You do not have permission to view this report.' }] };
r = await worker.fetch(req({ op: 'report', variables: { code: 'AAAAAAAAAAAAAAAA' } }), env, ctx);
assert.equal(r.status, 404);
assert.match((await r.json()).error, /permission/);
console.log('worker tests passed');
