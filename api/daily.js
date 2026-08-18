/**
 * The two things that happen without anybody pressing anything.
 *
 * Vercel calls this twice a day (see vercel.json), and the query string says
 * which round it is:
 *
 *   soon      The reminder, about an hour before the appointment. Every
 *             quarter of an hour, from GitHub Actions — Vercel's own scheduler
 *             runs a job once a day on this plan, which cannot do "an hour
 *             before" for appointments spread across a working day.
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

const { db, readConfig, withNewSchema, markJobRun } = require('./_lib/db');
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

async function runDailyJob(job) {
  const sql = db();
  const config = await readConfig();
  const today = shopDate(0);

  // The one that runs through the day, and does nothing at all most times it
  // runs. See sendReminders() for what it is actually for.
  if (job === 'soon') {
    const nudged = await sendReminders(sql, config, today, soonCutoff());
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
 * The job runs every quarter of an hour, so in practice this fires between
 * forty-five and sixty minutes before. A late run fires later and still fires.
 *
 * Two hours of age, because somebody who booked twenty minutes ago does not
 * need reminding of it: they would have a confirmation and a reminder in the
 * same hour, which reads as a shop that has lost track of itself. A customer
 * who books within two hours of their own appointment gets no reminder, and
 * does not need one.
 */
const SOON_MINUTES = 60;
const SETTLED_HOURS = 2;

/** 'HH:MM' an hour from now, or '23:59' if that would pass midnight. */
function soonCutoff(at) {
  const [h, m] = shopTime(at).split(':').map(Number);
  const minutes = h * 60 + m + SOON_MINUTES;
  if (minutes >= 24 * 60) return '23:59';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Everybody in today's diary who left an address and has not been told yet.
 *
 * With no `until`, this is the morning run: everyone booked in today.
 *
 * With one, it is the run that goes through the day every quarter of an hour —
 * and its whole purpose is the hole the morning run leaves. A customer who
 * books at ten past ten for four o'clock gets no reminder at all, because the
 * morning run happened an hour before they existed. That is not a rare case;
 * it is most of a barber shop's day.
 *
 * Both write the same `reminded_at`, which is what stops anybody getting two.
 * The morning run has already marked everything it saw, so this one can only
 * ever find bookings made after it — exactly the ones it is for.
 */
async function sendReminders(sql, config, today, until) {
  const rows = await withNewSchema(() => sql`
    SELECT id, booked_at, service, barber, customer_name, email, lang
      FROM bookings
     WHERE booked_on = ${today}
       AND status = 'active'
       AND email <> ''
       AND reminded_at IS NULL
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
      cancelToken: cancelToken(row.id)
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
module.exports.isTheCron = isTheCron;
