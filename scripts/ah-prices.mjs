// Auction house prices for the crafted items the "Gear upgrades" section can suggest, from Blizzard's Game Data
// API for WoW Forever. Run by .github/workflows/ah-prices.yml every few hours; the output is small and the page
// reads it to show an approximate gold cost next to crafted upgrades.
//
// The Forever API isn't documented by Blizzard yet (checked against community notes, Nov 2026). What works:
//   token:    POST https://oauth.battle.net/token (client credentials, a free client from develop.battle.net)
//   auctions: GET https://{region}.api.blizzard.com/data/wow/ruleset/{ruleset}/auctions/{house}
//             ?namespace=dynamic-forever-{region}   (about 9 MB per busy house, refreshed hourly)
// Forever has no realms: each realm type (ruleset) has an Alliance, a Horde and a Blackwater (neutral) house.
//
//   recipes:  GET https://us.api.blizzard.com/data/wow/profession/{id}/skill-tier/{tier} lists a profession's recipes,
//             and /data/wow/recipe/{id} gives the crafted item and its reagents (namespace static-forever-us).
//   materials are stackable, so they sell on each house's /commodities list (unit_price), not with the gear.
//
// Usage: BNET_CLIENT_ID=… BNET_CLIENT_SECRET=… node scripts/ah-prices.mjs <upgrades.json> <names.json> <out.json>
// Writes {
//   updated, source,
//   recipes: { craftedId: [[reagentId, quantity], …] }, reagents: { reagentId: name },
//   houses: { "us-normal-alliance": { updated, items: { id: [min, median, listed, materials, unpriced] } } }
// } with prices in copper per item, from buyouts only. materials is what buying one craft's reagents from the
// cheapest listings costs, and unpriced how many of its reagents had too few listed to buy (left out of that sum).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SRC, KIND_CRAFTED } from '../web/js/fields.js';

export const REGIONS = ['us', 'eu'];
// Realm type -> ruleset id and house ids (Alliance, Horde). Hardcore houses carry no auctions; Blackwater is the
// neutral house, which few use for gear.
export const MARKETS = {
  normal: { ruleset: 2, alliance: 111, horde: 114 },
  pvp: { ruleset: 1, alliance: 110, horde: 113 },
  rp: { ruleset: 3, alliance: 119, horde: 120 },
  rppvp: { ruleset: 15, alliance: 123, horde: 124 },
};

// The crafted items in an upgrades.json (source kind 'c'), as numbers.
export function craftedIds(upgrades) {
  return Object.entries(upgrades.items || {}).filter(([, m]) => String(m[SRC.KINDS] || '').includes(KIND_CRAFTED)).map(([id]) => Number(id));
}

// Crafting professions with gear recipes: Blacksmithing, Leatherworking, Tailoring, Engineering.
export const PROFESSIONS = [164, 165, 197, 202];

const quantityOf = a => Math.max(1, a.quantity || 1);

// Groups an auction list by item: Map id -> [[price per item, quantity], …] for the wanted ids. unitOf(auction)
// gives the price per item in copper, or 0 for a listing that doesn't count.
function listingsByItem(auctions, wanted, unitOf) {
  const want = new Set(wanted);
  const out = new Map();
  for (const a of auctions || []) {
    const id = a.item?.id;
    const unit = unitOf(a);
    if (!want.has(id) || !(unit > 0)) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push([unit, quantityOf(a)]);
  }
  return out;
}

// A commodities list -> { reagentId: [[unitPrice, quantity], …] cheapest first } for the wanted reagents.
export function ladders(commodities, wanted) {
  const byItem = listingsByItem(commodities.auctions, wanted, a => a.unit_price || (a.buyout ? a.buyout / quantityOf(a) : 0));
  const out = {};
  for (const [id, list] of byItem) out[id] = list.sort((x, y) => x[0] - y[0]);
  return out;
}

// What buying `qty` of a reagent from the cheapest listings costs; null when fewer are listed.
export function buyCost(ladder, qty) {
  let left = qty, cost = 0;
  for (const [unit, n] of ladder || []) {
    const take = Math.min(n, left);
    cost += take * unit;
    left -= take;
    if (!left) return Math.round(cost);
  }
  return null;
}

// One craft's materials: [copper for the reagents that could be bought, how many reagents couldn't].
export function materialsCost(recipe, lad) {
  let cost = 0, unpriced = 0;
  for (const [id, qty] of recipe) {
    const c = buyCost(lad[id], qty);
    if (c === null) unpriced++; else cost += c;
  }
  return [cost, unpriced];
}

// One house's auctions -> { id: [lowest, median, listed] } for the wanted items. Prices are buyout per item, in
// copper; bid-only auctions don't count.
export function summarize(house, wanted) {
  const prices = listingsByItem(house.auctions, wanted, a => (a.buyout > 0 ? a.buyout / quantityOf(a) : 0));
  const out = {};
  for (const [id, list] of prices) {
    list.sort((x, y) => x[0] - y[0]);
    const listed = list.reduce((s, x) => s + x[1], 0);
    let seen = 0, median = list[0][0];
    for (const [p, n] of list) { seen += n; if (seen * 2 >= listed) { median = p; break; } }
    out[id] = [Math.round(list[0][0]), Math.round(median), listed];
  }
  return out;
}

