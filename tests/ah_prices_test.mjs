// Unit checks for the auction house price summary and the page's price text. Usage: node tests/ah_prices_test.mjs
import assert from 'node:assert/strict';
import { summarize, craftedIds, MARKETS } from '../scripts/ah-prices.mjs';
import { priceFor, gold, houseKey } from '../web/js/prices.js';

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

console.log('ah prices: ok');
