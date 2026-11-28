// Cloudflare Worker that loads public Warcraft Logs reports for the analyzer page, so viewers need no sign-in.
// It holds a Warcraft Logs client id and secret (Worker secrets WCL_CLIENT_ID / WCL_CLIENT_SECRET), and only ever
// runs the page's queries (web/js/wcl-queries.js): callers name a query, they can't send their own.
//
// The Origin check only stops other websites from using it in a browser; scripts can send any Origin. What
// protects the site's Warcraft Logs quota is: strict variable checks (so requests can't be varied endlessly to
// dodge the cache), caching of answers and of failures, and a per-IP rate limit on requests that miss the cache.
import { QUERIES, QUERY_VARS, WCL_SITE, wclApis } from '../web/js/wcl-queries.js';

const TOKEN_URL = `${WCL_SITE}/oauth/token`;
const APIS = wclApis('client');
const CACHE_SECONDS = 600;
const FAIL_CACHE_SECONDS = 60;
// Report times are milliseconds from the start of the report.
const MAX_TIME = 7 * 24 * 3600 * 1000;
const MAX_SPAN = 24 * 3600 * 1000;

let cachedToken = null; // { value, expires }
let tokenRequest = null; // one token fetch at a time

async function getToken(env) {
  if (cachedToken && Date.now() < cachedToken.expires) return cachedToken.value;
  tokenRequest ??= (async () => {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${env.WCL_CLIENT_ID}:${env.WCL_CLIENT_SECRET}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(`token ${res.status}`);
    cachedToken = { value: data.access_token, expires: Date.now() + Math.max(60, (data.expires_in || 3600) - 300) * 1000 };
    return cachedToken.value;
  })().finally(() => { tokenRequest = null; });
  return tokenRequest;
}

function allowedOrigin(origin, env) {
  const list = (env.ALLOWED_ORIGINS || 'https://dogshep.github.io').split(',').map(s => s.trim());
  if (list.includes(origin)) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '')) return origin;
  return null;
}

const json = (body, status, cors, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors, ...extra } });

const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// Variables must be exactly what the query takes: a 16-character report code and whole numbers in range.
function cleanVariables(op, v) {
  if (!Object.hasOwn(QUERY_VARS, op) || !v || typeof v !== 'object') return null;
  if (typeof v.code !== 'string' || !/^[A-Za-z0-9]{16}$/.test(v.code)) return null;
  const keys = QUERY_VARS[op];
  if (Object.keys(v).some(k => !keys.includes(k))) return null;
  const out = { code: v.code };
  for (const k of keys) {
    if (k === 'code') continue;
    const ok = k === 'fight' ? int(v[k], 0, 100000) : k === 'actor' ? int(v[k], 0, 10000000) : int(v[k], 0, MAX_TIME);
    if (!ok) return null;
    out[k] = v[k];
  }
  if ('start' in out && !(out.start < out.end && out.end - out.start <= MAX_SPAN)) return null;
  return out;
}

