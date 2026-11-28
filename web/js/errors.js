// Error types the page tells apart with instanceof, instead of flags set on plain Errors.

// Warcraft Logs needs the viewer to sign in (a private report, a used-up shared quota, an expired token).
export class AuthRequiredError extends Error {
  constructor(message) { super(message); this.name = 'AuthRequiredError'; }
}

// A sim was stopped. `capped` is true when the page stopped it for running past its time limit, not the viewer.
export class CancelledError extends Error {
  constructor(message = 'Sim cancelled.', { capped = false } = {}) { super(message); this.name = 'CancelledError'; this.capped = capped; }
}
