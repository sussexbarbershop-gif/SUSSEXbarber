/**
 * The database, and the shape the site expects to read it in.
 *
 * Neon's driver talks SQL over HTTPS rather than holding a socket open, which
 * is what makes it usable from a function that may only live for 200ms. No
 * pool to warm, nothing to close.
 *
 * Times come back as 'HH:MM:SS' and dates as 'YYYY-MM-DD' — both already the
 * strings the front end wants, which is the whole reason for typed columns.
 * Sheets handed back a Date for a cell reading "10:00" and a string for the
 * same cell in the next row; formatClock() existed to paper over that.
 */

const { neon } = require('@neondatabase/serverless');

let cachedSql = null;

/** The query function. Tagged template — parameters are never interpolated. */
function db() {
  if (cachedSql) return cachedSql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Add it in Vercel > Settings > Environment Variables.');
  }
  cachedSql = neon(url);
  return cachedSql;
}

/** 'HH:MM:SS' or 'HH:MM' -> 'HH:MM'. Postgres returns seconds; nobody wants them. */
function hhmm(value) {
  if (!value) return '';
  return String(value).slice(0, 5);
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
                       'Friday', 'Saturday'];
const WEEKDAY_NL = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag',
                    'Vrijdag', 'Zaterdag'];

/** ISO weekday (1 = Monday) -> the index the site's arrays use (0 = Sunday). */
const isoToIndex = iso => (Number(iso) === 7 ? 0 : Number(iso));
const indexToIso = idx => (Number(idx) === 0 ? 7 : Number(idx));

/**
 * Everything the site needs to render itself, in one round trip.
 *
 * Seven queries, run together. Against Sheets this was seven sheet reads that
 * took twenty seconds between them, which is why there was a two-minute cache
 * in front of it and why the owner had to wait for their own edits to appear.
 * There is no cache here: the queries are indexed and the whole thing is a few
 * milliseconds, so what the owner saves is what the next visitor sees.
 */
async function readConfig() {
  const sql = db();

  const [settingsRows, barberRows, galleryRows, serviceRows, hourRows,
         barberHourRows, timeOffRows] = await Promise.all([
    sql`SELECT key, value FROM settings`,
    sql`SELECT id, name, image_url FROM barbers ORDER BY position, id`,
    sql`SELECT image_url FROM gallery ORDER BY position, id`,
    sql`SELECT id, name_en, name_nl, price, duration_min FROM services ORDER BY position, id`,
    sql`SELECT weekday, is_open, opens_at, closes_at FROM shop_hours`,
    sql`SELECT b.name, h.weekday, h.working, h.starts_at, h.ends_at,
               h.break_start, h.break_end
          FROM barber_hours h JOIN barbers b ON b.id = h.barber_id`,
    // to_char, not the raw date column. The driver hands a `date` back as a
    // JavaScript Date, and String()ing that gives
    // "Fri Aug 07 2026 00:00:00 GMT+0000 (Coordinated Universal Time)" —
    // which the site compares against 'YYYY-MM-DD' strings and never matches.
    sql`SELECT b.name, to_char(t.starts_on, 'YYYY-MM-DD') AS starts_on,
               to_char(t.ends_on, 'YYYY-MM-DD') AS ends_on, t.note
          FROM time_off t JOIN barbers b ON b.id = t.barber_id`
  ]);

  const settings = {};
  settingsRows.forEach(r => { settings[r.key] = r.value; });

  // The shop is described a day at a time, and a missing row means closed
  // rather than an absent day — the front end looks days up by name.
  const hoursByIndex = {};
  hourRows.forEach(r => { hoursByIndex[isoToIndex(r.weekday)] = r; });
  const hours = WEEKDAY_NAMES.map((day, i) => {
    const row = hoursByIndex[i];
    return {
      day,
      dayNL: WEEKDAY_NL[i],
      open: row ? row.is_open === true : false,
      from: row ? hhmm(row.opens_at) : '',
      to: row ? hhmm(row.closes_at) : ''
    };
  });

  const barberHours = {};
  barberHourRows.forEach(r => {
    if (!barberHours[r.name]) barberHours[r.name] = [];
    barberHours[r.name].push({
      day: WEEKDAY_NAMES[isoToIndex(r.weekday)],
      working: r.working === true,
      from: hhmm(r.starts_at),
      to: hhmm(r.ends_at),
      breakFrom: hhmm(r.break_start),
      breakTo: hhmm(r.break_end)
    });
  });

  return {
    settings,
    barbers: barberRows.map(r => ({ name: r.name, image: r.image_url || '' })),
    gallery: galleryRows.map(r => r.image_url),
    services: serviceRows.map(r => ({
      id: r.id,
      nameEN: r.name_en,
      nameNL: r.name_nl || r.name_en,
      price: Number(r.price),
      duration: r.duration_min
    })),
    hours,
    barberHours,
    timeOff: timeOffRows.map(r => ({
      barber: r.name,
      from: r.starts_on,
      to: r.ends_on,
      note: r.note || ''
    }))
  };
}

/**
 * The same config, plus the plain list of names the rota logic works from.
 * Kept separate from readConfig() because the site does not need it — it reads
 * `barbers` for the cards — and the rota does not want the images.
 */
async function readRotaConfig() {
  const config = await readConfig();
  config.barberNames = config.barbers.map(b => b.name);
  return config;
}

module.exports = { db, readConfig, readRotaConfig, hhmm, isoToIndex, indexToIso,
                   WEEKDAY_NAMES, WEEKDAY_NL };
