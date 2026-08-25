/**
 * The two things that happen without anybody pressing anything.
 *
 * Vercel calls this twice a day (see vercel.json), and the query string says
 * which round it is:
 *
 *   soon      The reminder, an hour or two before the appointment. Asked for
 *             every quarter of an hour from GitHub Actions — Vercel's own
 *             scheduler runs a job once a day on this plan, which cannot do
 *             "before the appointment" for a day full of them. Asked for, not
 *             delivered: GitHub starts a fraction of those, so the round has
 *             to survive being late, and how it does is the longest comment in
 *             this file. See LEAST_MINUTES_AHEAD.
 *   evening   Thanks everybody who came in today and asks them for a review,
 *             sweeps the rate-limit counters, and counts anything the reminder
 *             round should have caught and did not.
 *
 * There was a third, at nine in the morning, reminding everybody booked in
 * that day. It is gone: two emails for one haircut is one more than anybody
 * wants, and an hour before is when a reminder is actually read.
 *
 * A review is only worth asking for while the haircut is still fresh — the
 * same evening, a customer remembers it and has their phone in their hand; by
 * tomorrow it is one more thing in an inbox. That round gets one chance a day,
 * after closing, which is why it asks about the whole day rather than watching
 * the clock.
 *
 * Both only reach customers who left an email address, and both are sent at
 * most once — the row records when it went, and the queries only pick up rows
 * where that is still empty. That is the whole safety story: running either
 * twice, by hand or by accident, sends nothing the second time. A flag would
 * have needed exactly the same query and would not have told anyone when.
 *
 * Environment:
 *   CRON_SECRET   required. Vercel sends it as `Authorization: Bearer …` on
 *                 every scheduled call once the variable exists. Without it
 *                 set, this route refuses everything, including Vercel — a
 *                 public URL that emails the whole diary is not something to
 *                 leave open while somebody remembers to configure it.
 */

const { db, readConfig, withNewSchema, getCancelKey,
        markJobRun, minutesSinceJobRun } = require('./_lib/db');
const rota = require('./_lib/rota');
const { sendReminder, sendReviewRequest } = require('./_lib/mail');
const { sweepOldCounters } = require('./_lib/limits');
const { cancelToken } = require('./_lib/auth');

const SHOP_TZ = process.env.SHOP_TIMEZONE || 'Europe/Amsterdam';

/** The shop's date, not the server's. Vercel runs in UTC. */
function shopDate(offsetDays) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());                       // en-CA gives YYYY-MM-DD
  if (!offsetDays) return parts;
  const at = new Date(parts + 'T00:00:00Z');
  return new Date(at.getTime() + offsetDays * 86400000).toISOString().slice(0, 10);
}

/** The shop's clock, as 'HH:MM'. */
function shopTime(at) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: SHOP_TZ, hour: '2-digit', minute: '2-digit', hour12: false
  }).format(at || new Date());
}

/**
 * How long after an appointment before asking what they thought of it.
 *
 * The evening run happens after closing, so in practice every appointment that
 * day already qualifies. The gap is here for the run that fires early — a
 * schedule edited, a job triggered by hand at four in the afternoon — where
 * without it the shop would be asking a customer for a review of a haircut
 * they are still sitting in.
 */
const HOURS_BEFORE_ASKING = 2;

/**
 * The latest appointment time that has been over long enough, as 'HH:MM'.
 *
 * Worked out here rather than in SQL because Postgres wraps `time` arithmetic
 * round midnight: at one in the morning, `now()::time - interval '2 hours'`
 * is 23:00, and a query written that way would quietly match the whole day.
 */
