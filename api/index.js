/**
 * The whole backend, on one route.
 *
 * It kept the action-based protocol the Apps Script used — same POST bodies,
 * same response shapes — so the site and the panel only had to change one line
 * each: the address they call. Rewriting the storage and the client protocol
 * in one go would have meant a failure could be in either, and the booking
 * form is the thing that must not break.
 *
 * A GET now answers only two questions: the shop's configuration, and which
 * slots are taken on a given date. Everything that names a person is a POST,
 * so no customer's number ends up in a URL.
 *
 * Environment (Vercel > Settings > Environment Variables):
 *   DATABASE_URL           the Neon connection string
 *   ADMIN_PASSWORD         the panel password
 *   NOTIFY_EMAIL           where booking notifications go
 *   BREVO_API_KEY          without it, or RESEND_API_KEY, no email is sent
 *   MAIL_FROM              the From: address; must be the verified sender
 *   BLOB_READ_WRITE_TOKEN  optional; needed only to upload images
 */

const { db, readConfig, readRotaConfig, indexToIso, WEEKDAY_NAMES,
        withNewSchema, customerFor, claimJobRun } = require('./_lib/db');
const rota = require('./_lib/rota');
const { isAuthorized, isPinCorrect, isOwner, reportsPinIsSet, issueUnlockPass,
        UNLOCK_MINUTES, throttleFailedLogin, resetFailedLogins,
        cancelToken, bookingFromCancelToken } = require('./_lib/auth');
const { readReports } = require('./_lib/reports');
const { tooMany, forget } = require('./_lib/limits');
const { sendBookingNotice, sendCustomerConfirmation, sendCancellationNotice,
        sendCustomerCancellation } = require('./_lib/mail');

/**
 * Bumped when this file changes in a way the site depends on, and reported
 * with the config. The Apps Script needed this because it only reached the
 * site when someone pasted it in by hand; here a push deploys it, so this is
 * now just a quick way to confirm which version answered.
 */
const BACKEND_VERSION = '12-neon';

/** The shop's clock, not the server's and not the visitor's. */
const SHOP_TZ = process.env.SHOP_TIMEZONE || 'Europe/Amsterdam';

/**
 * What day and time it is in the shop, whatever the server thinks.
 *
 * Vercel runs in UTC. The Apps Script ran in the project's own timezone, which
 * was Amsterdam, and every "is this in the past" check quietly depended on
 * that. Moving to UTC without this would push the notice cutoff an hour or two
 * out and start refusing slots that are perfectly bookable.
 */
function shopNow(at) {
  const now = at || new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SHOP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function json(res, body, status) {
  res.status(status || 200);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // The diary changes by the minute; a cached answer would offer a slot that
  // has just gone.
  res.setHeader('Cache-Control', 'no-store');
  res.send(JSON.stringify(body));
}

/**
 * The POST body, however it arrived.
 *
 * The front end sends JSON with a text/plain content type — a habit from the
 * Apps Script days, where it avoided a CORS preflight the script could not
 * answer. Vercel only parses application/json, so text/plain arrives as a
 * string and has to be parsed here. Left as is rather than changed on both
 * sides at once: one moving part at a time.
 */
function readBody(req) {
  const raw = req.body;
  if (raw == null) return {};
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  try { return JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); }
  catch (err) { return {}; }
}

const trimmed = v => String(v == null ? '' : v).trim();

