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
// Usage: BNET_CLIENT_ID=… BNET_CLIENT_SECRET=… node scripts/ah-prices.mjs <upgrades.json> <out.json>
// Writes { updated, source, houses: { "us-normal-alliance": { updated, items: { id: [min, median, listed] } } } }
// with prices in copper per item, from buyouts only.
import { readFileSync, writeFileSync } from 'node:fs';

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
  return Object.entries(upgrades.items || {}).filter(([, m]) => String(m[3] || '').includes('c')).map(([id]) => Number(id));
}

// One house's auctions -> { id: [lowest, median, listed] } for the wanted items. Prices are buyout per item, in
// copper; bid-only auctions don't count.
export function summarize(house, wanted) {
  const want = new Set(wanted);
  const prices = new Map();
  for (const a of house.auctions || []) {
    const id = a.item?.id;
    if (!want.has(id) || !(a.buyout > 0)) continue;
    const per = a.buyout / Math.max(1, a.quantity || 1);
    const n = Math.max(1, a.quantity || 1);
    if (!prices.has(id)) prices.set(id, []);
    prices.get(id).push([per, n]);
  }
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

async function main() {
  const [upgradesPath, outPath] = process.argv.slice(2);
  const { BNET_CLIENT_ID: id, BNET_CLIENT_SECRET: secret } = process.env;
  if (!upgradesPath || !outPath || !id || !secret) {
    console.error('Usage: BNET_CLIENT_ID=… BNET_CLIENT_SECRET=… node scripts/ah-prices.mjs <upgrades.json> <out.json>');
    process.exit(2);
  }
  const wanted = craftedIds(JSON.parse(readFileSync(upgradesPath, 'utf8')));
  if (!wanted.length) throw new Error('No crafted items in the upgrade list.');
  const auth = { Authorization: `Bearer ${await token(id, secret)}` };
  const out = { updated: new Date().toISOString(), source: 'Blizzard Game Data API (WoW Forever)', items: wanted.length, houses: {} };
  let ok = 0, failed = 0;
  for (const region of REGIONS) {
    for (const [market, m] of Object.entries(MARKETS)) {
      for (const side of ['alliance', 'horde']) {
        const url = `https://${region}.api.blizzard.com/data/wow/ruleset/${m.ruleset}/auctions/${m[side]}?namespace=dynamic-forever-${region}&locale=en_US`;
        try {
          const res = await fetch(url, { headers: auth });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const items = summarize(await res.json(), wanted);
          out.houses[`${region}-${market}-${side}`] = { updated: res.headers.get('last-modified') || out.updated, items };
          ok++;
          console.log(`${region} ${market} ${side}: ${Object.keys(items).length} of ${wanted.length} crafted items listed`);
        } catch (e) {
          failed++;
          console.warn(`${region} ${market} ${side}: ${e.message}`);
        }
      }
    }
  }
  if (!ok) throw new Error('No auction house answered.');
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`${outPath}: ${ok} houses, ${failed} failed`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
