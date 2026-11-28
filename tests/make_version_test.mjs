// scripts/make_version.py writes the commit it is run in. Skipped without python3 or git.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'ver-'));
try {
  const git = (...a) => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' });
  if (git('init', '-q').status !== 0) { console.log('make_version_test: skipped (no git)'); process.exit(0); }
  assert.equal(git('commit', '-q', '--allow-empty', '-m', 'x').status, 0);
  const sha = git('rev-parse', 'HEAD').stdout.trim();
  const script = fileURLToPath(new URL('../scripts/make_version.py', import.meta.url));
  const r = spawnSync('python3', ['-I', script, join(dir, 'version.json')], { cwd: dir, encoding: 'utf8' });
  if (r.error?.code === 'ENOENT') { console.log('make_version_test: skipped (no python3)'); process.exit(0); }
  assert.equal(r.status, 0, r.stderr);
  const v = JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8'));
  assert.equal(v.repo, 'wowsims/forever');
  assert.equal(v.commit, sha);
  assert.match(v.commitDate, /^\d{4}-\d\d-\d\dT/);
  assert.match(v.builtAt, /^\d{4}-\d\d-\d\dT.*\+00:00$/);
  console.log('make_version_test: ok');
} finally { rmSync(dir, { recursive: true, force: true }); }
