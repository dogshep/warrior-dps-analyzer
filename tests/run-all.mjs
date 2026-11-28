// Runs every tests/*_test.mjs in turn, so a new test file is picked up with no list to edit.
// Usage: npm test   (or: node tests/run-all.mjs [name-filter])
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const filter = process.argv[2] || '';
const files = readdirSync(dir).filter(f => f.endsWith('_test.mjs') && f.includes(filter)).sort();
if (!files.length) { console.error(`No tests match "${filter}".`); process.exit(1); }

const failed = [];
for (const f of files) {
  console.log(`\n== ${f}`);
  const r = spawnSync(process.execPath, [dir + f], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(f);
}
console.log(`\n${files.length - failed.length} of ${files.length} test files passed.`);
if (failed.length) { console.error(`FAILED: ${failed.join(', ')}`); process.exit(1); }
