// The page loads a report through the Worker when not signed in, and asks for sign-in when the Worker can't.
// Usage: node tests/wcl_proxy_test.mjs
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { loadReport, hasProxy } = await import('../web/js/wcl.js');

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
await assert.rejects(loadReport('AAAAAAAAAAAAAAAA', fetchImpl), e => e.needsAuth === true);
console.log('wcl proxy tests passed');
