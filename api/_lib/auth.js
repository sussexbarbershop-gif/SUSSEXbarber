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
 * A second secret, on top of the panel password. Staff sign in to the panel to
 * work the diary; the takings and the shop's settings are the owner's alone.
 *
 * Checked here and not in the browser for the obvious reason: a gate the page
 * draws itself is opened by anyone who can open the developer tools, and the
 * figures would already have been sent to them.
 *
 * (The variable is still called REPORTS_PIN. It guards more than the reports
 * now, but renaming it would silently lock the owner out of their own panel on
 * the next deploy, which is not a trade worth a better name.)
 */
function isPinCorrect(payload) {
  const expected = process.env.REPORTS_PIN;
  if (!expected) return false;              // no PIN set, nothing unlocks
  return matches(expected, (payload && payload.pin) || '');
}

/** Whether a PIN has been set at all, so the panel can say which it is. */
const reportsPinIsSet = () => Boolean(process.env.REPORTS_PIN);

// ---------------------------------------------------------------------------
// Staying unlocked
// ---------------------------------------------------------------------------

/**
 * How long one PIN entry is good for. Long enough to edit the week's hours and
 * three prices without typing it again; short enough that a phone left on the
 * counter is not a way in.
 */
const UNLOCK_MINUTES = 10;

/**
 * A pass that says "this browser gave the right PIN, until then".
 *
 * The alternative was keeping the PIN itself in the browser so a refresh would
 * not ask for it again — which hands the secret to exactly the person it is
 * being kept from, since they are holding the phone. This is a signed expiry
 * instead: it cannot be read back into a PIN, it cannot be extended, and it
 * stops working on its own.
 *
 * Signed with the PIN and the password together, so changing either one
 * invalidates every pass already issued.
 */
function issueUnlockPass(now) {
  const until = (now || Date.now()) + UNLOCK_MINUTES * 60 * 1000;
  return { pass: `${until}.${signUnlock(until)}`, until };
}

function signUnlock(until) {
  const secret = String(process.env.REPORTS_PIN || '') + '|' +
                 String(process.env.ADMIN_PASSWORD || '');
  return crypto.createHmac('sha256', secret).update(String(until)).digest('hex');
}

/** True when `pass` was issued here and has not run out. */
function unlockPassIsValid(pass, now) {
  if (!process.env.REPORTS_PIN) return false;
  const [untilPart, signature] = String(pass || '').split('.');
  const until = Number(untilPart);
  if (!until || !signature) return false;
  if ((now || Date.now()) > until) return false;      // expired

  const expected = signUnlock(until);
  // Same length either way, so this cannot leak the signature a byte at a time.
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'),
                                Buffer.from(expected, 'hex'));
}

/**
 * The owner is at the keyboard: either they have just typed the PIN, or they
 * typed it within the last ten minutes and still hold the pass.
 */
function isOwner(payload) {
  if (!payload) return false;
  if (payload.pin && isPinCorrect(payload)) return true;
  return unlockPassIsValid(payload.unlockPass);
}

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

// ---------------------------------------------------------------------------
// Cancelling from the email
// ---------------------------------------------------------------------------

/**
 * A token that cancels one appointment and nothing else.
 *
 * The confirmation email used to carry no cancel link on purpose, and the
 * reasoning is still right as far as it went: a link in an email is a way in
 * that nothing else checks. What was wrong was the conclusion. A customer who
 * cannot say no easily does not book elsewhere — they simply do not turn up,
 * and the shop loses the whole slot instead of getting it back in time to sell.
 *
 * So the link exists and is made narrow instead. It carries the booking's own
 * id and a signature over it, which means it can do exactly one thing to
 * exactly one row. It is not a session, it grants nothing else, and it cannot
 * be edited into a token for somebody else's appointment.
 *
 * Signed with ADMIN_PASSWORD, the one secret always present. Changing the
 * panel password invalidates the links in emails already sent — those
 * customers see "we could not find that booking" and are told to call, which
 * is a fair outcome for a thing that happens once a year.
 */
function signCancel(id) {
  const secret = String(process.env.ADMIN_PASSWORD || '');
  return crypto.createHmac('sha256', secret)
               .update('cancel:' + String(id)).digest('hex').slice(0, 32);
}

/** The token to put in a link, or '' when there is no secret to sign with. */
function cancelToken(id) {
  if (!process.env.ADMIN_PASSWORD || !id) return '';
  return `${id}.${signCancel(id)}`;
}

/** The booking id a token stands for, or 0 if it does not stand for one. */
function bookingFromCancelToken(token) {
  if (!process.env.ADMIN_PASSWORD) return 0;
  const [idPart, signature] = String(token || '').split('.');
  const id = Number(idPart);
  // A token for booking 0, or for "1e3", or for nothing at all.
  if (!Number.isInteger(id) || id <= 0 || !signature) return 0;

  const expected = signCancel(id);
  if (signature.length !== expected.length) return 0;
  const ok = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  return ok ? id : 0;
}

module.exports = { isAuthorized, isPinCorrect, isOwner, reportsPinIsSet,
                   issueUnlockPass, unlockPassIsValid, UNLOCK_MINUTES,
                   throttleFailedLogin, resetFailedLogins,
                   cancelToken, bookingFromCancelToken };
