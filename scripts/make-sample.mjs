// Builds web/sample/sample-report.json, the finished results behind "Try a sample report". It serves web/ locally,
// opens the page in headless Chromium, loads web/sample/sample-WoWCombatLog.txt like a dropped file, presses
// Analyze and Find upgrades, and saves the parts of the results page that sample.js fills back in.
// Needs a built sim in web/sim (scripts/build-sim.sh, with the upgrade list) and Playwright.
// Usage: node scripts/make-sample.mjs [iterations]   (default 1000; more makes the numbers steadier)
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SAMPLE_PARTS } from '../web/js/sample.js';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const LOG = join(WEB, 'sample/sample-WoWCombatLog.txt');
const OUT = join(WEB, 'sample/sample-report.json');
const iterations = Number(process.argv[2] || 1000);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.txt': 'text/plain' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(WEB, path.endsWith('/') ? `${path}index.html` : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(url);
  await page.setInputFiles('#file', LOG);
  await page.waitForSelector('#pickers:not([hidden])');
  await page.$eval('#iters', (el, v) => { el.value = v; }, String(iterations));
  const t0 = Date.now();
  await page.click('#go');
  await page.waitForFunction(() => document.getElementById('simnote').textContent && !document.getElementById('go').disabled, null, { timeout: 600000 });
  const simnote = await page.textContent('#simnote');
  if (/failed|cancelled/i.test(simnote)) throw new Error(`Analyze did not finish: ${simnote}`);
  console.log(`analyzed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await page.waitForFunction(() => !document.getElementById('upgGo').disabled);
  await page.click('#upgGo');
  await page.waitForFunction(() => document.getElementById('upgNote').textContent || document.querySelector('#upgOut .warn'), null, { timeout: 600000 });
  if (await page.$('#upgOut .warn:not(.small)')) throw new Error(`Find upgrades failed: ${await page.textContent('#upgOut')}`);
  console.log(`upgrades done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const html = await page.evaluate(ids => Object.fromEntries(ids.map(id => [id, document.getElementById(id).hidden || document.getElementById(id).closest('[hidden]') ? '' : document.getElementById(id).innerHTML])), SAMPLE_PARTS);
  // Auction house prices are frozen in the sample, so say when they were read rather than how long ago.
  const made = new Date().toISOString().slice(0, 10);
  html.upgNote = html.upgNote.replace(/updated [^.<]+? ago/, `as of ${made}`);
  html.upgOut = html.upgOut.replace(/updated [^.<]+? ago/, `as of ${made}`);
  const version = JSON.parse(await readFile(join(WEB, 'sim/version.json'), 'utf8').catch(() => 'null'));
  await writeFile(OUT, JSON.stringify({ made, sim: version?.commit || null, iterations, html }, null, 1) + '\n');
  console.log(`wrote ${OUT}`);
} finally {
  await browser.close();
  server.close();
}
