/**
 * The appointment, as a calendar file.
 *
 * The button used to build the file in the browser and hand it over with
 * `window.location.assign('data:text/calendar,…')`. On Android it never ran —
 * that branch opens Google Calendar — and on an iPhone, which is the only
 * place it did run, browsers have refused to navigate to a data: URL at the
 * top level for years. So the button did nothing at all, in silence, for
 * every customer who pressed it. There is no error to see: the navigation is
 * simply not performed.
 *
 * A real URL serving text/calendar is what iOS does open, straight into the
 * Add Event sheet, in Safari and inside a home-screen app alike.
 *
 * Nothing here identifies anybody. The query carries a date, a time and how
 * many half hours it runs for, and the file it builds says "Sussex Barber
 * Shop" and the shop's address — the same three facts already on the screen
 * of whoever pressed the button. No name, no number, nothing that would be
 * worth having in a browser history or a server log.
 */

const SHOP_TZ = process.env.SHOP_TIMEZONE || 'Europe/Amsterdam';

const SHOP_NAME = 'Sussex Barber Shop';
const SHOP_ADDRESS = 'Van Hogendorpstraat 10, 2242 KZ Wassenaar, Netherlands';

/** One appointment cannot be longer than this many half hours. */
const MOST_SLOTS = 8;

/**
 * The moment a wall-clock time in the shop's timezone actually is.
 *
 * Node has no way to say "half past two in Amsterdam" directly. So: guess
 * that the time is UTC, ask what the shop's clock reads at that instant, and
 * shift by however far off it was. Twice, because on the two nights a year
 * the clocks change, the first shift can land on the other side of the
 * boundary and pick up the wrong offset.
 */
function shopTimeToUtc(date, time) {
  const wanted = Date.parse(`${date}T${time}:00Z`);
  let at = wanted;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: SHOP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date(at)).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    // 24 is midnight at the end of a day to some ICU versions, 00 to others.
    const hour = parts.hour === '24' ? '00' : parts.hour;
    const shown = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:00Z`);
    if (shown === wanted) break;
    at += wanted - shown;
  }
  return new Date(at);
}

/** YYYYMMDDTHHMMSSZ, which is the only format every calendar agrees on. */
const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

/**
 * Commas, semicolons and backslashes are field separators in this format, and
 * a service called "Cut, wash & finish" would otherwise end the summary early
 * and leave the rest as an unknown property.
 */
const escape = text => String(text)
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

/** Every line, joined with CRLF, which RFC 5545 requires and iOS enforces. */
function buildIcs({ start, end, summary, description }) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sussex Barber Shop//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${stamp(start)}-${Math.random().toString(36).slice(2, 10)}@sussexbarber.nl`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(summary)}`,
    `DESCRIPTION:${escape(description)}`,
    `LOCATION:${escape(SHOP_ADDRESS)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escape(summary)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

module.exports = function handler(req, res) {
  const q = req.query || {};
  const date = String(q.d || '').trim();
  const time = String(q.t || '').trim();
  const slots = Number(q.n || 1);
  // Free text, so it is capped and stripped of anything that is not a plain
  // name — this ends up in a file a calendar will render.
  const service = String(q.s || '').replace(/[^\p{L}\p{N} ,&'+-]/gu, '').slice(0, 80).trim();

  const looksRight = /^\d{4}-\d{2}-\d{2}$/.test(date) &&
                     /^([01]\d|2[0-3]):[0-5]\d$/.test(time) &&
                     Number.isInteger(slots) && slots >= 1 && slots <= MOST_SLOTS;
  if (!looksRight) {
    res.status(400);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send('That is not an appointment.');
  }

  const start = shopTimeToUtc(date, time);
  if (isNaN(start.getTime())) {
    res.status(400);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send('That is not a date.');
  }
  const end = new Date(start.getTime() + slots * 30 * 60000);

  const ics = buildIcs({
    start, end,
    summary: `${service || 'Appointment'} at ${SHOP_NAME}`,
    description: `Your appointment at ${SHOP_NAME}. ${SHOP_ADDRESS}`
  });

  res.status(200);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  // inline, not attachment: an attachment is a download, and iOS opens the
  // Add Event sheet for one it is shown rather than handed.
  res.setHeader('Content-Disposition', 'inline; filename="sussex-barber.ics"');
  res.setHeader('Cache-Control', 'no-store');
  return res.send(ics);
};

module.exports.shopTimeToUtc = shopTimeToUtc;
module.exports.buildIcs = buildIcs;
module.exports.escape = escape;
module.exports.MOST_SLOTS = MOST_SLOTS;
