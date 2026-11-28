// Unit checks for the auction house price summary and the page's price text. Usage: node tests/ah_prices_test.mjs
import assert from 'node:assert/strict';
import { summarize, craftedIds, MARKETS, ladders, buyCost, materialsCost, priceHouse } from '../scripts/ah-prices.mjs';
import { priceFor, gold, houseKey, materialsList } from '../web/js/prices.js';

// Only crafted items are wanted.
assert.deepEqual(craftedIds({ items: { 5: ['x', 0, 1, 'd'], 7: ['y', 0, 1, 'dc'], 9: ['z', 0, 1, 'c'] } }).sort(), [7, 9]);

// Lowest and median buyout per item; bid-only auctions and unwanted items are skipped; stacks count per item.
const house = { auctions: [
  { id: 1, item: { id: 7 }, buyout: 500000, quantity: 1 },
  { id: 2, item: { id: 7 }, buyout: 300000, quantity: 1 },
  { id: 3, item: { id: 7 }, buyout: 900000, quantity: 1 },
  { id: 4, item: { id: 7 }, bid: 10000, quantity: 1 },
  { id: 5, item: { id: 9 }, buyout: 40000, quantity: 4 },
  { id: 6, item: { id: 8 }, buyout: 1, quantity: 1 },
] };
assert.deepEqual(summarize(house, [7, 9]), { 7: [300000, 500000, 3], 9: [10000, 10000, 4] });
assert.deepEqual(summarize({}, [7]), {});

// Every realm type has both faction houses.
for (const m of Object.values(MARKETS)) assert.ok(m.ruleset && m.alliance && m.horde);

// Page side: gold text, house choice, and a price lookup.
assert.equal(gold(1234567), '123g');
assert.equal(gold(123456), '12g 34s');
assert.equal(gold(5000000), '500g');
assert.equal(gold(250), '2s 50c');
assert.equal(houseKey('us', 'normal', 1), 'us-normal-alliance');
assert.equal(houseKey('eu', 'pvp', 0), 'eu-pvp-horde');
const prices = { updated: '2026-11-28T03:00:00Z', houses: { 'us-normal-alliance': { updated: '2026-11-28T02:40:00Z', items: { 7: [300000, 500000, 3] } } } };
assert.deepEqual(priceFor(prices, 'us-normal-alliance', 7), { min: 300000, median: 500000, listed: 3, updated: '2026-11-28T02:40:00Z' });
assert.equal(priceFor(prices, 'us-normal-alliance', 9), null);
assert.equal(priceFor(prices, 'us-pvp-horde', 7), undefined);
assert.equal(priceFor(null, 'us-normal-alliance', 7), undefined);

// Materials: commodities give unit prices; buying walks up from the cheapest listings.
const lad = ladders({ auctions: [
  { item: { id: 100 }, quantity: 5, unit_price: 200 },
  { item: { id: 100 }, quantity: 10, unit_price: 100 },
  { item: { id: 101 }, quantity: 1, unit_price: 5000 },
  { item: { id: 999 }, quantity: 1, unit_price: 1 },
] }, [100, 101, 102]);
assert.deepEqual(lad, { 100: [[100, 10], [200, 5]], 101: [[5000, 1]] });
assert.equal(buyCost(lad[100], 12), 10 * 100 + 2 * 200);
assert.equal(buyCost(lad[100], 16), null);
assert.equal(buyCost(undefined, 1), null);
// 12 of 100, 1 of 101, 2 of 102 (none listed): 1400 + 5000, one reagent unpriced.
assert.deepEqual(materialsCost([[100, 12], [101, 1], [102, 2]], lad), [6400, 1]);

// Page: materials fields and the recipe list.
const withMats = { recipes: { 7: [[100, 12], [101, 1]] }, reagents: { 100: 'Thorium Bar', 101: 'Arcanite Bar' },
  houses: { k: { updated: 't', items: { 7: [300000, 500000, 3, 6400, 1], 8: [0, 0, 0, 900, 0] } } } };
assert.deepEqual(priceFor(withMats, 'k', 7), { min: 300000, median: 500000, listed: 3, updated: 't', materials: 6400, unpriced: 1 });
assert.equal(priceFor(withMats, 'k', 8).listed, 0);
assert.equal(materialsList(withMats, 7), '12 Thorium Bar, 1 Arcanite Bar');
assert.equal(materialsList(withMats, 8), '');

// One house end to end, with the API stubbed: item prices, then materials from the commodities list.
const answers = {
  'ruleset/1/auctions/2': { auctions: [{ item: { id: 7 }, buyout: 300000, quantity: 1 }] },
  'ruleset/1/auctions/2/commodities': { auctions: [{ item: { id: 50 }, unit_price: 1000, quantity: 20 }] },
};
const realFetch = globalThis.fetch;
globalThis.fetch = async url => {
  const key = new URL(url).pathname.replace('/data/wow/', '');
  return key in answers ? { ok: true, json: async () => answers[key], headers: { get: () => 'Sat, 28 Nov 2026 10:00:00 GMT' } } : { ok: false, status: 404 };
};
try {
  const found = { recipes: { 7: [[50, 4]], 8: [[99, 1]] } };
  const r = await priceHouse({}, 'us', 'ruleset/1/auctions/2', [7, 8], found, [50, 99], 'us test');
  assert.equal(r.modified, 'Sat, 28 Nov 2026 10:00:00 GMT');
  assert.deepEqual(r.items, { 7: [300000, 300000, 1, 4000, 0] });
  assert.equal(r.priced, 1, 'recipe 8 has no priced reagent, so it gets no row');
  // No commodities list: item prices still come back, without materials.
  delete answers['ruleset/1/auctions/2/commodities'];
  const r2 = await priceHouse({}, 'us', 'ruleset/1/auctions/2', [7], found, [50], 'us test');
  assert.deepEqual(r2.items, { 7: [300000, 300000, 1] });
  assert.equal(r2.priced, 0);
  // The house itself failing rejects.
  await assert.rejects(priceHouse({}, 'us', 'ruleset/9/auctions/9', [7], found, [], 'x'), /HTTP 404/);
} finally { globalThis.fetch = realFetch; }

console.log('ah prices: ok');