/** Last nine digits, so 06…, +316… and 00316… are one customer. */
const phoneKey = v => {
  const digits = trimmed(v).replace(/\D/g, '');
  return digits.length > 9 ? digits.slice(-9) : digits;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Did this request come from one of our own pages?
 *
 * A browser sets Origin on a cross-origin POST and Referer on a same-origin
 * one, and neither can be set by a page on another site — so this is a fair
 * test of "a visitor is reading the shop's website". It is not a fair test of
 * "a person is not lying to us": anyone writing the request by hand writes the
 * header too. Used only where forging it buys nothing worth having.
 */
function isOwnOrigin(req) {
  const headers = (req && req.headers) || {};
  const from = headers.origin || headers.referer || '';
  if (!from) return false;
  let host;
  try { host = new URL(from).host; } catch (err) { return false; }
  // The site answers on its own domain, on the vercel.app address, and on the
  // per-deployment previews.
  return host === headers.host ||
         host === 'sussexbarber.nl' ||
         /(^|\.)sussexbarber\.nl$/.test(host) ||
         /\.vercel\.app$/.test(host);
}

// ---------------------------------------------------------------------------

/**
 * The reminders' second clock: the shop's own visitors.
 *
 * Every reminder this shop sends is set off by a GitHub Actions schedule, and
 * GitHub disables a scheduled workflow in a repository that has seen no
 * activity for sixty days. A barber shop that is running well never pushes
 * code. So the reminders were always going to stop on a date nobody had
 * written down, and come back only once somebody noticed and pressed Enable.
 * The owner's answer to that was the right one: they should not have to.
 *
 * So the site stands in. A visitor loading the page is already talking to this
 * function; if the round is overdue, their request sets it off as well as
 * doing its own job. That needs no account, no token, no second service and
 * nothing that expires — the three things every other fix here would have
 * needed, and each of them is its own future morning of it not working.
 *
 * Four things keep it from costing anything:
 *
 *   - STALE_MINUTES is thirty, and GitHub runs every fifteen. While that is
 *     working the row is never stale and this never fires once.
 *   - Only inside the hours the workflow covers, so a visitor at midnight
 *     never pays for it and nobody is emailed at an hour they would mind.
 *   - At most one look per lambda per CHECK_EVERY, so a busy afternoon does
 *     not put a query on the end of every request.
 *   - claimJobRun() is a single conditional UPDATE, so ten requests at once
 *     produce one round, not ten.
 *
 * It is awaited rather than left running after the response. Work started and
 * not waited for on a serverless function is work that may be frozen halfway,
 * and half a round is emails sent with nothing recording that they were. One
 * request every half hour waits for a query that usually matches no rows;
 * that is the whole price.
 */
const STALE_MINUTES = 30;
const CHECK_EVERY_MS = 5 * 60 * 1000;
const COVERED_HOURS = [6, 17];           // UTC, matching .github/workflows/nudge.yml
let lastLookedAt = 0;

async function standInForTheClock() {
  const now = Date.now();
  if (now - lastLookedAt < CHECK_EVERY_MS) return;
  lastLookedAt = now;

  const hour = new Date(now).getUTCHours();
  if (hour < COVERED_HOURS[0] || hour > COVERED_HOURS[1]) return;

  try {
    if (!await claimJobRun('soon', STALE_MINUTES)) return;
    console.warn('[daily] no reminder round in %d minutes — the site is standing in. ' +
                 'Is the GitHub Actions workflow still enabled?', STALE_MINUTES);
    const { runDailyJob } = require('./daily');
    console.log('[daily]', JSON.stringify(await runDailyJob('soon')));
  } catch (err) {
    // Never the visitor's problem. They asked for opening hours.
    console.error('[daily] the stand-in round failed', err);
  }
}

module.exports = async function handler(req, res) {
  try {
    // Before the response, not after: see standInForTheClock(). It returns
    // immediately unless the reminders have actually stopped.
    if (req.method === 'GET') await standInForTheClock();
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    return json(res, { status: 'error', message: 'Method not allowed' }, 405);
  } catch (err) {
    console.error('[api]', err);
    // "Not set up yet" and "crashed" are different problems and the owner has
    // to be able to tell them apart. Naming a missing environment variable
    // gives an attacker nothing — they cannot set it — and saves the one
    // person who can from reading logs to find out.
    const missing = /is not set/.test(String(err.message || ''));
    return json(res, {
      status: 'error',
      message: missing ? err.message : 'Something went wrong on our side.'
    }, missing ? 503 : 500);
  }
};

// Reachable by the tests, which drive the real rules rather than a copy of
// them. Vercel only ever calls the default export above.
module.exports.refuseBooking = (config, payload, byShop) =>
  refuseBooking(config, payload, byShop);
module.exports.addBooking = (payload, res, byShop) => addBooking(payload, res, byShop);
module.exports.shopNow = shopNow;
module.exports.isOwnOrigin = isOwnOrigin;

// ---- GET ------------------------------------------------------------------

/**
 * The two questions a visitor's browser may ask: what the shop is, and which
 * slots on one date are already taken.
 *
 * Deliberately short. Anything naming a person is a POST, so no customer's
 * phone number is ever sitting in a URL, a browser history or a server log.
 */
async function handleGet(req, res) {
  const q = req.query || {};
  const action = trimmed(q.action);

  if (action === 'getConfig' || action === 'getSettings') {
    const config = await readConfig();
    config.status = 'success';
    config.backendVersion = BACKEND_VERSION;
    // The shop's date, so nothing downstream has to work it out from a device
    // clock. The panel was calling half past midnight in Amsterdam "yesterday",
    // which put the Today filter on the wrong day and marked tomorrow's
    // appointments as past.
    config.today = shopNow().date;
    return json(res, config);
  }

  // Availability for one date: the slots that are NOT bookable, which is what
  // the browser greys out.
  const dateParam = trimmed(q.date);
  if (dateParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) return json(res, []);
    const wanted = trimmed(q.barber);
    const sql = db();
    const [config, rows] = await Promise.all([
      readRotaConfig(),
      sql`SELECT booked_at, barber FROM bookings
           WHERE booked_on = ${dateParam} AND status = 'active'`
    ]);

    const takenBy = {};
    rows.forEach(r => {
      const label = rota.minutesToLabel(rota.parseClock(r.booked_at));
      (takenBy[label] = takenBy[label] || []).push(trimmed(r.barber));
    });

    const unavailable = [];
    Object.keys(takenBy).forEach(label => {
      if (!rota.isSlotFree(config, dateParam, label, takenBy[label], wanted)) {
        unavailable.push(label);
      }
    });

    // Slots today that have already gone. The browser hides these itself, but
    // from the visitor's own clock — a phone set wrong, or a customer in
    // another timezone, would still be shown them.
    //
    // `past=1` leaves them in, for the panel: the shop is allowed to write
    // down an appointment that has already started, and greying out the whole
    // morning would make the one thing this is for impossible. It is not a
    // way in — nothing is written by a GET, and the write still checks the
    // password. All it discloses is which of this morning's slots had no
    // booking, which the shop window shows anyone walking past.
    const now = shopNow();
    if (dateParam === now.date && trimmed(q.past) !== '1') {
      const cutoff = now.minutes + rota.MIN_NOTICE_MINUTES;
      const day = rota.hoursForDay(config, dateParam);
      if (day && day.open === true) {
        const open = rota.parseClock(day.from);
        const close = rota.parseClock(day.to);
        if (open !== null && close !== null) {
          for (let t = open; t + rota.SLOT_MINUTES <= close; t += rota.SLOT_MINUTES) {
            if (t >= cutoff) break;
            const label = rota.minutesToLabel(t);
            if (unavailable.indexOf(label) === -1) unavailable.push(label);
          }
        }
      }
    }

    // `slots=1` asks for the times that exist as well as the ones that are
    // gone, and answers an object rather than a bare array so nothing that
    // reads the old shape has to change.
    //
    // The website works the first list out for itself — it has the opening
    // hours already and a round trip per calendar square would be absurd — and
    // rota-agreement.test.js exists to keep that copy honest against this one.
    // The panel does not get a copy. A third would be a third thing to keep in
    // step, and the failure when it drifts is silent: a time offered that the
    // server will refuse, discovered with a customer on the phone.
    if (trimmed(q.slots) === '1') {
      return json(res, {
        slots: rota.slotsForDate(config, dateParam, wanted,
                                 trimmed(q.past) === '1' ? '' : now.date, now.minutes),
        unavailable
      });
    }

    return json(res, unavailable);
  }

  // Nothing else is public. A bare GET used to hand the whole diary — every
  // customer's name and number — to anyone with the URL, and the URL is in the
  // page source of a public website.
  return json(res, []);
}

// ---- POST -----------------------------------------------------------------

/**
 * Everything else, dispatched on `action`.
 *
 * Three levels of who may call what: open to anyone (booking, cancelling),
 * behind the panel password (the diary, the shop's content), and behind the
 * owner's PIN as well (the takings, the prices, the hours). Each handler
 * states its own; there is no table of permissions to fall out of step with
 * the code.
 */
