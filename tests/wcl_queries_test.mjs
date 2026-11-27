// Every query declares exactly the variables the page sends, and uses each one. Warcraft Logs refuses a query
// with an unused variable ("Variable "$actor" is never used."), which once broke every fight load.
// Usage: node tests/wcl_queries_test.mjs
import assert from 'node:assert/strict';
import { QUERIES, QUERY_VARS } from '../web/js/wcl-queries.js';

for (const [op, query] of Object.entries(QUERIES)) {
  const cut = query.indexOf(')');
  const declared = [...query.slice(0, cut).matchAll(/\$(\w+)/g)].map(m => m[1]);
  const body = query.slice(cut + 1);
  assert.deepEqual([...declared].sort(), [...QUERY_VARS[op]].sort(), `${op}: declared variables match QUERY_VARS`);
  for (const v of declared) assert.match(body, new RegExp(`\\$${v}\\b`), `${op}: $${v} is never used`);
}
console.log('wcl query tests passed');
