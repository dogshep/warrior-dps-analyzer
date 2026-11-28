import assert from 'node:assert/strict';
import { AuthRequiredError, CancelledError, reportUrl } from '../web/js/errors.js';

const a = new AuthRequiredError('sign in');
assert.ok(a instanceof Error && a instanceof AuthRequiredError && !(a instanceof CancelledError));
assert.equal(a.message, 'sign in');
assert.equal(a.name, 'AuthRequiredError');
const c = new CancelledError();
assert.equal(c.message, 'Sim cancelled.');
assert.equal(c.capped, false);
assert.equal(new CancelledError({ capped: true }).capped, true);
assert.ok(c instanceof Error && !(c instanceof AuthRequiredError));
console.log('errors_test: ok');

// The bug report link carries the error, build, sim and browser, and nothing else.
const doc = { querySelector: () => ({ content: 'abc123' }), getElementById: () => ({ textContent: '@ 3b9c125' }) };
const u = new URL(reportUrl('The sim failed: boom', doc, { userAgent: 'TestUA' }));
assert.equal(u.searchParams.get('template'), 'bug.yml');
assert.equal(u.searchParams.get('title'), 'Error: The sim failed: boom');
assert.equal(u.searchParams.get('details'), 'What failed: The sim failed: boom\nBuild: abc123\nSim: @ 3b9c125\nBrowser: TestUA');
