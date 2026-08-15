/**
 * How often one address may use the endpoints that need no password.
 *
 * The diary is the thing worth protecting, and the way to damage it is not to
 * break in — it is to book it. `MOST_PER_CUSTOMER` caps what one phone number
 * may hold, but a script that types a different number each time walks past
 * that and fills next week. It needs no skill and no tools: the form is public
 * and it is meant to be.
 *
 * Counted in Postgres and not in memory. The panel's own login throttle keeps
 * its count in a Map, and says so in its comment: on a fleet of serverless
 * functions each cold start begins at zero, so it slows a casual guess and
 * nothing more. A count that has to survive that has to live somewhere both
 * requests can see, and the database is the only such place this shop has.
 *
 * Fixed windows, not a sliding one. A burst can straddle a boundary and get
 * roughly double the allowance for a moment; a sliding window costs a second
 * query and a barber shop does not care about the difference.
 */

const { db, withNewSchema } = require('./db');

/**
 * The rules, by action. One place, so tightening them is one edit.
 *
 *   perHour   what a real customer could plausibly do in an hour
 *   perDay    what stops the hour limit being used sixteen times over
 *
 * The numbers do not have to be tight to work, and there is a reason not to
 * make them tighter than they need to be: **an address is not a person.**
 * Mobile carriers put hundreds of customers behind one of them, so two people
 * on 4G in Wassenaar can arrive here looking like one. Set these low enough
 * and a busy Saturday turns real customers away — which is the damage this was
 * written to prevent, arriving by the front door.
 *
 * So the gap is what does the work, not the ceiling. A customer books one
 * haircut; a script books hundreds. Anywhere in between is a safe place to
 * draw the line, and lower is only better up to the point where a family of
 * four on one wifi stops fitting.
 */
const RULES = {
  // One customer books one haircut. Four is a family from one address; a fifth
  // within the hour is already unusual for a shop this size.
  addBooking:    { perHour: 4,  perDay: 10 },
  // Cancelling needs the date, the time and the phone number all three.
  cancelBooking: { perHour: 5,  perDay: 15 },
  // A lookup by phone number, which is also how you would find out whether a
  // given number belongs to a customer at all.
  myBookings:    { perHour: 10, perDay: 30 },
  // On top of the delay that already grows with each wrong answer. The owner
  // mistyping their password must never be locked out of their own panel, and
  // a correct password clears the count — so this only ever counts failures.
  adminLogin:    { perHour: 8,  perDay: 30 },
  // Reading what a cancel link points at. The page asks once when it opens, so
  // a customer needs one; a token being brute-forced needs millions.
  lookupCancel:  { perHour: 15, perDay: 50 },
  cancelByLink:  { perHour: 5,  perDay: 15 }
};

/**
 * The caller's address, as Vercel reports it.
 *
 * Vercel sets both of these at the edge and overwrites whatever arrived, so
 * they cannot be forged from outside. Off Vercel — a local run — there is no
 * header and everybody shares one bucket, which is wrong but harmless: there
 * is nobody else on localhost.
 */
function callerKey(req) {
  const headers = (req && req.headers) || {};
  const forwarded = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
  return String(headers['x-real-ip'] || '').trim() || forwarded || 'unknown';
}

/** One counter, one window. Returns how many hits are now in it. */
async function bump(sql, bucket, seconds) {
  const rows = await withNewSchema(() => sql`
    INSERT INTO rate_limit (bucket, window_at, hits)
    VALUES (${bucket},
            to_timestamp(floor(extract(epoch from now()) / ${seconds}) * ${seconds}),
            1)
    ON CONFLICT (bucket, window_at)
      DO UPDATE SET hits = rate_limit.hits + 1
    RETURNING hits`);
  return Number((rows[0] || {}).hits || 0);
}

/**
 * Has this address had enough for now?
 *
 * Returns '' when the request may go ahead, or a sentence to answer with.
 *
 * **Fails open.** If the count cannot be read — the database is having a bad
 * moment, the table is mid-migration — the request is allowed and the reason
 * is logged. The other way round, one unrelated fault would turn every
 * customer away, and a shop losing real bookings to a bug it cannot see is a
 * worse day than a shop that was briefly easy to spam.
 */
async function tooMany(req, action) {
  const rule = RULES[action];
  if (!rule) return '';

  try {
    const sql = db();
    const who = callerKey(req);
    const [hour, day] = await Promise.all([
      bump(sql, `${action}:h:${who}`, 3600),
      bump(sql, `${action}:d:${who}`, 86400)
    ]);
    if (hour <= rule.perHour && day <= rule.perDay) return '';

    console.warn(`[limit] ${action} from ${who}: ${hour}/h ${day}/d`);
    // Deliberately vague about which limit, and deliberately clear about what
    // to do instead. The one person this ever reaches by accident is a real
    // customer at a busy address, and the shop's phone still works.
    return action === 'adminLogin'
      ? 'Too many attempts. Wait a while and try again.'
      : 'Too many requests from here. Please call the shop and we will book you in.';
  } catch (err) {
    console.error('[limit] could not count, allowing through:', err.message);
    return '';
  }
}

/** Forget an address's failures. Called when a login succeeds. */
async function forget(req, action) {
  try {
    const sql = db();
    const who = callerKey(req);
    await sql`DELETE FROM rate_limit WHERE bucket IN (${`${action}:h:${who}`},
                                                      ${`${action}:d:${who}`})`;
  } catch (err) {
    // Nothing depends on this. The window expires on its own.
  }
}

/**
 * Throw away windows that have passed.
 *
 * Run once a day from the cron rather than on the hot path: a DELETE on every
 * booking would be a second write for a table nobody reads twice. Two days
 * rather than one, so the daily window is never swept while it is still in use.
 */
async function sweepOldCounters(sql) {
  const rows = await withNewSchema(() => sql`
    DELETE FROM rate_limit WHERE window_at < now() - interval '2 days' RETURNING 1`);
  return rows.length;
}

module.exports = { tooMany, forget, sweepOldCounters, callerKey, RULES };
