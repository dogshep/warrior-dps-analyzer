import assert from 'node:assert/strict';
import { AuthRequiredError, CancelledError } from '../web/js/errors.js';

const a = new AuthRequiredError('sign in');
assert.ok(a instanceof Error && a instanceof AuthRequiredError && !(a instanceof CancelledError));
assert.equal(a.message, 'sign in');
assert.equal(a.name, 'AuthRequiredError');
const c = new CancelledError();
assert.equal(c.message, 'Sim cancelled.');
assert.equal(c.capped, false);
assert.equal(new CancelledError('x', { capped: true }).capped, true);
assert.ok(c instanceof Error && !(c instanceof AuthRequiredError));
console.log('errors_test: ok');
