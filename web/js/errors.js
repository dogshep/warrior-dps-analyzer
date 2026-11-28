// Error types the page tells apart with instanceof, instead of flags set on plain Errors.

// Warcraft Logs needs the viewer to sign in (a private report, a used-up shared quota, an expired token).
export class AuthRequiredError extends Error {
  constructor(message) { super(message); this.name = 'AuthRequiredError'; }
}

// A sim was stopped. `capped` is true when the page stopped it for running past its time limit, not the viewer.
export class CancelledError extends Error {
  constructor(message = 'Sim cancelled.', { capped = false } = {}) { super(message); this.name = 'CancelledError'; this.capped = capped; }
}

const ISSUES = 'https://github.com/dogshep/warrior-dps-analyzer/issues/new';

// A link that opens a prefilled bug report: what failed, which build and sim, which browser. No log contents.
export function reportUrl(what, doc = document, nav = navigator) {
  const build = doc.querySelector('meta[name="build"]')?.content || 'dev';
  const sim = doc.getElementById('simver')?.textContent || '';
  const details = `What failed: ${String(what).slice(0, 300)}\nBuild: ${build}\nSim: ${sim}\nBrowser: ${nav.userAgent}`;
  return `${ISSUES}?template=bug.yml&title=${encodeURIComponent('Error: ' + String(what).slice(0, 80))}&details=${encodeURIComponent(details)}`;
}