async function handlePost(req, res) {
  const payload = readBody(req);

  // Both spellings settled here rather than at the two places that used to
  // read them. A missing action means a booking — the site has posted one that
  // way since the Apps Script — and `cancel` is the older name for
  // `cancelBooking`. Left as they were, the limiter below would have counted
  // `addBooking` and waved through the same request sent with no action at
  // all, which is a rate limit with the door held open beside it.
  let action = trimmed(payload.action) || 'addBooking';
  if (action === 'cancel') action = 'cancelBooking';

  // How much one address may do, counted in the database so it survives the
  // cold start that resets everything else. Only the four actions that need no
  // password are counted: the shop working the panel is signed in, and rate
  // limiting the people who run the shop is how a busy Saturday turns into a
  // panel that will not take a booking.
  //
  // First, before any of these does any work — a limit applied after the query
  // has already run has not saved the database anything.
  const enough = await tooMany(req, action);
  if (enough) return json(res, { status: 'error', message: enough }, 429);

  if (action === 'adminLogin') {
    if (!process.env.ADMIN_PASSWORD) {
      return json(res, { status: 'error', message: 'No ADMIN_PASSWORD set on the server' });
    }
    if (isAuthorized(payload)) {
      resetFailedLogins();
      // The owner signing in correctly is not a suspect. Without this, a long
      // day of the shop opening the panel on the same wifi would eventually
      // reach a limit meant for somebody guessing.
      await forget(req, 'adminLogin');
      return json(res, { status: 'success' });
    }
    await throttleFailedLogin();
    return json(res, { status: 'error', message: 'Invalid username or password' });
  }

  if (action === 'allBookings') {
    if (!isAuthorized(payload)) {
      await throttleFailedLogin();
      return json(res, { status: 'error', message: 'Unauthorized' }, 401);
    }
    const sql = db();
    // No price. This is the diary, and everyone who works the diary signs in
    // with the same password; what the shop took is behind the PIN, in
    // reports. Nothing in the panel needs a price to run a day's work.
    //
    // created_at comes with it so the panel can put the booking that arrived
    // most recently at the top, which is the one nobody has seen yet.
    const rows = await withNewSchema(() => sql`
      SELECT id,
             to_char(booked_on, 'YYYY-MM-DD') AS booked_on,
             booked_at, service, barber, customer_name, phone, email, source,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
        FROM bookings WHERE status = 'active'
       ORDER BY booked_on, booked_at`);
    return json(res, rows.map(r => ({
      id: r.id,
      date: r.booked_on,
      time: rota.minutesToLabel(rota.parseClock(r.booked_at)),
      service: r.service,
      barber: r.barber,
      name: r.customer_name,
      phone: r.phone,
      // Whether there is an address to reach them on, not the address itself.
      // The panel only needs to show whether a reminder can go out; handing
      // every customer's email to every screen the diary is open on is a
      // larger thing to leak than it looks, and nothing here uses it.
      hasEmail: !!String(r.email || '').trim(),
      source: r.source || 'web',
      bookedAt: r.created_at
    })));
  }

  // One page view, counted.
  //
  // A GET that anybody could hold down: it was a public endpoint whose whole
  // job was to increment a number, so a loop could put the visit count into
  // the millions in an afternoon and the "visits that booked" figure with it.
  //
  // A POST from our own pages now. That does not make it unforgeable — a
  // header can be typed by anyone who wants to — but it stops crawlers, link
  // previewers and anything casual, which is what was actually inflating it.
  // The figure was never precise enough to defend harder than that.
  if (action === 'trackVisit') {
    if (!isOwnOrigin(req)) return json(res, { status: 'success', visits: null });
    const sql = db();
    const rows = await sql`
      INSERT INTO settings (key, value) VALUES ('visit_count', '1')
      ON CONFLICT (key) DO UPDATE
        SET value = (COALESCE(NULLIF(settings.value, '')::bigint, 0) + 1)::text
      RETURNING value`;
    return json(res, { status: 'success', visits: Number(rows[0].value) });
  }

  // A customer finding their own appointments. Unauthenticated by design — the
  // phone number is the only thing they have — but a POST rather than a GET,
  // so the number is not left in browser history, in a referrer, or in the
  // access log of every proxy between here and them.
  if (action === 'myBookings') {
    const key = phoneKey(payload.phone);
    if (!key) return json(res, []);
    const sql = db();
    const today = shopNow().date;
    const rows = await sql`
      SELECT to_char(booked_on, 'YYYY-MM-DD') AS booked_on,
             booked_at, service, barber, customer_name, phone
        FROM bookings
       WHERE phone_key = ${key} AND status = 'active' AND booked_on >= ${today}
       ORDER BY booked_on, booked_at`;
    return json(res, rows.map(r => ({
      date: r.booked_on,
      time: rota.minutesToLabel(rota.parseClock(r.booked_at)),
      service: r.service,
      barber: r.barber,
      name: r.customer_name,
      phone: r.phone
    })));
  }

  if (action === 'addBooking') return await addBooking(payload, res, false);

  // The shop writing a booking down itself — someone on the phone, or standing
  // at the counter.
  //
  // The panel password, not the PIN. Taking a booking *is* the work: a barber
  // who answers the phone has to be able to write it in, and putting the
  // owner's PIN in front of that would mean ringing the owner to book a
  // haircut. The PIN guards what the shop *is* — its prices, its hours, its
  // takings — not its diary.
  //
  // Everything below this line is the same code the public form runs: the
  // rota, the one-chair index, the shop's own order for a booking that names
  // nobody, the service list the price is read from. Only the two rules that
  // exist because the form is public and anonymous are lifted, and
  // refuseBooking says why at each of them. A second way to write a row would
  // have been a second set of rules to keep in step, and they would not have
  // stayed in step.

  // The reminders, run off the panel being open.
  //
  // They are meant to come from a scheduler, and the scheduler is the part
  // that does not work. GitHub Actions runs this every quarter of an hour on
  // paper; in practice it did not run once in twelve hours across two
  // schedules, which is behaviour GitHub documents rather than a fault — the
  // schedule event "can be delayed during periods of high load" and at peak
  // times "may not run at all". For something that has to happen an hour
  // before an appointment, best-effort is not a schedule.
  //
  // So the panel carries it as well. That is not a workaround dressed up: the
  // panel is open behind the counter through exactly the hours reminders are
  // wanted, and a shop with nobody looking at the diary has no appointments
  // to remind anybody about. The two triggers are independent and neither
  // knows about the other; whichever arrives first does the work, and the
  // second finds the rows already marked and sends nothing.
  //
  // The panel password, not CRON_SECRET: the browser must never hold that,
  // and this action can do nothing the panel cannot already do.
  if (action === 'runReminders') {
    if (!isAuthorized(payload)) {
      await throttleFailedLogin();
      return json(res, { status: 'error', message: 'Unauthorized' }, 401);
    }
    const { runDailyJob } = require('./daily');
    const result = await runDailyJob('soon');
    return json(res, Object.assign({ status: 'success' }, result));
  }
  if (action === 'addBookingByShop') {
    if (!isAuthorized(payload)) {
      await throttleFailedLogin();
      return json(res, { status: 'error', message: 'Unauthorized' }, 401);
    }
    return await addBooking(payload, res, true);
  }

  if (action === 'cancelBooking') return await cancelBooking(payload, res);

  // The link in a confirmation email, in two halves.
  //
  // It is two and not one because of what reads email before a person does.
  // Antivirus gateways, link scanners and inbox previewers fetch every URL in
  // a message to see where it goes — so a link that cancelled on being opened
  // would cancel appointments that nobody ever clicked, and the customer would
  // arrive to find their slot gone. `lookupCancel` only reads, `cancelByLink`
  // only acts, and nothing acts until somebody presses a button on a page.
  if (action === 'lookupCancel') return await lookupCancel(payload, res);
  if (action === 'cancelByLink') return await cancelByLink(payload, res);

  // The takings. Behind the panel password and a second PIN, because the
  // people who use the panel to run the diary are not necessarily the person
  // who is allowed to see what the shop earned.
  // Everything below is the owner's, not the floor's: the takings, the prices,
  // the opening hours, the staff. Whoever holds the panel password can run the
  // diary; changing what the shop *is* takes the PIN as well.
  //
  // Enforced here and not by hiding the pages. The panel could hide every one
  // of them and a hand-written request would still have saved a new price
  // list, because the only thing that had ever been checked was the password
  // every barber knows.
  if (['reports', 'unlock', 'saveCMS', 'uploadImage', 'uploadAppIcon'].includes(action)) {
    if (!isAuthorized(payload)) {
      await throttleFailedLogin();
      return json(res, { status: 'error', message: 'Unauthorized' }, 401);
    }
    if (!reportsPinIsSet()) {
      return json(res, {
        status: 'error',
        message: 'No REPORTS_PIN set on the server. Add it in Vercel > Settings > Environment Variables.'
      }, 503);
    }
    if (!isOwner(payload)) {
      // Same delay as a wrong password. A PIN is four or six digits, which is
      // little enough to sit and guess at machine speed otherwise.
      //
      // `locked` tells the panel this was the PIN and not the password, so it
      // can put the keypad back up rather than sending the owner to sign in
      // again for a session that has not expired.
      await throttleFailedLogin('pin');
      return json(res, {
        status: 'error', locked: true,
        message: 'That PIN is not right, or ten minutes have passed. Enter it again.'
      }, 401);
    }
  }

  // The PIN, traded for a pass that lasts ten minutes, so the owner is not
  // typing it again between the opening hours and the price list.
  if (action === 'unlock') {
    const { pass, until } = issueUnlockPass();
    return json(res, { status: 'success', unlockPass: pass, until, minutes: UNLOCK_MINUTES });
  }

  if (action === 'reports') {
    // months is 1, 3, 6 or 12; anything else falls back to 12 rather than
    // being refused. It comes from a dropdown, not from a person typing.
    const report = await readReports(db(), shopNow().date, payload.months);
    return json(res, Object.assign({ status: 'success' }, report));
  }

  if (action === 'uploadImage') return await uploadImage(payload, res);
  if (action === 'uploadAppIcon') return await uploadAppIcon(payload, res);

  if (action === 'saveCMS') return await saveCMS(payload, res);

  return json(res, { status: 'error', message: 'Unknown action' });
}

