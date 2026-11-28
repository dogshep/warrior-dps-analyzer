// Run by deploy.yml just before the page is published: node scripts/stamp-build.mjs <web dir> <build id> <sim id>
// GitHub Pages lets browsers keep files for 10 minutes, and the page's modules import each other by plain names, so
// after a deploy a visitor could get new and old files mixed. This adds ?v=<id> to every file the page loads, so
// each deploy has its own URLs. The 6 MB sim uses the sim's own id, so it is only downloaded again when it changes.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SIM_FILES = /(^|\/)(lib\.wasm\.gz|wasm_exec\.js)$/;

export function stampSource(text, build, sim) {
  const tag = path => `${path}?v=${SIM_FILES.test(path) ? sim : build}`;
  return text
    // import ... from './x.js'
    .replace(/(from\s+')(\.\/[\w-]+\.js)(')/g, (_, a, p, c) => a + tag(p) + c)
    // 'sim/…', 'sample/…', '../sim/…', 'wcl-proxy.json', 'js/….js', 'style.css' in quotes or template strings
    .replace(/(['"`])((?:\.\.\/)?(?:sim|sample)\/[^'"`?]*|wcl-proxy\.json|js\/[\w-]+\.js|style\.css)\1/g, (_, q, p) => q + tag(p) + q)
    // The build id the page reports with a bug.
    .replace('<meta name="build" content="dev">', `<meta name="build" content="${build}">`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [dir, build, sim] = process.argv.slice(2);
  if (!dir || !build || !sim) { console.error('usage: stamp-build.mjs <web dir> <build id> <sim id>'); process.exit(1); }
  const files = [join(dir, 'index.html'), ...readdirSync(join(dir, 'js')).filter(f => f.endsWith('.js')).map(f => join(dir, 'js', f))];
  for (const f of files) writeFileSync(f, stampSource(readFileSync(f, 'utf8'), build, sim));
  console.log(`Stamped ${files.length} files with build ${build}, sim ${sim}.`);
}
