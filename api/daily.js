/**
 * The one thing that happens without anybody pressing anything.
 *
 * Vercel calls this once each morning (see vercel.json). It does two rounds:
 *
 *   1. Reminds everybody booked in today that they are booked in today.
 *   2. Thanks everybody who came in yesterday and asks them for a review.
 *
 * Both only reach customers who left an email address, and both are sent at
 * most once — the row records when it went, and the queries only pick up rows
 * where that is still empty. That is the whole safety story: running this
 * twice, by hand or by accident, sends nothing the second time. A flag would
 * have needed exactly the same query and would not have told anyone when.
 *
 * Why one route rather than two: a Vercel Hobby account gets a small number of
 * cron jobs and one run a day each, and these are the same job — read this
 * morning's diary and send what it says to send.
 *
 * Environment:
 *   CRON_SECRET   required. Vercel sends it as `Authorization: Bearer …` on
 *                 every scheduled call once the variable exists. Without it
 *                 set, this route refuses everything, including Vercel — a
 *                 public URL that emails the whole diary is not something to
 *                 leave open while somebody remembers to configure it.
 */

const { db, readConfig, withNewColumns } = require('./_lib/db');
const rota = require('./_lib/rota');
const { sendReminder, sendReviewRequest } = require('./_lib/mail');

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

  try {
    const result = await runDailyJob();
    console.log('[daily]', JSON.stringify(result));
    return json(res, Object.assign({ status: 'success' }, result));
  } catch (err) {
    console.error('[daily]', err);
    return json(res, { status: 'error', message: 'The daily job failed. See the logs.' }, 500);
  }
};

async function runDailyJob() {
  const sql = db();
  const config = await readConfig();
  const today = shopDate(0);
  const yesterday = shopDate(-1);

  const reminded = await sendReminders(sql, config, today);
  const asked = await askForReviews(sql, config, yesterday);
  return { date: today, reminded, reviewsAsked: asked };
}

/** Everybody in today's diary who left an address and has not been told yet. */
async function sendReminders(sql, config, today) {
  const rows = await withNewColumns(() => sql`
    SELECT id, booked_at, service, barber, customer_name, email
      FROM bookings
     WHERE booked_on = ${today}
       AND status = 'active'
       AND email <> ''
       AND reminded_at IS NULL
     ORDER BY booked_at
     LIMIT ${MOST_PER_RUN}`);

  let sent = 0;
  for (const row of rows) {
    const ok = await sendReminder({
      name: row.customer_name,
      email: row.email,
      time: rota.minutesToLabel(rota.parseClock(row.booked_at)),
      service: row.service,
      barber: row.barber
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
 * Yesterday's customers, once the owner has somewhere to send them.
 *
 * `review_url` empty means this does nothing at all — not "sends an email with
 * no link in it". It was empty for a long while: the shop's Google listing was
 * created by somebody else years ago and getting it back took weeks.
 *
 * Nothing is backfilled when it is finally filled in. The query only ever
 * looks at yesterday, so the first run after the link is set asks yesterday's
 * customers and nobody else — rather than emailing every customer the shop has
 * ever had, on the same morning, from a domain with no sending history. That
 * is how a domain gets marked as spam, and it would take the booking
 * confirmations down with it.
 */
async function askForReviews(sql, config, yesterday) {
  const reviewUrl = String((config.settings || {}).review_url || '').trim();
  if (!reviewUrl) return 0;

  const rows = await withNewColumns(() => sql`
    SELECT id, booked_at, service, barber, customer_name, email
      FROM bookings
     WHERE booked_on = ${yesterday}
       AND status = 'active'
       AND email <> ''
       AND review_asked_at IS NULL
     ORDER BY booked_at
     LIMIT ${MOST_PER_RUN}`);

  let sent = 0;
  for (const row of rows) {
    const ok = await sendReviewRequest({
      name: row.customer_name,
      email: row.email,
      service: row.service,
      barber: row.barber
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
module.exports.isTheCron = isTheCron;