function askingCutoff(at) {
  const [h, m] = shopTime(at).split(':').map(Number);
  const minutes = h * 60 + m - HOURS_BEFORE_ASKING * 60;
  if (minutes <= 0) return '00:00';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * A ceiling on one run.
 *
 * This shop takes a handful of bookings a day, so the cap is never reached in
 * normal use. It is here for the run that follows a mistake — a restored
 * backup, a date typed wrong — where the difference between a bug and a
 * disaster is whether the loop stops.
 */
const MOST_PER_RUN = 200;

function json(res, body, status) {
  res.status(status || 200);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(JSON.stringify(body));
}

/**
 * Vercel's own call, or the owner's.
 *
 * Vercel attaches `Authorization: Bearer $CRON_SECRET` to a scheduled request
 * as long as CRON_SECRET is set on the project. The header is the only thing
 * checked: `x-vercel-cron` looks like it would do, but "a header Vercel
 * happens to set" is not the same as "a header nobody else can set", and this
 * route can send email to every customer in the diary.
 */
function isTheCron(req) {
  const secret = String(process.env.CRON_SECRET || '');
  if (!secret) return false;
  const header = String((req.headers && req.headers.authorization) || '');
  return header === `Bearer ${secret}`;
}

module.exports = async function handler(req, res) {
  if (!process.env.CRON_SECRET) {
    return json(res, {
      status: 'error',
      message: 'No CRON_SECRET set on the server. Add it in Vercel > Settings > Environment Variables.'
    }, 503);
  }
  if (!isTheCron(req)) return json(res, { status: 'error', message: 'Unauthorized' }, 401);

  // Which round. Anything else runs both, which is what a run by hand wants.
  const job = String(((req.query || {}).job) || '').trim();

  try {
    const result = await runDailyJob(job);
    console.log('[daily]', JSON.stringify(result));
    return json(res, Object.assign({ status: 'success' }, result));
  } catch (err) {
    console.error('[daily]', err);
    return json(res, { status: 'error', message: 'The daily job failed. See the logs.' }, 500);
  }
};

async function runDailyJob(job, silentFor) {
  const sql = db();
  const config = await readConfig();
  const today = shopDate(0);

  // The one that runs through the day, and does nothing at all most times it
  // runs. See sendReminders() for what it is actually for.
  if (job === 'soon') {
    // How long since the last round, which decides how far ahead this one
    // looks. The stand-in already knows — it reads the row to decide whether
    // to wake at all, and the claim it makes overwrites the answer — so it
    // hands the number over rather than making this ask a question that can no
    // longer be answered truthfully.
    const quiet = silentFor === undefined ? await minutesSinceJobRun('soon') : silentFor;
    const nudged = await sendReminders(sql, config, today, shopTime(),
                                       soonCutoff(null, quiet));
    // Recorded whoever set this off — GitHub's clock, the button, or an
    // ordinary visitor standing in for both. The stand-in only wakes up when
    // this timestamp has gone stale, so it has to be written here rather than
    // wherever the request came from.
    await markJobRun('soon');
    return { job, date: today, reminded: nudged, reviewsAsked: 0, countersSwept: 0 };
  }

  // Today, not yesterday. A customer asked the same evening still remembers
  // the haircut and has their phone in their hand; by tomorrow it is one more
  // thing in an inbox.
  const asked = await askForReviews(sql, config, today, askingCutoff());
  // The rate limiter writes a row per address per window and reads none of
  // them twice. Cleared here rather than on the way in: a DELETE on every
  // booking is a second write for nothing.
  const swept = await sweepOldCounters(sql);
  // And a look back over the day, because every reminder now comes from a
  // scheduler that is not Vercel's. See missedReminders().
  const missed = await missedReminders(sql, today);
  return { job: job || 'evening', date: today, reviewsAsked: asked,
           countersSwept: swept, remindersMissed: missed };
}

/**
 * How far ahead the reminder looks, and how long a booking has to have been
 * sitting there before it counts.
 *
 * An hour, because that is when a reminder is worth reading: early enough to
 * set off, late enough that it is still the thing you are about to do. There
 * was a nine-in-the-morning round as well, and it was dropped — two emails for
 * one haircut is one more than anybody wants, and the shop would rather the
 * one it sends be the useful one.
 *
 * An hour is right while the clock is keeping time. It is wrong the moment it
 * is not, and this window is where that stops being a delay and becomes a
 * customer nobody wrote to.
 *
 * The hole is worth spelling out, because it is not the obvious one. A round
 * at 10:30 covers 10:30 to 11:30. If the next round is at 12:23, it covers
 * 12:23 onwards — and an appointment at 12:00 was too far off for the first
 * and already past for the second. Nothing retries it: by tomorrow the
 * appointment has happened, so the query cannot pick it up again. One silence
 * longer than this window is one customer who is simply never told.
 *
 * That is not hypothetical. nudge.yml asks GitHub for forty-eight runs a day;
 * across 18-25 August it started between six and eleven, with gaps of 54 to
 * 176 minutes. The first run of the day landed at 10:30 shop time more than
 * once, which is after the shop opens — so the first appointment of the day
 * was the one most reliably missed.
 *
 * The first answer was to widen the window to match the silence behind it. It
 * helps and it is not enough, and the reason is worth keeping: the silence
 * behind a round says nothing about the silence in front of it. Replaying the
 * real start times, 19 August had a round at 13:58 whose previous gap was a
 * healthy 57 minutes — so it looked one hour ahead, to 14:58 — and then
 * nothing came for 130 minutes. Three o'clock, half past and four fell in the
 * hole anyway. A backward-looking window cannot see a gap coming.
 *
 * So there is a floor as well, and the floor is the part that does the work.
 * Every round looks at least two hours ahead whatever the clock has been
 * doing, and further when it has already been quiet longer than that. The
 * numbers come from replaying those eight days against the shop's own half-
 * hourly slots, with no visitor ever standing in — the worst case there is:
 *
 *     looking ahead      never reminded     average notice
 *        60 min            25 of 136           70 min
 *       120 min            10 of 136           84 min
 *       180 min             5 of 136          114 min
 *
 * Two hours is where the curve turns. It removes three fifths of the misses
 * for fourteen minutes of notice; going on to three hours buys five more and
 * costs half an hour, which is the point where "about an hour before" stops
 * being a fair description of what the shop is sending.
 *
 * The five that survive at any width are the same five: an appointment at ten
 * o'clock on a day whose first round did not arrive until after ten. No window
 * reaches backwards. Those are the stand-in's to catch — one visitor before
 * opening is enough — and nothing else can.
 *
 * The cost, then, is a reminder that lands an hour and a half before instead
 * of an hour. The thing bought with it is that it lands at all.
 *
 * Two hours of age, because somebody who booked twenty minutes ago does not
 * need reminding of it: they would have a confirmation and a reminder in the
 * same hour, which reads as a shop that has lost track of itself. A customer
 * who books within two hours of their own appointment gets no reminder, and
 * does not need one.
 */
const LEAST_MINUTES_AHEAD = 120;
const MOST_MINUTES_AHEAD = 180;
const SETTLED_HOURS = 2;

/**
 * How far ahead this round should look, given how long the last one was ago.
 *
 * Two hours whatever has happened, because the next gap is unknowable and a
 * gap wider than the window is a customer nobody writes to. Wider when the
 * clock has already been quiet longer than that, since a silence of two and a
 * half hours behind is the best evidence there is of one ahead. Capped, or the
 * first round after a night off becomes a ten o'clock email about a six
 * o'clock haircut.
 *
 * Unknown reads as the floor, not as alarm: a database with no row yet has no
 * appointments in it either.
 */
function minutesAhead(silentFor) {
  const silence = Number(silentFor);
  if (!Number.isFinite(silence)) return LEAST_MINUTES_AHEAD;
  return Math.min(MOST_MINUTES_AHEAD, Math.max(LEAST_MINUTES_AHEAD, Math.round(silence)));
}

/** 'HH:MM' two hours from now — further if the clock has been quiet — or '23:59'. */
function soonCutoff(at, silentFor) {
  const [h, m] = shopTime(at).split(':').map(Number);
  const minutes = h * 60 + m + minutesAhead(silentFor);
  if (minutes >= 24 * 60) return '23:59';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Everybody in today's diary who left an address and has not been told yet.
 *
 * With no `until`, this is the morning run: everyone booked in today.
 *
 * With one, it is the run that goes through the day — asked for every quarter
 * of an hour, arriving rather less often than that, which is what
 * minutesAhead() is about. Its whole purpose is the hole the morning run
 * leaves behind it: a customer who books at ten past ten for four o'clock gets
 * no reminder at all, because the morning run happened an hour before they
 * existed. That is not a rare case; it is most of a barber shop's day.
 *
 * Both write the same `reminded_at`, which is what stops anybody getting two.
 * The morning run has already marked everything it saw, so this one can only
 * ever find bookings made after it — exactly the ones it is for.
 */
/**
 * The reminders due now.
 *
 * The clock is passed in, and it is not decoration. This round is asked for
 * every quarter of an hour; measured over 18-25 August 2026 GitHub started it
 * six to eleven times a day, leaving gaps of a hundred minutes and more — 176
 * between one pair, and the whole night between the last of one day and the
 * first of the next. Without a lower bound the first run after a gap picks up
 * every appointment it missed and tells those customers their haircut is
 * shortly, having already happened. The worst case here is not a late email,
 * it is a wrong one.
 *
 * So the window has both ends. The floor is now: an appointment that has
 * already started is left alone, which is the honest answer — there is nothing
 * useful left to say about it. The ceiling is minutesAhead(), which is the
 * other half of the same problem and has the reasoning.
 */
async function sendReminders(sql, config, today, from, until) {
  const rows = await withNewSchema(() => sql`
    SELECT id, booked_at, service, barber, customer_name, email, lang
      FROM bookings
     WHERE booked_on = ${today}
       AND status = 'active'
       AND email <> ''
       AND reminded_at IS NULL
       -- Still to come. See the note above the function: this is what stops a
       -- round that ran late from emailing somebody about a haircut they have
       -- already had.
       AND booked_at >= ${from}::time
       -- Null on the morning run, when the whole day is wanted.
       --
       -- Cast, rather than left to Postgres to work out. A parameter arrives
       -- over the wire with no type on it, and comparing a time column to one
       -- is the kind of thing that resolves in testing and refuses at three in
       -- the afternoon on a live database.
       AND (${until || null}::text IS NULL OR booked_at <= ${until || null}::time)
       AND (${until || null}::text IS NULL
            OR created_at < now() - make_interval(hours => ${SETTLED_HOURS}::int))
     ORDER BY booked_at
     LIMIT ${MOST_PER_RUN}`);

  // Once for the whole run, not once per row: it is the same key every time
  // and reading it is a round trip to the database.
  const cancelKey = rows.length ? await getCancelKey() : '';

  let sent = 0;
  for (const row of rows) {
    const ok = await sendReminder({
      name: row.customer_name,
      email: row.email,
      time: rota.minutesToLabel(rota.parseClock(row.booked_at)),
      service: row.service,
      barber: row.barber,
      lang: row.lang,
      // The morning of the appointment is when a customer discovers they
      // cannot come, so this is the email where saying so easily is worth the
      // most: a slot given back at nine can still be sold by two.
      cancelToken: cancelToken(row.id, cancelKey)
    }, config);
    // Marked only once it has actually gone. Marking first would mean a
    // provider having a bad five minutes costs those customers their reminder
    // for good; this way the worst case is that a send which succeeded but
    // whose row would not update gets sent twice, and nobody minds twice.
    //
    // There is no retry, and none is wanted: by tomorrow the appointment has
    // happened, so the query cannot pick it up again anyway.
    if (ok) {
      await sql`UPDATE bookings SET reminded_at = now() WHERE id = ${row.id}`;
      sent++;
    }
  }
  return sent;
}

/**
 * Anybody who should have been reminded today and was not.
 *
 * Every reminder now comes from GitHub Actions rather than from Vercel, and
 * GitHub's scheduler has a habit worth guarding against: it disables a
 * workflow in a repository that has seen no activity for sixty days. A shop
 * that is running well does not push code, so that will happen eventually —
 * and the failure is silent. Reminders would simply stop, and nobody would
 * notice until a customer said they had not had one.
 *
 * So the evening run, which is Vercel's and cannot stop the same way, counts
 * what the other one should have caught. Nothing is sent and nothing is
 * fixed — it writes a number into the log beside the rest. Zero every day
 * means the reminders are running; a day where it is not zero is the day to
 * look at GitHub.
 */
async function missedReminders(sql, today) {
  const rows = await withNewSchema(() => sql`
    SELECT count(*) AS missed
      FROM bookings
     WHERE booked_on = ${today}
       AND status = 'active'
       AND email <> ''
       AND reminded_at IS NULL
       -- Booked long enough before the appointment that a reminder was due.
       AND created_at < now() - make_interval(hours => ${SETTLED_HOURS}::int)`);
  const missed = Number((rows[0] || {}).missed || 0);
  if (missed > 0) {
    console.warn(`[daily] ${missed} bookings today were never reminded — is the GitHub Actions workflow still enabled?`);
  }
  return missed;
}

/**
 * Today's customers, a few hours after they were in, once the owner has
 * somewhere to send them.
 *
 * `review_url` empty means this does nothing at all — not "sends an email with
 * no link in it". It was empty for a long while: the shop's Google listing was
 * created by somebody else years ago and getting it back took weeks.
 *
 * Nothing is backfilled when it is finally filled in. The query only ever
 * looks at one day, so the first run after the link is set asks that evening's
 * customers and nobody else — rather than emailing every customer the shop has
 * ever had, in one go, from a domain with no sending history. That is how a
 * domain gets marked as spam, and it would take the booking confirmations down
 * with it.
 */
async function askForReviews(sql, config, today, cutoff) {
  const reviewUrl = String((config.settings || {}).review_url || '').trim();
  if (!reviewUrl) return 0;

  const rows = await withNewSchema(() => sql`
    SELECT id, booked_at, service, barber, customer_name, email, lang
      FROM bookings
     WHERE booked_on = ${today}
       AND status = 'active'
       AND email <> ''
       AND review_asked_at IS NULL
       -- Long enough after the appointment that they have left the chair.
       AND booked_at <= ${cutoff}::time
     ORDER BY booked_at
     LIMIT ${MOST_PER_RUN}`);

  let sent = 0;
  for (const row of rows) {
    const ok = await sendReviewRequest({
      name: row.customer_name,
      email: row.email,
      service: row.service,
      barber: row.barber, lang: row.lang
    }, config, reviewUrl);
    if (ok) {
      await sql`UPDATE bookings SET review_asked_at = now() WHERE id = ${row.id}`;
      sent++;
    }
  }
  return sent;
}

// Reachable by the tests, which drive the real queries against a stood-in
// database. Vercel only ever calls the default export above.
module.exports.runDailyJob = runDailyJob;
module.exports.shopDate = shopDate;
module.exports.askingCutoff = askingCutoff;
module.exports.soonCutoff = soonCutoff;
module.exports.minutesAhead = minutesAhead;
module.exports.isTheCron = isTheCron;