// ---- Booking --------------------------------------------------------------

/**
 * Why this booking cannot be accepted, or '' when it can.
 *
 * Checked here and not only in the browser: the form is public, so nothing is
 * enforced until the server says so.
 */
/**
 * How many appointments one phone number may hold at once.
 *
 * The form is public and asks for nothing but a name and a number, so there is
 * nothing between it and a script that fills the diary for a month. A real
 * customer books one haircut, occasionally two; ten is far past anything the
 * shop would see and still far short of a day's work to fill.
 */
const MOST_PER_CUSTOMER = 10;

/**
 * Why this booking cannot be accepted, or '' when it can.
 *
 * Every rule the site has about *whether* an appointment may exist lives here,
 * in the order a person would check them: is it a real date, is it in the past,
 * is the shop open, is that barber working, has this number booked too often,
 * is the chair still free. The browser checks the same things to grey out what
 * it offers — this is the copy that decides, because the form is public and
 * anything reaching it may have been written by hand.
 *
 * `byShop` lifts exactly two of them, and only because they exist to protect
 * the public form: the fifteen-minute notice, so "can you do half past, it's
 * twenty past" works at the counter, and the per-number limit, whose own
 * refusal tells the customer to phone the shop.
 */
async function refuseBooking(config, payload, byShop) {
  const date = trimmed(payload.date);
  const time = trimmed(payload.time);

  if (!date || !time) return 'Please choose a date and a time';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'That date is not valid';

  const minutes = rota.clockToMinutes(time);
  if (minutes === null) return 'That time is not valid';

  const name = trimmed(payload.name);
  const phone = trimmed(payload.phone);
  if (!name) return 'Please give a name for the booking';
  if (phoneKey(phone).length < 6) return 'Please give a phone number we can reach you on';
  if (name.length > 100 || phone.length > 40) return 'That name or number is too long';

  // Optional, but a typo is worse than leaving it blank: the booking would be
  // taken, the confirmation would silently never arrive, and the customer
  // would be waiting for one.
  const email = trimmed(payload.email);
  if (email) {
    if (email.length > 254) return 'That email address is too long';
    if (!EMAIL_RE.test(email)) {
      return 'That email address does not look right. Leave it blank if you prefer.';
    }
  }

  const now = shopNow();
  if (date < now.date) return 'That date has already passed';
  // Fifteen minutes' notice is for the public form, where nobody is in the
  // room. The shop taking a booking is: the customer is on the phone or at the
  // counter, and "can you do half past, it's twenty past now" is the ordinary
  // case. Refusing that would send them back to writing it on paper, which is
  // the whole problem this is here to fix.
  //
  // Earlier today is allowed too, for the same reason — a walk-in written down
  // after they have left is still a row the takings should have.
  if (!byShop && date === now.date && minutes < now.minutes + rota.MIN_NOTICE_MINUTES) {
    return 'That time has passed. Please choose a later one.';
  }

  // '' from here on means nobody was asked for. 'Any' used to slip past this
  // check and then be stored as though it were somebody's name.
  const wanted = normaliseBarber(payload.barber);
  if (wanted) {
    if (config.barberNames.indexOf(wanted) === -1) return 'We have no barber by that name';
    if (rota.isBarberOnLeave(config, wanted, date)) return wanted + ' is away on that date';
    if (!rota.isBarberWorkingAt(config, wanted, date, minutes)) {
      return wanted + ' does not work at that time';
    }
  }

  const sql = db();
  const [held, mine] = await Promise.all([
    sql`SELECT barber FROM bookings
         WHERE booked_on = ${date} AND booked_at = ${rota.minutesToClock(minutes)}
           AND status = 'active'`,
    sql`SELECT count(*) AS held FROM bookings
         WHERE phone_key = ${phoneKey(phone)} AND status = 'active'
           AND booked_on >= ${now.date}`
  ]);

  // The limit exists because the form is public and anonymous. It says so in
  // its own refusal — "please call us to add another" — and the shop is what
  // the customer reaches when they do. Enforcing it against the shop as well
  // would make that sentence a lie.
  if (!byShop && Number(mine[0].held) >= MOST_PER_CUSTOMER) {
    return 'That number already has several appointments booked. Please call us to add another.';
  }

  // Told apart from a slot that is merely full, because they are two different
  // things to be told. On the public form both read as "pick another time" and
  // that was near enough; the shop typing a booking in needs to know whether
  // it is chasing a free chair or a day nobody works.
  if (rota.barbersWorkingAt(config, date, minutes).length === 0) {
    return 'Nobody is working at that time';
  }

  if (!rota.isSlotFree(config, date, time, held.map(r => r.barber), wanted)) {
    return byShop
      ? 'Every chair at that time is taken'
      : 'Someone else booked that time while you were filling this in. Please choose another.';
  }
  return '';
}

