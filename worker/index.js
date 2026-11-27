// Cloudflare Worker that loads public Warcraft Logs reports for the analyzer page, so viewers need no sign-in.
// It holds a Warcraft Logs client id and secret (Worker secrets WCL_CLIENT_ID / WCL_CLIENT_SECRET), and only ever
// runs the page's two queries (web/js/wcl-queries.js): callers name a query, they can't send their own.
import { QUERIES } from '../web/js/wcl-queries.js';

const TOKEN_URL = 'https://forever.warcraftlogs.com/oauth/token';
// Same order as the page: the Classic API address answers for Forever reports; Forever's own is the fallback.
const APIS = ['https://classic.warcraftlogs.com/api/v2/client', 'https://forever.warcraftlogs.com/api/v2/client'];
const CACHE_SECONDS = 600;

let cachedToken = null; // { value, expires }

async function getToken(env) {
  if (cachedToken && Date.now() < cachedToken.expires) return cachedToken.value;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${env.WCL_CLIENT_ID}:${env.WCL_CLIENT_SECRET}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`token ${res.status}`);
  cachedToken = { value: data.access_token, expires: Date.now() + Math.max(60, (data.expires_in || 3600) - 300) * 1000 };
  return cachedToken.value;
}

function allowedOrigin(origin, env) {
  const list = (env.ALLOWED_ORIGINS || 'https://dogshep.github.io').split(',').map(s => s.trim());
  if (list.includes(origin)) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '')) return origin;
  return null;
}

const json = (body, status, cors) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });

// Variables must be the shapes the two queries take: a 16-character report code and numbers.
function cleanVariables(op, v) {
  if (!v || typeof v.code !== 'string' || !/^[A-Za-z0-9]{16}$/.test(v.code)) return null;
  if (op === 'report') return { code: v.code };
  const out = { code: v.code };
  for (const k of ['fight', 'actor', 'start', 'end']) { if (typeof v[k] !== 'number' || !isFinite(v[k])) return null; out[k] = v[k]; }
  return out;
}

async function sha(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env, ctx) {
    const origin = allowedOrigin(request.headers.get('Origin'), env);
    const cors = origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' } : {};
    if (request.method === 'OPTIONS') return new Response(null, { status: origin ? 204 : 403, headers: cors });
    if (!origin) return json({ error: 'origin not allowed' }, 403, cors);
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);
    const text = await request.text();
    if (text.length > 2000) return json({ error: 'too large' }, 413, cors);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400, cors); }
    const query = QUERIES[body.op];
    const variables = query && cleanVariables(body.op, body.variables);
    if (!variables) return json({ error: 'unknown query' }, 400, cors);

    // Reports rarely change, so identical requests are served from Cloudflare's cache for a while.
    const key = new Request(`https://cache.invalid/${await sha(body.op + JSON.stringify(variables))}`);
    const cache = caches.default;
    const hit = await cache.match(key);
    if (hit) return new Response(hit.body, { status: 200, headers: { 'Content-Type': 'application/json', ...cors, 'X-Cache': 'hit' } });

    let token;
    try { token = await getToken(env); } catch (e) { return json({ error: 'Warcraft Logs sign-in for the site failed' }, 502, cors); }
    let last = { status: 502, data: { error: 'no API answered' } };
    for (const api of APIS) {
      const res = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ query, variables }) });
      if (res.status === 401) cachedToken = null;
      if (res.status === 429) return json({ error: 'rate limited' }, 429, cors);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.data?.reportData?.report && !data.errors) {
        const out = JSON.stringify(data);
        ctx.waitUntil(cache.put(key, new Response(out, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SECONDS}` } })));
        return new Response(out, { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
      }
      // A private report, or one this API address doesn't know.
      last = { status: 404, data: { error: data.errors?.[0]?.message || `Warcraft Logs answered ${res.status}` } };
    }
    return json(last.data, last.status, cors);
  },
};
