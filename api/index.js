/**
 * The whole backend, on one route.
 *
 * It speaks the same action-based protocol the Apps Script did — same query
 * parameters, same POST bodies, same response shapes — so the site and the
 * panel only had to change one line each: the address they call.
 *
 * That is deliberate. Rewriting the storage and the client protocol in one go
 * would mean a failure could be in either, and the booking form is the thing
 * that must not break. Nicer routes can come later; they are cosmetic.
 *
 * Environment (Vercel > Settings > Environment Variables):
 *   DATABASE_URL           the Neon connection string
 *   ADMIN_PASSWORD         the panel password
 *   NOTIFY_EMAIL           where booking notifications go
 *   RESEND_API_KEY         optional; without it no email is sent
 *   MAIL_FROM              optional; the From: address Resend sends as
 *   BLOB_READ_WRITE_TOKEN  optional; needed only to upload images
 */

const { db, readConfig, readRotaConfig, indexToIso, WEEKDAY_NAMES } = require('./_lib/db');
const rota = require('./_lib/rota');
const { isAuthorized, throttleFailedLogin, resetFailedLogins } = require('./_lib/auth');
const { sendBookingNotice, sendCustomerConfirmation, sendCancellationNotice } = require('./_lib/mail');

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

// ---- GET ------------------------------------------------------------------

async function handleGet(req, res) {
  const q = req.query || {};
  const action = trimmed(q.action);

  if (action === 'getConfig' || action === 'getSettings') {
    const config = await readConfig();
    config.status = 'success';
    config.backendVersion = BACKEND_VERSION;
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

  if (action === 'myBookings') {
    const key = phoneKey(q.phone);
    if (!key) return json(res, []);
    const sql = db();
    const today = shopNow().date;
    const rows = await sql`
      SELECT booked_on, booked_at, service, barber, customer_name, phone
        FROM bookings
       WHERE phone_key = ${key} AND status = 'active' AND booked_on >= ${today}
       ORDER BY booked_on, booked_at`;
    return json(res, rows.map(r => ({
      date: String(r.booked_on),
      time: rota.minutesToLabel(rota.parseClock(r.booked_at)),
      service: r.service,
      barber: r.barber,
      name: r.customer_name,
      phone: r.phone
    })));
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
    const rows = await sql`
      SELECT booked_on, booked_at, service, barber, customer_name, phone, email, price
        FROM bookings WHERE status = 'active'
       ORDER BY booked_on, booked_at`;
    return json(res, rows.map(r => ({
      date: String(r.booked_on),
      time: rota.minutesToLabel(rota.parseClock(r.booked_at)),
      service: r.service,
      barber: r.barber,
      name: r.customer_name,
      phone: r.phone,
      email: r.email || '',
      price: r.price === null ? '' : Number(r.price)
    })));
  }

  if (!action || action === 'addBooking') return await addBooking(payload, res);
  if (action === 'cancelBooking' || action === 'cancel') return await cancelBooking(payload, res);

  if (action === 'uploadImage') {
    if (!isAuthorized(payload)) {
      return json(res, { status: 'error', message: 'Unauthorized' }, 401);
    }
    return await uploadImage(payload, res);
  }

  if (action === 'saveCMS') {
    if (!isAuthorized(payload)) {
      return json(res, { status: 'error', message: 'Unauthorized' }, 401);
    }
    return await saveCMS(payload, res);
  }

  return json(res, { status: 'error', message: 'Unknown action' });
}

// ---- Booking --------------------------------------------------------------

/**
 * Why this booking cannot be accepted, or '' when it can.
 *
 * Checked here and not only in the browser: the form is public, so nothing is
 * enforced until the server says so.
 */
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

  const wanted = trimmed(payload.barber);
  if (wanted && wanted !== rota.ANY_BARBER && wanted !== 'Any') {
    if (rota.isBarberOnLeave(config, wanted, date)) return wanted + ' is away on that date';
    if (!rota.isBarberWorkingAt(config, wanted, date, minutes)) {
      return wanted + ' does not work at that time';
    }
  }

  const sql = db();
  const held = await sql`
    SELECT barber FROM bookings
     WHERE booked_on = ${date} AND booked_at = ${rota.minutesToClock(minutes)}
       AND status = 'active'`;
  if (!rota.isSlotFree(config, date, time, held.map(r => r.barber), wanted)) {
    return 'Someone else booked that time while you were filling this in. Please choose another.';
  }
  return '';
}

async function addBooking(payload, res) {
  const config = await readRotaConfig();
  const refusal = await refuseBooking(config, payload);
  if (refusal) return json(res, { status: 'error', message: refusal });

  const minutes = rota.clockToMinutes(trimmed(payload.time));
  const barber = trimmed(payload.barber) === rota.ANY_BARBER ? '' : trimmed(payload.barber);
  const price = payload.price === '' || payload.price == null ? null : Number(payload.price);
  const sql = db();

  try {
    await sql`
      INSERT INTO bookings (booked_on, booked_at, service, barber, customer_name,
                            phone, email, price)
      VALUES (${trimmed(payload.date)}, ${rota.minutesToClock(minutes)},
              ${trimmed(payload.service)}, ${barber}, ${trimmed(payload.name)},
              ${trimmed(payload.phone)}, ${trimmed(payload.email)}, ${price})`;
  } catch (err) {
    // bookings_one_chair. Two requests for the same barber and moment arrived
    // together and the database refused the second — which is the point of the
    // index, and the reason there is no lock here.
    if (String(err.message || '').includes('bookings_one_chair')) {
      return json(res, {
        status: 'error',
        message: 'Someone else booked that time while you were filling this in. Please choose another.'
      });
    }
    throw err;
  }

  // After the row is safely written. A booking must never fail because an
  // email did.
  await Promise.allSettled([
    sendBookingNotice(payload),
    sendCustomerConfirmation(payload, config)
  ]);

  return json(res, { status: 'success', message: 'Booking added' });
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
    RETURNING booked_on, booked_at, service, barber, customer_name, phone, email`;

  if (rows.length === 0) {
    return json(res, { status: 'error', message: 'Booking not found' });
  }

  const r = rows[0];
  await Promise.allSettled([sendCancellationNotice({
    date: String(r.booked_on),
    time: rota.minutesToLabel(rota.parseClock(r.booked_at)),
    name: r.customer_name, phone: r.phone, email: r.email,
    service: r.service, barber: r.barber
  })]);

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

  if (statements.length) await sql.transaction(statements);
  return json(res, { status: 'success', message: 'Saved' });
}