async function sha(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// A good answer starts with the report. Event pages can be several MB, so the Worker never reads one whole: it
// looks at the first bytes, then streams the body on to the page and into the cache as it arrives (the free
// plan allows 10 ms of CPU, and decoding and re-encoding a 3 MB page as text took about that).
const GOOD_START = /^\s*\{\s*"data"\s*:\s*\{\s*"reportData"\s*:\s*\{\s*"report"\s*:\s*\{/;
const HEAD_BYTES = 200;
const TAIL_BYTES = 4096;

const concat = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };

// Reads the first HEAD_BYTES of a body (all of it, if shorter). Returns the text of those bytes and a stream that
// replays what was read, followed by the rest.
async function peek(body) {
  const reader = body.getReader();
  const chunks = [];
  let head = new Uint8Array(0);
  while (head.length < HEAD_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    head = concat(head, value.subarray(0, HEAD_BYTES - head.length));
  }
  const stream = new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(ch); },
    async pull(c) { const { done, value } = await reader.read(); done ? c.close() : c.enqueue(value); },
    cancel(reason) { return reader.cancel(reason); },
  });
  return { head: new TextDecoder().decode(head), stream };
}

// Passes a body through unchanged and keeps its last TAIL_BYTES, to check for GraphQL errors once it has ended.
function tailOf(stream) {
  let tail = new Uint8Array(0);
  const out = stream.pipeThrough(new TransformStream({
    transform(ch, c) {
      tail = ch.length >= TAIL_BYTES ? ch.slice(-TAIL_BYTES) : concat(tail, ch).slice(-TAIL_BYTES);
      c.enqueue(ch);
    },
  }));
  return { stream: out, hasErrors: () => new TextDecoder().decode(tail).includes('"errors"') };
}

// Warcraft Logs' wording for a report the site's client can't see.
const PRIVATE = /permission|private|does not exist|not found/i;

function errorOf(text) {
  try { const d = JSON.parse(text.length > 100000 ? '{}' : text); return { message: d.errors?.[0]?.message, noReport: d.data?.reportData?.report === null }; } catch { return {}; }
}

export default {
  async fetch(request, env, ctx) {
    const origin = allowedOrigin(request.headers.get('Origin'), env);
    const cors = origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Expose-Headers': 'X-Cache', 'Timing-Allow-Origin': origin, Vary: 'Origin' } : {};
    if (request.method === 'OPTIONS') return new Response(null, { status: origin ? 204 : 403, headers: cors });
    if (!origin) return json({ error: 'origin not allowed' }, 403, cors);
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);
    const text = await request.text();
    if (text.length > 2000) return json({ error: 'too large' }, 413, cors);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400, cors); }
    const variables = cleanVariables(body?.op, body?.variables);
    if (!variables) return json({ error: 'unknown query' }, 400, cors);
    const query = QUERIES[body.op];

    // Reports rarely change, so identical requests are served from Cloudflare's cache for a while.
    const key = new Request(`https://cache.invalid/${await sha(body.op + JSON.stringify(variables))}`);
    const cache = caches.default;
    const hit = await cache.match(key);
    if (hit) return new Response(hit.body, { status: hit.status, headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'hit' } });

    // Only requests that would reach Warcraft Logs count against the limit.
    if (env.LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return json({ error: 'rate limited' }, 429, cors, { 'Retry-After': '60' });
    }

    const remember = (out, status, seconds) =>
      ctx.waitUntil(cache.put(key, new Response(out, { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${seconds}` } })));

    let last = { status: 502, data: { error: 'no API answered' } };
    for (const api of APIS) {
      let res;
      for (let attempt = 0; attempt < 2; attempt++) {
        let token;
        try { token = await getToken(env); } catch { return json({ error: 'Warcraft Logs sign-in for the site failed' }, 502, cors); }
        res = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ query, variables }) });
        if (res.status !== 401) break;
        cachedToken = null; // expired or revoked: get a new one and try once more
      }
      if (res.status === 429) return json({ error: 'rate limited' }, 429, cors, { 'Retry-After': '60' });
      const { head, stream } = await peek(res.body);
      if (res.ok && GOOD_START.test(head)) {
        // One copy to the page, one to the cache. A page that ends in GraphQL errors is taken back out of the cache.
        const [toPage, toCache] = stream.tee();
        const cached = tailOf(toCache);
        const headers = { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SECONDS}` };
        ctx.waitUntil(cache.put(key, new Response(cached.stream, { status: 200, headers })).then(() => (cached.hasErrors() ? cache.delete(key) : undefined)));
        return new Response(toPage, { status: 200, headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'miss' } });
      }
      // Not a good answer: these are small, so read the rest to see what went wrong.
      const out = await new Response(stream).text();
      const err = errorOf(out);
      // 404 means a private report, or one this API address doesn't know: the page asks the viewer to sign in.
      // Anything else (a bad query, a Warcraft Logs outage) is a 502, so the page doesn't blame the report.
      const missing = res.ok && (err.noReport || PRIVATE.test(err.message || ''));
      last = { status: missing ? 404 : 502, data: { error: err.message || `Warcraft Logs answered ${res.status}` } };
      // Only a missing report is worth asking the other address about; a bad query would fail there too.
      if (!missing) break;
    }
    if (last.status === 404) remember(JSON.stringify(last.data), 404, FAIL_CACHE_SECONDS);
    return json(last.data, last.status, cors);
  },
};
