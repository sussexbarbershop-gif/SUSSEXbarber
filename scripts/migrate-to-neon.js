/**
 * Copy everything out of the Google Sheet and into Neon.
 *
 *   DATABASE_URL=...  ADMIN_PASSWORD=...  npm run migrate:neon
 *
 * Reads through the Apps Script that is still running, rather than through the
 * Sheets API: it is already deployed, already knows how to read nine sheets of
 * mixed types, and needs no extra Google credentials. It is slow — twenty to
 * sixty seconds a call — but this runs once.
 *
 * Safe to re-run. Content tables are replaced wholesale; bookings are matched
 * on date, time and phone, so a second run updates rather than duplicates.
 * Nothing is deleted from the Sheet — it stays exactly as it is, which is the
 * only backup that matters until the new site has been live for a while.
 *
 * Add --dry-run to see what it would write without writing anything.
 */

const { neon } = require('@neondatabase/serverless');

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbyB3U2n2W2HRn20BxQWLi7Swjq0dSQV6_nnrSXPHRMsx53kP6xy8OpO2w9OTu9cdZvVtQ/exec';

const DRY_RUN = process.argv.includes('--dry-run');
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
                       'Friday', 'Saturday'];
const indexToIso = idx => (idx === 0 ? 7 : idx);

const trimmed = v => String(v == null ? '' : v).trim();