/**
 * Take a booking, or explain why not.
 *
 * The order matters: refuse, write, then email. Nothing is sent before the row
 * exists, and nothing about the row depends on the sending working — a bounced
 * address must not turn a confirmed appointment into an error on the customer's
 * screen.
 */
async function addBooking(payload, res, byShop) {
  const config = await readRotaConfig();
  const refusal = await refuseBooking(config, payload, byShop);
  if (refusal) return json(res, { status: 'error', message: refusal });

  const date = trimmed(payload.date);
  const time = trimmed(payload.time);
  const minutes = rota.clockToMinutes(time);
  const clock = rota.minutesToClock(minutes);
  const asked = normaliseBarber(payload.barber);
  const sql = db();

  // The service is the shop's, not the request's. Anything that is not on the
  // list is refused rather than stored: a diary row reading "Free Haircut" is
  // a row somebody wrote, and the price would have come out null and quietly
  // vanished from the takings.
  const service = trimmed(payload.service);
  const known = await sql`
    SELECT name_en, price FROM services
     WHERE name_en = ${service} OR name_nl = ${service}
     ORDER BY position LIMIT 1`;
  if (!known.length) {
    return json(res, { status: 'error', message: 'Please choose one of the services offered' });
  }
  // The price the browser sent is not the price recorded. It came from a
  // public form and can say anything.
  const price = Number(known[0].price);

  // Nobody asked for anyone, so the shop decides — in its own order, and only
  // among those actually on the floor. Written down rather than left empty:
  // an empty barber column is the one thing the one-chair index cannot hold,
  // which is how two people ever got the same last chair.
  const candidates = asked ? [asked] : [];
  const written = await insertBooking(sql, {
    date, clock, service, price, payload, config, time, asked, candidates,
    source: byShop ? 'shop' : 'web'
  });

  if (written.error) return json(res, { status: 'error', message: written.error });

  // After the row is safely written. A booking must never fail because an
  // email did. The row, not the payload — so the notification quotes the price
  // and the barber that were recorded, not what the browser claimed.
  const record = Object.assign({}, payload, {
    service, price, barber: written.barber,
    // The language as it was written down, not as the browser sent it. The
    // payload's copy is unchecked; this one is the value in the row, which is
    // what every later email will be picked from.
    lang: written.lang,
    // Signed over this row's id alone, so the link in the email can do one
    // thing to one appointment and nothing else at all.
    cancelToken: cancelToken(written.id)
  });
  await Promise.allSettled([
    // Not when the shop typed it in. The notification exists to tell the shop
    // something arrived while nobody was watching the panel; sending it to the
    // person who is looking at the panel, about the thing they just did, is
    // noise — and noise is how a notification stops being read.
    byShop ? Promise.resolve(false) : sendBookingNotice(record),
    // The confirmation still goes, if they left an address. A customer who
    // rang up and gave their email wants the same proof as one who used the
    // form, and it is the only copy of the time they will have.
    sendCustomerConfirmation(record, config)
  ]);

  return json(res, { status: 'success', message: 'Booking added', barber: written.barber });
}

/** 'Any Available', 'Any' and '' all mean the same thing: nobody was asked for. */
function normaliseBarber(value) {
  const name = trimmed(value);
  return (name === rota.ANY_BARBER || name === 'Any') ? '' : name;
}

/**
 * Write the row, working down the shop's order when nobody was asked for.
 *
 * The database is what decides, not a check beforehand: two requests can both
 * read the same chair as free. When the index refuses one, that barber is
 * taken and the next in the order is tried — which is exactly what the shop
 * would do at the counter.
 */
