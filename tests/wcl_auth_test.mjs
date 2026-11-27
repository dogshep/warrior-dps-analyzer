// Sign-in state handling for the Warcraft Logs OAuth redirect. Usage: node tests/wcl_auth_test.mjs
import assert from 'node:assert/strict';

const mem = kind => { const m = new Map(); return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
globalThis.localStorage = mem('local');
globalThis.sessionStorage = mem('session');
localStorage.setItem('wcl_token', 'old-token-in-localStorage');
let href = 'https://dogshep.github.io/warrior-dps-analyzer/';
globalThis.location = {
  origin: 'https://dogshep.github.io', pathname: '/warrior-dps-analyzer/',
  get search() { return new URL(href).search; }, get href() { return href; }, set href(v) { href = v; },
};
globalThis.history = { replaceState: (_, __, url) => { href = url; } };
const posted = [];
globalThis.fetch = async (url, opts) => { posted.push({ url, body: String(opts.body) }); return new Response(JSON.stringify({ access_token: 'T', expires_in: 3600 * 24 * 30 }), { status: 200 }); };

const wcl = await import('../web/js/wcl.js');
// Old localStorage sign-ins are cleared.
assert.equal(localStorage.getItem('wcl_token'), null);
assert.equal(wcl.token(), null);

// A link with a code but no sign-in started in this tab is refused (no state stored, none in the link).
href = 'https://dogshep.github.io/warrior-dps-analyzer/?code=ATTACKER';
await assert.rejects(wcl.finishSignIn(), /did not match/);
assert.equal(posted.length, 0);
assert.equal(href, 'https://dogshep.github.io/warrior-dps-analyzer/');

// A real round trip: state and verifier live in sessionStorage and are used once.
await wcl.signIn('https://forever.warcraftlogs.com/reports/83cYV91DARnwWNaj');
const auth = new URL(href);
assert.equal(auth.origin, 'https://forever.warcraftlogs.com');
const state = auth.searchParams.get('state');
assert.equal(localStorage.getItem('wcl_state'), null);
assert.equal(sessionStorage.getItem('wcl_state'), state);
href = `https://dogshep.github.io/warrior-dps-analyzer/?code=GOOD&state=${state}`;
assert.equal(await wcl.finishSignIn(), 'https://forever.warcraftlogs.com/reports/83cYV91DARnwWNaj');
assert.equal(posted.length, 1);
assert.match(posted[0].body, /code_verifier=[0-9a-f-]{72}/);
assert.equal(wcl.token(), 'T');
assert.equal(localStorage.getItem('wcl_token'), null);
assert.equal(sessionStorage.getItem('wcl_state'), null);

// Replaying the same redirect fails: the state was used up.
href = `https://dogshep.github.io/warrior-dps-analyzer/?code=GOOD&state=${state}`;
await assert.rejects(wcl.finishSignIn(), /did not match/);

// A wrong state is refused; a cancelled sign-in says so.
await wcl.signIn();
const s2 = new URL(href).searchParams.get('state');
href = 'https://dogshep.github.io/warrior-dps-analyzer/?code=X&state=wrong';
await assert.rejects(wcl.finishSignIn(), /did not match/);
await wcl.signIn();
const s3 = new URL(href).searchParams.get('state');
href = `https://dogshep.github.io/warrior-dps-analyzer/?error=access_denied&state=${s3}`;
await assert.rejects(wcl.finishSignIn(), /cancelled/);
assert.notEqual(s2, s3);
console.log('wcl auth tests passed');