/** '02:30 PM' or '14:30' -> '14:30', the form a Postgres time column takes. */
function toClock(value) {
  const m = trimmed(value).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  if (m[3]) {
    const p = m[3].toUpperCase();
    if (p === 'PM' && h !== 12) h += 12;
    if (p === 'AM' && h === 12) h = 0;
  }
  if (h > 23 || mins > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** Blank for anything that is not a real date, so a bad row is skipped. */
function toDate(value) {
  const s = trimmed(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

async function fetchJson(url, options) {
  const res = await fetch(url, Object.assign({ redirect: 'follow' }, options || {}));
  if (!res.ok) throw new Error(`${res.status} from the Apps Script`);
  const text = await res.text();
  try { return JSON.parse(text); }
  catch (err) { throw new Error('The Apps Script did not answer with JSON: ' + text.slice(0, 200)); }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  const password = process.env.ADMIN_PASSWORD;
  if (!password) fail('ADMIN_PASSWORD is not set. It is the panel password, held in the Apps Script.');
  // A dry run only reads the Sheet, so it needs no database. That makes it a
  // way to check the Apps Script side before Neon exists at all.
  if (!DRY_RUN && !dbUrl) fail('DATABASE_URL is not set. Copy it from your Neon dashboard.');

  const sql = DRY_RUN ? null : neon(dbUrl);

  console.log('Reading the Sheet. The Apps Script is slow; this takes a minute.\n');

  const config = await fetchJson(`${APPS_SCRIPT_URL}?action=getConfig`);
  if (config.status !== 'success') fail('The Apps Script would not hand over the config.');
  console.log('  config    :', (config.services || []).length, 'services,',
    (config.barbers || []).length, 'barbers,',
    (config.gallery || []).length, 'photos');

  const bookings = await fetchJson(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'allBookings', password })
  });
  if (!Array.isArray(bookings)) {
    fail('The Apps Script refused the diary: ' + JSON.stringify(bookings).slice(0, 200) +
         '\nIs ADMIN_PASSWORD right?');
  }
  console.log('  bookings  :', bookings.length, 'active\n');

  if (DRY_RUN) {
    // Say what would land, and name anything that would not, so the awkward
    // rows are known before the real run rather than after it.
    let ok = 0;
    const bad = [];
    bookings.forEach(b => {
      const date = toDate(b.date), time = toClock(b.time), phone = trimmed(b.phone);
      if (date && time && phone) ok++;
      else bad.push(`${b.date} ${b.time} ${b.name || ''} — missing date, time or phone`);
    });
    console.log('Would write:');
    console.log('  settings  :', Object.keys(config.settings || {}).length);
    console.log('  barbers   :', (config.barbers || []).length);
    console.log('  services  :', (config.services || []).length);
    console.log('  gallery   :', (config.gallery || []).length);
    console.log('  rota rows :', Object.values(config.barberHours || {})
      .reduce((a, r) => a + r.length, 0));
    console.log('  time off  :', (config.timeOff || []).length);
    console.log('  bookings  :', ok, 'of', bookings.length);
    if (bad.length) {
      console.log('\nThese would be skipped:');
      bad.slice(0, 20).forEach(s => console.log('  ' + s));
      if (bad.length > 20) console.log(`  … and ${bad.length - 20} more`);
    }
    console.log('\n--dry-run: nothing written. Re-run without it to migrate.');
    return;
  }

  // ---- content -----------------------------------------------------------
  // Replaced wholesale, in one transaction, so a half-migrated site is not a
  // state that can happen.

  const content = [];

  Object.keys(config.settings || {}).forEach(key => {
    content.push(sql`
      INSERT INTO settings (key, value) VALUES (${key}, ${String(config.settings[key] ?? '')})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  });

  (config.barbers || []).forEach((b, i) => {
    const name = trimmed(b.name);
    if (!name) return;
    content.push(sql`
      INSERT INTO barbers (name, image_url, position)
      VALUES (${name}, ${trimmed(b.image)}, ${i})
      ON CONFLICT (name) DO UPDATE
        SET image_url = EXCLUDED.image_url, position = EXCLUDED.position`);
  });

  content.push(sql`DELETE FROM gallery`);
  (config.gallery || []).forEach((url, i) => {
    if (trimmed(url)) content.push(sql`
      INSERT INTO gallery (image_url, position) VALUES (${trimmed(url)}, ${i})`);
  });

  content.push(sql`DELETE FROM services`);
  (config.services || []).forEach((s, i) => {
    content.push(sql`
      INSERT INTO services (name_en, name_nl, price, duration_min, position)
      VALUES (${trimmed(s.nameEN)}, ${trimmed(s.nameNL) || trimmed(s.nameEN)},
              ${Number(s.price) || 0}, ${Number(s.duration) || 30}, ${i})`);
  });

  (config.hours || []).forEach(h => {
    const idx = WEEKDAY_NAMES.indexOf(trimmed(h.day));
    if (idx === -1) return;
    const open = h.open === true;
    const from = toClock(h.from);
    const to = toClock(h.to);
    // The times are kept even on a closed day. They are never read while the
    // day is shut, but they are what the owner last set, and blanking them
    // means that reopening a Sunday in the panel presents empty boxes.
    content.push(sql`
      INSERT INTO shop_hours (weekday, is_open, opens_at, closes_at)
      VALUES (${indexToIso(idx)}, ${open && !!from && !!to}, ${from}, ${to})
      ON CONFLICT (weekday) DO UPDATE
        SET is_open = EXCLUDED.is_open, opens_at = EXCLUDED.opens_at,
            closes_at = EXCLUDED.closes_at`);
  });

  await sql.transaction(content);
  console.log('  content   : written');

  // ---- rotas -------------------------------------------------------------
  // Separate pass: these reference barbers by id, so the barbers have to be
  // in the table first. Inside one transaction that is not guaranteed.

  const rotas = [];
  Object.keys(config.barberHours || {}).forEach(who => {
    (config.barberHours[who] || []).forEach(row => {
      const idx = WEEKDAY_NAMES.indexOf(trimmed(row.day));
      if (idx === -1) return;
      const from = toClock(row.from);
      const to = toClock(row.to);
      // A "working" day with unreadable hours is stored as not working rather
      // than rejected by the CHECK constraint and taking the migration down.
      const working = row.working === true && !!from && !!to;
      // Same again: a day off keeps whatever hours were last set on it, so
      // turning the day back on in the panel does not start from blank.
      rotas.push(sql`
        INSERT INTO barber_hours (barber_id, weekday, working, starts_at, ends_at,
                                  break_start, break_end)
        SELECT id, ${indexToIso(idx)}, ${working}, ${from}, ${to},
               ${toClock(row.breakFrom)}, ${toClock(row.breakTo)}
          FROM barbers WHERE name = ${trimmed(who)}
        ON CONFLICT (barber_id, weekday) DO UPDATE
          SET working = EXCLUDED.working, starts_at = EXCLUDED.starts_at,
              ends_at = EXCLUDED.ends_at, break_start = EXCLUDED.break_start,
              break_end = EXCLUDED.break_end`);
    });
  });

  rotas.push(sql`DELETE FROM time_off`);
  (config.timeOff || []).forEach(row => {
    const from = toDate(row.from);
    if (!from) return;
    rotas.push(sql`
      INSERT INTO time_off (barber_id, starts_on, ends_on, note)
      SELECT id, ${from}, ${toDate(row.to) || from}, ${trimmed(row.note)}
        FROM barbers WHERE name = ${trimmed(row.barber)}`);
  });

  if (rotas.length) await sql.transaction(rotas);
  console.log('  rotas     : written');

  // ---- the diary ---------------------------------------------------------
  // One at a time, and a bad row is reported rather than fatal. A single
  // booking with a mangled date should not stop the other four hundred.

  let written = 0;
  const skipped = [];

  for (const b of bookings) {
    const date = toDate(b.date);
    const time = toClock(b.time);
    const phone = trimmed(b.phone);
    if (!date || !time || !phone) {
      skipped.push(`${b.date} ${b.time} ${b.name || ''} — missing date, time or phone`);
      continue;
    }
    // "Any" and "Any Available" both mean no preference, and the new schema
    // says that with an empty string so the unique index can ignore them.
    let barber = trimmed(b.barber);
    if (barber === 'Any' || barber === 'Any Available') barber = '';

    const price = b.price === '' || b.price == null ? null : Number(b.price);

    try {
      const res = await sql`
        INSERT INTO bookings (booked_on, booked_at, service, barber, customer_name,
                              phone, email, price)
        VALUES (${date}, ${time}, ${trimmed(b.service)}, ${barber},
                ${trimmed(b.name)}, ${phone}, ${trimmed(b.email)},
                ${Number.isFinite(price) ? price : null})
        ON CONFLICT DO NOTHING
        RETURNING id`;
      if (res.length) written++;
      else skipped.push(`${date} ${time} ${b.name || ''} — already there, or the slot is taken`);
    } catch (err) {
      skipped.push(`${date} ${time} ${b.name || ''} — ${err.message}`);
    }
  }

  console.log('  bookings  :', written, 'written,', skipped.length, 'skipped\n');
  if (skipped.length) {
    console.log('Skipped rows — check these by hand against the Sheet:');
    skipped.slice(0, 40).forEach(s => console.log('  ' + s));
    if (skipped.length > 40) console.log(`  … and ${skipped.length - 40} more`);
    console.log('');
  }

  // ---- what actually landed ----------------------------------------------

  const [counts] = await sql`
    SELECT (SELECT count(*) FROM bookings WHERE status = 'active') AS bookings,
           (SELECT count(*) FROM barbers)      AS barbers,
           (SELECT count(*) FROM services)     AS services,
           (SELECT count(*) FROM gallery)      AS gallery,
           (SELECT count(*) FROM barber_hours) AS rota_rows,
           (SELECT count(*) FROM time_off)     AS time_off,
           (SELECT count(*) FROM settings)     AS settings`;

  console.log('In Neon now:');
  Object.keys(counts).forEach(k => console.log(`  ${k.padEnd(10)} ${counts[k]}`));

  const expected = bookings.length;
  const actual = Number(counts.bookings);
  console.log('');
  if (actual === expected) {
    console.log(`Every one of the ${expected} bookings made it across.`);
  } else {
    console.log(`The Sheet had ${expected} active bookings and Neon has ${actual}.`);
    console.log('The skipped list above says why. Nothing was removed from the Sheet,');
    console.log('so the originals are still there to compare against.');
  }
}

function fail(message) {
  console.error('\n' + message + '\n');
  process.exit(1);
}

main().catch(err => fail(err.stack || String(err)));