async function insertBooking(sql, ctx) {
  const { date, clock, service, price, payload, config, time, asked } = ctx;
  const source = ctx.source === 'shop' ? 'shop' : 'web';
  // Two languages, and anything else is English. Whatever the browser sent is
  // going into a column and then into the choice of wording for four emails;
  // it is not going in unchecked.
  const lang = trimmed(payload.lang).toLowerCase() === 'nl' ? 'nl' : 'en';
  const clash = 'Someone else booked that time while you were filling this in. Please choose another.';

  // Barbers this request has already been refused. Carried rather than
  // re-read: each query is its own trip, and a loop that trusts the next read
  // to show the row that just beat it is a loop that can pick the same barber
  // again. There are only so many chairs, so this ends.
  const refused = [];

  for (let attempt = 0; attempt <= (config.barberNames || []).length; attempt++) {
    let barber = asked;
    if (!asked) {
      const held = await sql`
        SELECT barber FROM bookings
         WHERE booked_on = ${date} AND booked_at = ${clock} AND status = 'active'`;
      barber = rota.nextFreeBarber(config, date, time,
                                   held.map(r => r.barber).concat(refused));
      if (!barber) return { error: clash };
    }

    try {
      // The id comes back, because the confirmation email carries a cancel
      // link and a link that cancels one appointment has to name which.
      // The person, before the appointment. Resolved first so the booking can
      // carry the link, and outside the try below so a failure here is a real
      // error rather than something mistaken for a double-booking.
      //
      // Null when there is no usable number. The booking is still written: a
      // record of an appointment does not depend on us having a row for who
      // came to it.
      const customerId = await customerFor({
        phone: payload.phone, name: payload.name, email: payload.email
      });

      const written = await withNewSchema(() => sql`
        INSERT INTO bookings (booked_on, booked_at, service, barber, customer_name,
                              phone, email, price, source, lang, customer_id)
        VALUES (${date}, ${clock}, ${service}, ${barber}, ${trimmed(payload.name)},
                ${trimmed(payload.phone)}, ${trimmed(payload.email)}, ${price},
                ${source}, ${lang}, ${customerId})
        RETURNING id`);
      return { barber, id: (written[0] || {}).id, lang };
    } catch (err) {
      if (!String(err.message || '').includes('bookings_one_chair')) throw err;
      // Someone took that chair between the read and the write. If the
      // customer named them, that is the end of it — they asked for that
      // barber and must not be quietly given another.
      if (asked) return { error: clash };
      refused.push(barber);
    }
  }
  return { error: clash };
}

/**
 * What a cancel link refers to, without touching it.
 *
 * The page shows this and asks. A booking that has already been cancelled, or
 * has already happened, answers plainly rather than pretending — somebody who
 * cancelled twice needs to be told it is done, not shown an error.
 */
async function lookupCancel(payload, res) {
  const id = bookingFromCancelToken(payload.token);
  if (!id) return json(res, { status: 'error', message: 'That link is not valid any more.' });

  const sql = db();
  const rows = await sql`
    SELECT to_char(booked_on, 'YYYY-MM-DD') AS booked_on, booked_at,
           service, barber, customer_name, status
      FROM bookings WHERE id = ${id}`;
  if (!rows.length) return json(res, { status: 'error', message: 'We could not find that booking.' });

  const r = rows[0];
  return json(res, {
    status: 'success',
    // No phone number and no email address. The token proves somebody has the
    // email; it does not prove they are the customer, and a link forwarded to
    // a colleague should not hand over the number it was sent to.
    booking: {
      date: r.booked_on,
      time: rota.minutesToLabel(rota.parseClock(r.booked_at)),
      service: r.service,
      barber: r.barber,
      name: r.customer_name,
      cancelled: r.status === 'cancelled',
      past: r.booked_on < shopNow().date
    }
  });
}

/** Cancel the one appointment the token names. */
async function cancelByLink(payload, res) {
  const id = bookingFromCancelToken(payload.token);
  if (!id) return json(res, { status: 'error', message: 'That link is not valid any more.' });

  const sql = db();
  const rows = await sql`
    UPDATE bookings
       SET status = 'cancelled', cancelled_at = now()
     WHERE id = ${id} AND status = 'active'
    RETURNING to_char(booked_on, 'YYYY-MM-DD') AS booked_on,
              booked_at, service, barber, customer_name, phone, email, lang`;

  // Already cancelled. Not an error: a second click on the same link, or a
  // customer who also rang up, and both should be told the same calm thing.
  if (!rows.length) {
    return json(res, { status: 'success', message: 'That appointment is already cancelled.' });
  }

  const r = rows[0];
  const cancelled = {
    date: r.booked_on,
    time: rota.minutesToLabel(rota.parseClock(r.booked_at)),
    name: r.customer_name, phone: r.phone, email: r.email,
    service: r.service, barber: r.barber, lang: r.lang
  };
  const config = await readConfig();
  await Promise.allSettled([
    sendCancellationNotice(cancelled),
    sendCustomerCancellation(cancelled, config)
  ]);

  return json(res, { status: 'success', message: 'Booking cancelled' });
}

/**
 * Cancel one appointment, from the site or from a link in an email.
 *
 * Marked cancelled rather than deleted: the row is what the shop's takings and
 * its no-show history are counted from, and a cancellation is a fact worth
 * keeping. The slot frees up because every availability query filters on
 * status, not on the row being gone.
 */
async function cancelBooking(payload, res) {
  const date = trimmed(payload.date);
  const time = trimmed(payload.time);
  const key = phoneKey(payload.phone);
  const minutes = rota.clockToMinutes(time);
  if (!date || minutes === null || !key) {
    return json(res, { status: 'error', message: 'Booking not found' });
  }

  const sql = db();
  // Matched on the phone number as well as the slot, so knowing only the date
  // and time is not enough to cancel a stranger's appointment.
  const rows = await sql`
    UPDATE bookings
       SET status = 'cancelled', cancelled_at = now()
     WHERE booked_on = ${date} AND booked_at = ${rota.minutesToClock(minutes)}
       AND phone_key = ${key} AND status = 'active'
    RETURNING to_char(booked_on, 'YYYY-MM-DD') AS booked_on,
              booked_at, service, barber, customer_name, phone, email, lang`;

  if (rows.length === 0) {
    return json(res, { status: 'error', message: 'Booking not found' });
  }

  const r = rows[0];
  const cancelled = {
    date: r.booked_on,
    time: rota.minutesToLabel(rota.parseClock(r.booked_at)),
    name: r.customer_name, phone: r.phone, email: r.email,
    service: r.service, barber: r.barber, lang: r.lang
  };
  // The shop, and the customer. They were emailed when the appointment was
  // made, so silence when it comes off reads as "did that work?".
  const config = await readConfig();
  await Promise.allSettled([
    sendCancellationNotice(cancelled),
    sendCustomerCancellation(cancelled, config)
  ]);

  return json(res, { status: 'success', message: 'Booking canceled' });
}

