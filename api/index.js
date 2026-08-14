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

const { db, readConfig, readRotaConfig, indexToIso, WEEKDAY_NAMES } = require('./_lib/db');
const rota = require('./_lib/rota');
const { isAuthorized, isPinCorrect, isOwner, reportsPinIsSet, issueUnlockPass,
        UNLOCK_MINUTES, throttleFailedLogin, resetFailedLogins } = require('./_lib/auth');
const { readReports } = require('./_lib/reports');
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

// ---------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  try {
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
module.exports.refuseBooking = (config, payload) => refuseBooking(config, payload);
module.exports.shopNow = shopNow;

// ---- GET ------------------------------------------------------------------

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

  if (action === 'trackVisit') {
    const sql = db();
    const rows = await sql`
      INSERT INTO settings (key, value) VALUES ('visit_count', '1')
      ON CONFLICT (key) DO UPDATE
        SET value = (COALESCE(NULLIF(settings.value, '')::bigint, 0) + 1)::text
      RETURNING value`;
    return json(res, { status: 'success', visits: Number(rows[0].value) });
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
    const now = shopNow();
    if (dateParam === now.date) {
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

    return json(res, unavailable);
  }

  // Nothing else is public. A bare GET used to hand the whole diary — every
  // customer's name and number — to anyone with the URL, and the URL is in the
  // page source of a public website.
  return json(res, []);
}

// ---- POST -----------------------------------------------------------------

async function handlePost(req, res) {
  const payload = readBody(req);
  const action = trimmed(payload.action);

  if (action === 'adminLogin') {
    if (!process.env.ADMIN_PASSWORD) {
      return json(res, { status: 'error', message: 'No ADMIN_PASSWORD set on the server' });
    }
    if (isAuthorized(payload)) {
      resetFailedLogins();
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
    const rows = await sql`
      SELECT id,
             to_char(booked_on, 'YYYY-MM-DD') AS booked_on,
             booked_at, service, barber, customer_name, phone,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
        FROM bookings WHERE status = 'active'
       ORDER BY booked_on, booked_at`;
    return json(res, rows.map(r => ({
      id: r.id,
      date: r.booked_on,
      time: rota.minutesToLabel(rota.parseClock(r.booked_at)),
      service: r.service,
      barber: r.barber,
      name: r.customer_name,
      phone: r.phone,
      bookedAt: r.created_at
    })));
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

  if (!action || action === 'addBooking') return await addBooking(payload, res);
  if (action === 'cancelBooking' || action === 'cancel') return await cancelBooking(payload, res);

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
  if (['reports', 'unlock', 'saveCMS', 'uploadImage'].includes(action)) {
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

async function refuseBooking(config, payload) {
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
  if (date === now.date && minutes < now.minutes + rota.MIN_NOTICE_MINUTES) {
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

  if (Number(mine[0].held) >= MOST_PER_CUSTOMER) {
    return 'That number already has several appointments booked. Please call us to add another.';
  }

  if (!rota.isSlotFree(config, date, time, held.map(r => r.barber), wanted)) {
    return 'Someone else booked that time while you were filling this in. Please choose another.';
  }
  return '';
}

async function addBooking(payload, res) {
  const config = await readRotaConfig();
  const refusal = await refuseBooking(config, payload);
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
    date, clock, service, price, payload, config, time, asked, candidates
  });

  if (written.error) return json(res, { status: 'error', message: written.error });

  // After the row is safely written. A booking must never fail because an
  // email did. The row, not the payload — so the notification quotes the price
  // and the barber that were recorded, not what the browser claimed.
  const record = Object.assign({}, payload, {
    service, price, barber: written.barber
  });
  await Promise.allSettled([
    sendBookingNotice(record),
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
      await sql`
        INSERT INTO bookings (booked_on, booked_at, service, barber, customer_name,
                              phone, email, price)
        VALUES (${date}, ${clock}, ${service}, ${barber}, ${trimmed(payload.name)},
                ${trimmed(payload.phone)}, ${trimmed(payload.email)}, ${price})`;
      return { barber };
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
              booked_at, service, barber, customer_name, phone, email`;

  if (rows.length === 0) {
    return json(res, { status: 'error', message: 'Booking not found' });
  }

  const r = rows[0];
  const cancelled = {
    date: r.booked_on,
    time: rota.minutesToLabel(rota.parseClock(r.booked_at)),
    name: r.customer_name, phone: r.phone, email: r.email,
    service: r.service, barber: r.barber
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
  const contentType = (parts[0].match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bytes = Buffer.from(parts[1], 'base64');

  const { put } = require('@vercel/blob');
  const name = String(payload.filename || `image-${Date.now()}.jpg`).replace(/[^\w.\-]/g, '_');
  // addRandomSuffix so re-uploading a file called photo.jpg does not silently
  // replace the one already on the site.
  const blob = await put(`site/${name}`, bytes, {
    access: 'public', contentType, addRandomSuffix: true
  });
  return json(res, { status: 'success', url: blob.url });
}

// ---- Saving what the panel changed ----------------------------------------

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
    Object.keys(payload.settings).forEach(key => {
      statements.push(sql`
        INSERT INTO settings (key, value) VALUES (${key}, ${String(payload.settings[key] ?? '')})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    });
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
