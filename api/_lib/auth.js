/**
 * The admin password, and the delay that makes guessing it pointless.
 *
 * Same shape as the Apps Script it replaces: the password lives only in the
 * environment, the panel sends it with every write, and the answer is checked
 * here. Nothing about it ships to the browser.
 */

const crypto = require('crypto');

/**
 * True when the supplied password matches ADMIN_PASSWORD.
 *
 * timingSafeEqual over SHA-256 digests rather than over the passwords: the
 * digests are always the same length, so the comparison cannot leak the
 * password's length by returning early. The old hand-rolled loop compared
 * lengths first and did exactly that.
 */
function matches(expected, given) {
  const a = crypto.createHash('sha256').update(String(expected)).digest();
  const b = crypto.createHash('sha256').update(String(given)).digest();
  return crypto.timingSafeEqual(a, b);
}

function isAuthorized(payload) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;              // refuse every write until it is set
  return matches(expected, (payload && payload.password) || '');
}

/**
 * True when the supplied PIN matches REPORTS_PIN.
 *
 * A second secret, on top of the panel password, for the takings — what the
 * shop earned, and which barber brought it in. Staff sign in to the panel to
 * work the diary; this is the owner's alone.
 *
 * Checked here and not in the browser for the obvious reason: a gate the page
 * draws itself is opened by anyone who can open the developer tools, and the
 * figures would already have been sent to them.
 */
function isPinCorrect(payload) {
  const expected = process.env.REPORTS_PIN;
  if (!expected) return false;              // no PIN set, no reports
  return matches(expected, (payload && payload.pin) || '');
}

/** Whether a PIN has been set at all, so the panel can say which it is. */
const reportsPinIsSet = () => Boolean(process.env.REPORTS_PIN);

/**
 * Slow a guesser down, in proportion to how many times they have been wrong.
 *
 * Deliberately a delay and not a lockout. A lockout would let anyone shut the
 * owner out of their own panel by submitting rubbish, which is a worse day
 * than a slow login.
 *
 * The count is per-process, so a fleet of cold functions each start at zero.
 * That is a real limit and worth being honest about: this raises the cost of
 * a casual guess, it is not a defence against a determined one. The password
 * being long is what does that work.
 */
const failures = new Map();

function throttleFailedLogin(key) {
  const id = key || 'global';
  const n = (failures.get(id) || 0) + 1;
  failures.set(id, n);
  const ms = Math.min(8000, 500 * Math.pow(2, Math.min(n, 4)));
  return new Promise(resolve => setTimeout(resolve, ms));
}

function resetFailedLogins(key) {
  failures.delete(key || 'global');
}

module.exports = { isAuthorized, isPinCorrect, reportsPinIsSet,
                   throttleFailedLogin, resetFailedLogins };