// ---- Images ---------------------------------------------------------------

/**
 * Squeeze an uploaded photo down to something a web page should be serving.
 *
 * The panel already shrinks in the browser before uploading, which keeps the
 * upload itself quick. This runs anyway, for three reasons:
 *
 *   - the browser step is not a guarantee. It is one canvas call in one tab,
 *     and this endpoint is reachable by anything holding the password;
 *   - a phone photo carries EXIF, and EXIF from a phone carries the GPS
 *     coordinates it was taken at. sharp drops all metadata unless asked to
 *     keep it, so a photo taken in the shop stops publishing the shop's
 *     location a second time;
 *   - one pass at a fixed quality does not know how big the result came out.
 *     A flat photo lands at 60KB and a busy one at 900KB from the same
 *     settings, so this steps the quality down until it fits.
 *
 * 1600px on the long edge because the gallery lightbox shows these full
 * screen. The cards themselves are a quarter of that.
 */
const MAX_EDGE = 1600;
const TARGET_BYTES = 300 * 1024;
const QUALITY_STEPS = [82, 74, 66, 58];

async function compressImage(bytes) {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (err) {
    // Not installed, or no build for this platform. Storing the original is
    // worse than storing a small one and far better than refusing the upload.
    console.warn('[upload] sharp unavailable, storing as received:', err.message);
    return { bytes, contentType: 'image/jpeg' };
  }

  const base = sharp(bytes, { failOn: 'none' })
    .rotate()                 // honour the EXIF orientation before it is dropped
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });

  let out = null;
  for (const quality of QUALITY_STEPS) {
    out = await base.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
    if (out.length <= TARGET_BYTES) break;
  }
  return { bytes: out, contentType: 'image/jpeg' };
}

async function uploadImage(payload, res) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return json(res, {
      status: 'error',
      message: 'Image uploads are not configured. Add BLOB_READ_WRITE_TOKEN in Vercel.'
    });
  }
  const parts = String(payload.dataUrl || '').split(',');
  if (parts.length !== 2) {
    return json(res, { status: 'error', message: 'Malformed image data' });
  }
  const original = Buffer.from(parts[1], 'base64');
  if (!original.length) {
    return json(res, { status: 'error', message: 'That file is empty' });
  }

  let compressed;
  try {
    compressed = await compressImage(original);
  } catch (err) {
    // Anything sharp cannot read is not a picture, whatever it is called.
    console.error('[upload] could not read that image:', err);
    return json(res, { status: 'error', message: 'That file is not a readable image' });
  }

  // Always .jpg: the stored bytes are JPEG now whatever arrived, and a URL
  // ending .png that serves a JPEG confuses everything reading the extension
  // rather than the header.
  const requested = String(payload.filename || `image-${Date.now()}`);
  const name = requested.replace(/\.[^.]*$/, '').replace(/[^\w\-]/g, '_').slice(0, 60) || 'image';

  const { put } = require('@vercel/blob');
  // addRandomSuffix so re-uploading a file called photo.jpg does not silently
  // replace the one already on the site.
  const blob = await put(`site/${name}.jpg`, compressed.bytes, {
    access: 'public', contentType: compressed.contentType, addRandomSuffix: true
  });

  console.log(`[upload] ${name}: ${(original.length / 1024).toFixed(0)}KB in, ` +
              `${(compressed.bytes.length / 1024).toFixed(0)}KB out`);
  return json(res, { status: 'success', url: blob.url });
}

/**
 * A new set of home-screen icons, from a picture the owner chose.
 *
 * Owner-only, with the rest of the branding: this is what the shop looks like
 * on somebody's phone, which is the same kind of decision as the price list.
 *
 * The six files are written under one fixed path per size and the URLs are
 * saved into settings here rather than handed back for the panel to save.
 * Two round trips would mean a set of icons could exist in storage that
 * nothing pointed at, every time a save was interrupted.
 */
