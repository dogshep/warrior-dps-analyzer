// Approximate auction house prices for crafted upgrades. .github/workflows/ah-prices.yml publishes prices.json
// (from Blizzard's API, see scripts/ah-prices.mjs) to the ah-prices branch every 3 hours.
import { PRICE } from './fields.js';

const PRICES_URL = 'https://raw.githubusercontent.com/dogshep/warrior-dps-analyzer/ah-prices/prices.json';

// Copper -> "123g 46s" (copper only shown under 1 gold).
export function gold(copper) {
  const c = Math.round(copper);
  const g = Math.floor(c / 10000), s = Math.floor((c % 10000) / 100), cp = c % 100;
  if (g >= 100) return `${Math.round(c / 10000).toLocaleString('en-US')}g`;
  if (g) return s ? `${g}g ${s}s` : `${g}g`;
  return cp ? `${s}s ${cp}c` : `${s}s`;
}

// The house for a region, realm type and log faction (1 Alliance, 0 Horde).
export const houseKey = (region, market, faction) => `${region}-${market}-${faction === 0 ? 'horde' : 'alliance'}`;

// { min, median, listed, updated, materials, unpriced } for an item (listed 0 when only its materials are priced;
// materials undefined when they aren't); null when the house has nothing on it; undefined when there is no data
// for that house.
export function priceFor(prices, key, id) {
  const h = prices?.houses?.[key];
  if (!h) return undefined;
  const p = h.items?.[id];
  if (!p) return null;
  // Numbers only: this file is fetched from a branch, and its values end up in HTML.
  const n = v => Number(v) || 0;
  const out = { min: n(p[PRICE.MIN]), median: n(p[PRICE.MEDIAN]), listed: n(p[PRICE.LISTED]), updated: h.updated };
  if (p.length > PRICE.UNPRICED) Object.assign(out, { materials: n(p[PRICE.MATERIALS]), unpriced: n(p[PRICE.UNPRICED]) });
  return out;
}

// "8 Thorium Bar, 2 Arcanite Bar" for an item's recipe, or ''.
export function materialsList(prices, id) {
  const r = prices?.recipes?.[id];
  return r ? r.map(([rid, n]) => `${n} ${prices.reagents?.[rid] || `item ${rid}`}`).join(', ') : '';
}

// "2 hours ago" style age of a timestamp.
export function age(ts, now = Date.now()) {
  const h = (now - Date.parse(ts)) / 3600000;
  if (!Number.isFinite(h)) return '';
  if (h < 1) return 'under an hour ago';
  if (h < 48) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago`;
  return `${Math.round(h / 24)} days ago`;
}

let loading = null;
// Loads prices.json once per page; resolves to null when it can't be had.
export function loadPrices() {
  loading ??= fetch(PRICES_URL, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  return loading;
}