async function token(id, secret) {
  const res = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Battle.net token: HTTP ${res.status}`);
  return data.access_token;
}

const api = (auth, region, path, ns) => fetch(`https://${region}.api.blizzard.com/data/wow/${path}?namespace=${ns}-forever-${region}&locale=en_US`, { headers: auth });
async function getJson(auth, region, path, ns) {
  const res = await api(auth, region, path, ns);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return { json: await res.json(), modified: res.headers.get('last-modified') };
}

// Recipes for the wanted items, found by name in the crafting professions' recipe lists, then checked against
// the recipe's crafted item. Returns { recipes: {craftedId: [[reagentId, qty]]}, reagents: {id: name} }.
async function findRecipes(auth, wanted, names) {
  const want = new Set(wanted);
  const byName = new Map(wanted.map(id => [names[id]?.[0], id]).filter(([n]) => n));
  const hits = [];
  for (const prof of PROFESSIONS) {
    const { json: p } = await getJson(auth, 'us', `profession/${prof}`, 'static');
    for (const t of p.skill_tiers || []) {
      const { json: st } = await getJson(auth, 'us', `profession/${prof}/skill-tier/${t.id}`, 'static');
      for (const r of (st.categories || []).flatMap(c => c.recipes || [])) if (byName.has(r.name)) hits.push(r.id);
    }
  }
  const recipes = {}, reagents = {};
  for (const rid of hits) {
    try {
      const { json: r } = await getJson(auth, 'us', `recipe/${rid}`, 'static');
      const made = r.crafted_item?.id ?? r.alliance_crafted_item?.id ?? r.horde_crafted_item?.id;
      if (!want.has(made) || !r.reagents?.length) continue;
      const per = r.crafted_quantity?.value || 1;
      recipes[made] = r.reagents.map(x => [x.reagent.id, Math.ceil(x.quantity / per)]);
      for (const x of r.reagents) reagents[x.reagent.id] = x.reagent.name;
    } catch (e) { console.warn(`recipe ${rid}: ${e.message}`); }
  }
  console.log(`recipes: ${Object.keys(recipes).length} of ${wanted.length} crafted items, ${Object.keys(reagents).length} reagents`);
  return { recipes, reagents };
}

// One house: item prices, plus the cost of each recipe's materials from its commodities list when that loads.
export async function priceHouse(auth, region, path, wanted, found, reagentIds, label) {
  const { json, modified } = await getJson(auth, region, path, 'dynamic');
  const items = summarize(json, wanted);
  let lad = {};
  if (reagentIds.length) {
    try { lad = ladders((await getJson(auth, region, `${path}/commodities`, 'dynamic')).json, reagentIds); } catch (e) { console.warn(`${label} materials: ${e.message}`); }
  }
  let priced = 0;
  for (const [craftedId, recipe] of Object.entries(found.recipes)) {
    if (!Object.keys(lad).length) break;
    const [cost, unpriced] = materialsCost(recipe, lad);
    if (unpriced === recipe.length) continue;
    const row = items[craftedId] || [0, 0, 0];
    items[craftedId] = [...row.slice(0, 3), cost, unpriced];
    priced++;
  }
  return { items, modified, priced };
}

async function main() {
  const [upgradesPath, namesPath, outPath] = process.argv.slice(2);
  const { BNET_CLIENT_ID: id, BNET_CLIENT_SECRET: secret } = process.env;
  if (!upgradesPath || !namesPath || !outPath || !id || !secret) {
    console.error('Usage: BNET_CLIENT_ID=… BNET_CLIENT_SECRET=… node scripts/ah-prices.mjs <upgrades.json> <names.json> <out.json>');
    process.exit(2);
  }
  const wanted = craftedIds(JSON.parse(readFileSync(upgradesPath, 'utf8')));
  if (!wanted.length) throw new Error('No crafted items in the upgrade list.');
  const names = JSON.parse(readFileSync(namesPath, 'utf8')).items || {};
  const auth = { Authorization: `Bearer ${await token(id, secret)}` };
  // Materials are optional: prices still publish if the recipe lookups fail.
  let found = { recipes: {}, reagents: {} };
  try { found = await findRecipes(auth, wanted, names); } catch (e) { console.warn(`recipes: ${e.message}`); }
  const reagentIds = Object.keys(found.reagents).map(Number);
  const out = { updated: new Date().toISOString(), source: 'Blizzard Game Data API (WoW Forever)', items: wanted.length, ...found, houses: {} };
  let ok = 0, failed = 0;
  const houses = REGIONS.flatMap(region => Object.entries(MARKETS).flatMap(([market, m]) => ['alliance', 'horde'].map(side => ({ region, market, side, path: `ruleset/${m.ruleset}/auctions/${m[side]}` }))));
  for (const { region, market, side, path } of houses) {
    try {
      const { items, modified, priced } = await priceHouse(auth, region, path, wanted, found, reagentIds, `${region} ${market} ${side}`);
      out.houses[`${region}-${market}-${side}`] = { updated: modified || out.updated, items };
      ok++;
      console.log(`${region} ${market} ${side}: ${Object.values(items).filter(r => r[2]).length} of ${wanted.length} crafted items listed, materials priced for ${priced}`);
    } catch (e) {
      failed++;
      console.warn(`${region} ${market} ${side}: ${e.message}`);
    }
  }
  if (!ok) throw new Error('No auction house answered.');
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`${outPath}: ${ok} houses, ${failed} failed`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e.stack || e.message); process.exit(1); });
}