async function uploadAppIcon(payload, res) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return json(res, {
      status: 'error',
      message: 'Image uploads are not configured. Add BLOB_READ_WRITE_TOKEN in Vercel.'
    });
  }
  const parts = String(payload.dataUrl || '').split(',');
  if (parts.length !== 2) {
    return json(res, { status: 'error', message: 'Malformed image data' });
  }
  const source = Buffer.from(parts[1], 'base64');
  if (!source.length) return json(res, { status: 'error', message: 'That file is empty' });

  let made;
  try {
    const { makeIconSet } = require('./_lib/icons');
    made = await makeIconSet(source);
  } catch (err) {
    console.error('[icon] could not read that image:', err);
    return json(res, { status: 'error', message: 'That file is not a readable image' });
  }

  const { put } = require('@vercel/blob');
  const sql = db();
  const urls = {};
  const statements = [];
  for (const { file, bytes, setting } of made) {
    // addRandomSuffix, so a browser holding the old icon in its cache is not
    // shown it for a week. The settings row is what points at the current one.
    const blob = await put(`icons/${file}`, bytes, {
      access: 'public', contentType: 'image/png', addRandomSuffix: true
    });
    urls[setting] = blob.url;
    statements.push(sql`
      INSERT INTO settings (key, value) VALUES (${setting}, ${blob.url})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  }
  // One transaction: a half-written set is an icon that does not match itself
  // across the tab, the home screen and the splash screen.
  await sql.transaction(statements);

  console.log('[icon] new set from', (source.length / 1024).toFixed(0) + 'KB');
  return json(res, { status: 'success', icons: urls });
}

// ---- Saving what the panel changed ----------------------------------------

/**
 * The settings the website reads. A save carrying every one of these is a save
 * built from a config that loaded properly, which is what makes it safe to
 * treat as the complete set.
 */
const SITE_SETTINGS = ['hero_title', 'hero_subtitle', 'about_text',
                       'contact_phone', 'contact_address', 'instagram_url',
                       'maps_url', 'maps_embed_url'];

/**
 * Settings the panel does not send and must never lose. The visit counter is
 * written by the site, not by the panel, and a save that dropped it would
 * reset the shop's running total to nothing.
 *
 * The icon URLs are the same shape of thing: written by uploadAppIcon, never
 * present in the Website Text form, and a save that pruned them would take the
 * shop's icon off the home screen of every phone it is on.
 */
const KEPT_SETTINGS = ['visit_count'].concat(require('./_lib/icons').ICON_SETTINGS);

/**
 * Replace the site's content with what the panel sent.
 *
 * One transaction. The Apps Script wrote each sheet in turn, so a failure
 * halfway through left the services saved and the hours not — and no way to
 * tell which. Here either all of it lands or none of it does.
 */
async function saveCMS(payload, res) {
  const sql = db();
  const statements = [];

  if (payload.settings) {
    const keys = Object.keys(payload.settings);
    keys.forEach(key => {
      statements.push(sql`
        INSERT INTO settings (key, value) VALUES (${key}, ${String(payload.settings[key] ?? '')})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    });

    // A key the panel stopped sending used to sit in the table for ever, read
    // by nothing. Cleared out — but only when the save is a complete one.
    //
    // The panel always sends the whole settings object, so a save that is
    // missing the fields the site actually reads is a save built from a config
    // that never loaded. Deleting everything absent from that would wipe the
    // shop's own copy, so it is left alone instead.
    if (SITE_SETTINGS.every(key => keys.includes(key))) {
      statements.push(sql`
        DELETE FROM settings
         WHERE key <> ALL(${keys.concat(KEPT_SETTINGS)})`);
    }
  }

  if (Array.isArray(payload.barbers)) {
    const names = payload.barbers.map(b => trimmed(b.name)).filter(Boolean);
    // Anyone dropped from the panel goes, and their rota and time off go with
    // them through ON DELETE CASCADE. Their past appointments stay: the diary
    // keeps the barber's name, not a reference to this row.
    statements.push(sql`DELETE FROM barbers WHERE name <> ALL(${names})`);
    payload.barbers.forEach((b, i) => {
      const name = trimmed(b.name);
      if (!name) return;
      statements.push(sql`
        INSERT INTO barbers (name, image_url, position)
        VALUES (${name}, ${trimmed(b.image)}, ${i})
        ON CONFLICT (name) DO UPDATE
          SET image_url = EXCLUDED.image_url, position = EXCLUDED.position`);
    });
  }

  if (Array.isArray(payload.gallery)) {
    statements.push(sql`DELETE FROM gallery`);
    payload.gallery.forEach((url, i) => {
      if (trimmed(url)) statements.push(sql`
        INSERT INTO gallery (image_url, position) VALUES (${trimmed(url)}, ${i})`);
    });
  }

  if (Array.isArray(payload.services)) {
    statements.push(sql`DELETE FROM services`);
    payload.services.forEach((s, i) => {
      statements.push(sql`
        INSERT INTO services (name_en, name_nl, price, duration_min, position)
        VALUES (${trimmed(s.nameEN)}, ${trimmed(s.nameNL) || trimmed(s.nameEN)},
                ${Number(s.price) || 0}, ${Number(s.duration) || 30}, ${i})`);
    });
  }

  if (Array.isArray(payload.hours)) {
    payload.hours.forEach(h => {
      const idx = WEEKDAY_NAMES.indexOf(trimmed(h.day));
      if (idx === -1) return;
      const open = h.open === true;
      // The times are stored whether the day is open or not. They are never
      // read while it is shut, but blanking them means the owner who closes a
      // Sunday and reopens it a month later is handed two empty boxes.
      statements.push(sql`
        INSERT INTO shop_hours (weekday, is_open, opens_at, closes_at)
        VALUES (${indexToIso(idx)}, ${open},
                ${trimmed(h.from) || null}, ${trimmed(h.to) || null})
        ON CONFLICT (weekday) DO UPDATE
          SET is_open = EXCLUDED.is_open,
              opens_at = EXCLUDED.opens_at,
              closes_at = EXCLUDED.closes_at`);
    });
  }

  if (payload.barberHours && typeof payload.barberHours === 'object') {
    Object.keys(payload.barberHours).forEach(who => {
      (payload.barberHours[who] || []).forEach(row => {
        const idx = WEEKDAY_NAMES.indexOf(trimmed(row.day));
        if (idx === -1) return;
        const working = row.working === true;
        statements.push(sql`
          INSERT INTO barber_hours (barber_id, weekday, working, starts_at, ends_at,
                                    break_start, break_end)
          SELECT id, ${indexToIso(idx)}, ${working},
                 ${trimmed(row.from) || null}, ${trimmed(row.to) || null},
                 ${trimmed(row.breakFrom) || null}, ${trimmed(row.breakTo) || null}
            FROM barbers WHERE name = ${trimmed(who)}
          ON CONFLICT (barber_id, weekday) DO UPDATE
            SET working = EXCLUDED.working, starts_at = EXCLUDED.starts_at,
                ends_at = EXCLUDED.ends_at, break_start = EXCLUDED.break_start,
                break_end = EXCLUDED.break_end`);
      });
    });
  }

  if (Array.isArray(payload.timeOff)) {
    statements.push(sql`DELETE FROM time_off`);
    payload.timeOff.forEach(row => {
      const from = trimmed(row.from);
      if (!from) return;
      statements.push(sql`
        INSERT INTO time_off (barber_id, starts_on, ends_on, note)
        SELECT id, ${from}, ${trimmed(row.to) || from}, ${trimmed(row.note)}
          FROM barbers WHERE name = ${trimmed(row.barber)}`);
    });
  }

  if (statements.length) {
    try {
      await sql.transaction(statements);
    } catch (err) {
      // The database's own rules, said back in the panel's language. Without
      // this the owner sees a 500 and has to be told to read a log to find out
      // that a day was switched on with no hours in it.
      const why = explainSaveFailure(err);
      if (!why) throw err;
      return json(res, { status: 'error', message: why });
    }
  }
  return json(res, { status: 'success', message: 'Saved' });
}

/** A CHECK constraint the panel can hit, in words, or '' for anything else. */
function explainSaveFailure(err) {
  const text = String((err && err.message) || '');
  if (text.includes('shop_hours_span')) {
    return 'A day is open with no opening and closing time, or closes before it opens.';
  }
  if (text.includes('barber_hours_span')) {
    return 'A barber is marked as working on a day with no hours, or ending before they start.';
  }
  if (text.includes('barber_hours_break')) {
    return 'A break ends before it begins.';
  }
  if (text.includes('time_off_span')) {
    return 'A period of time off ends before it starts.';
  }
  if (text.includes('services_price_check') || text.includes('price >= 0')) {
    return 'A service has a negative price.';
  }
  if (text.includes('duration_min')) {
    return 'A service has a duration of zero.';
  }
  return '';
}
