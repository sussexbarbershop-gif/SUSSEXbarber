/**
 * Who is on the floor, and which slots are still free.
 *
 * This is the one piece of logic that exists twice: here, and in index.html so
 * the browser can grey out a day without a round trip. They have to agree —
 * a browser that offers a slot the server then refuses is the worst failure
 * this site has, because the customer has already filled the form in.
 *
 * tests/rota-agreement.test.js runs both over the same matrix and fails if
 * they ever differ. Change one, and that test tells you about the other.
 *
 * Everything here is a pure function of a config object. Nothing reads a
 * database, a global, or the clock, so the test can drive it directly.
 */

const SLOT_MINUTES = 30;
const MIN_NOTICE_MINUTES = 15;
const ANY_BARBER = 'Any Available';
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
                       'Friday', 'Saturday'];

/**
 * Minutes past midnight for a 24-hour clock string such as '10:00'.
 *
 * Deliberately ignores any AM/PM suffix, matching the browser's copy: these
 * are opening hours out of the settings, which are always 24-hour. Booking
 * times arrive in the other format and go through clockToMinutes().
 */
function parseClock(value) {
  const m = String(value == null ? '' : value).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Minutes past midnight for the '02:30 PM' labels the booking form sends. */
function clockToMinutes(value) {
  const text = String(value == null ? '' : value).trim();
  const m = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  if (m[3]) {
    const period = m[3].toUpperCase();
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
  }
  return hours * 60 + mins;
}

/** '02:30 PM' for 870. The format the diary and the chips both use. */
function minutesToLabel(total) {
  let h = Math.floor(total / 60);
  const mins = total % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12; else if (h > 12) h -= 12;
  return `${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')} ${period}`;
}

/**
 * '14:30' for 870 — the 24-hour form a Postgres `time` column takes.
 *
 * Distinct from minutesToLabel() on purpose. The diary and the chips speak
 * '02:30 PM' because that is what customers read; the database stores a time,
 * and handing it a twelve-hour string with a suffix is how you end up with
 * appointments twelve hours out.
 */
function minutesToClock(total) {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** 'Monday' for 'YYYY-MM-DD', read as a local date so the day never shifts. */
function weekdayNameFor(dateStr) {
  const parts = String(dateStr).split('-');
  if (parts.length !== 3) return '';
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return isNaN(d.getTime()) ? '' : WEEKDAY_NAMES[d.getDay()];
}

/** The shop's entry for the weekday of `dateStr`, or null. */
function hoursForDay(config, dateStr) {
  const list = config.hours;
  if (!Array.isArray(list) || list.length === 0) return null;
  const name = weekdayNameFor(dateStr);
  return list.find(h => String(h.day).trim() === name) || null;
}

function isClosedOn(config, dateStr) {
  const entry = hoursForDay(config, dateStr);
  return entry ? entry.open !== true : false;
}

/** The barber's own entry for that weekday, or null when they have no rota. */
function barberDayEntry(config, barberName, dateStr) {
  const rota = (config.barberHours || {})[String(barberName).trim()];
  if (!Array.isArray(rota)) return null;
  const name = weekdayNameFor(dateStr);
  return rota.find(r => String(r.day).trim() === name) || null;
}

function isBarberOnLeave(config, barberName, dateStr) {
  const wanted = String(barberName).trim();
  return (config.timeOff || []).some(row =>
    String(row.barber).trim() === wanted &&
    dateStr >= row.from && dateStr <= (row.to || row.from));
}

/**
 * Is this barber on the floor at `minutes` past midnight on this date?
 *
 * Their rota narrows the shop hours and never widens them, and a barber with
 * no rota row yet works whenever the shop is open — otherwise adding someone
 * in the panel would make them unbookable until a rota was filled in.
 */
function isBarberWorkingAt(config, barberName, dateStr, minutes) {
  if (isBarberOnLeave(config, barberName, dateStr)) return false;

  const shop = hoursForDay(config, dateStr);
  if (!shop || shop.open !== true) return false;
  const shopFrom = parseClock(shop.from);
  const shopTo = parseClock(shop.to);
  if (shopFrom === null || shopTo === null) return false;
  // The appointment has to finish by closing, not merely start before it.
  if (minutes < shopFrom || minutes + SLOT_MINUTES > shopTo) return false;

  const entry = barberDayEntry(config, barberName, dateStr);
  if (!entry) return true;                  // no rota yet: shop hours apply
  if (entry.working !== true) return false;

  const from = parseClock(entry.from);
  const to = parseClock(entry.to);
  if (from === null || to === null) return true;
  if (minutes < from || minutes + SLOT_MINUTES > to) return false;

  // The daily break. A slot starting inside it is out; one ending exactly as
  // the break begins is still fine.
  const breakFrom = parseClock(entry.breakFrom);
  const breakTo = parseClock(entry.breakTo);
  if (breakFrom !== null && breakTo !== null && breakTo > breakFrom) {
    if (minutes + SLOT_MINUTES > breakFrom && minutes < breakTo) return false;
  }
  return true;
}

/** Every real barber (never ANY_BARBER) rostered at that moment. */
function barbersWorkingAt(config, dateStr, minutes) {
  return (config.barberNames || [])
    .map(n => String(n).trim())
    .filter(n => n && n !== ANY_BARBER)
    .filter(n => isBarberWorkingAt(config, n, dateStr, minutes));
}

/**
 * Bookable start times for a date, before existing bookings are subtracted.
 *
 * `nowMinutes` and `todayStr` are passed in rather than read from the clock:
 * the shop's clock decides what has already gone, not the visitor's, and a
 * test needs to be able to say what time it is.
 */
function slotsForDate(config, dateStr, barberName, todayStr, nowMinutes) {
  const entry = hoursForDay(config, dateStr);
  if (!entry || entry.open !== true) return [];
  const from = parseClock(entry.from);
  const to = parseClock(entry.to);
  if (from === null || to === null || to <= from) return [];

  const earliest = (todayStr && dateStr === todayStr)
    ? nowMinutes + MIN_NOTICE_MINUTES
    : -Infinity;

  const wanted = String(barberName || '').trim() === ANY_BARBER
    ? '' : String(barberName || '').trim();

  const slots = [];
  for (let t = from; t + SLOT_MINUTES <= to; t += SLOT_MINUTES) {
    if (t < earliest) continue;
    const open = wanted
      ? isBarberWorkingAt(config, wanted, dateStr, t)
      : barbersWorkingAt(config, dateStr, t).length > 0;
    if (open) slots.push(minutesToLabel(t));
  }
  return slots;
}

/**
 * Can `wanted` still be booked at this slot, given who already holds it?
 *
 * Each booking occupies one chair. A booking naming a barber takes that
 * barber's chair; a booking made with no preference takes an unspecified one,
 * so it only rules a named barber out once no other chair could absorb it.
 *
 * This is the part a unique index cannot express — it is a counting question,
 * not a uniqueness one — so the database enforces "one named barber, one
 * appointment" and this decides the rest.
 */
function isSlotFree(config, dateStr, slotLabel, holders, wanted) {
  const minutes = clockToMinutes(slotLabel);
  if (minutes === null) return true;

  const working = barbersWorkingAt(config, dateStr, minutes);
  if (working.length === 0) return false;          // nobody on the floor

  const named = [];
  let anonymous = 0;
  (holders || []).forEach(h => {
    const who = String(h || '').trim();
    if (!who || who === ANY_BARBER || who === 'Any') anonymous++;
    else if (named.indexOf(who) === -1) named.push(who);
  });

  const name = String(wanted || '').trim();
  if (!name || name === ANY_BARBER) {
    return (named.length + anonymous) < working.length;
  }

  if (working.indexOf(name) === -1) return false;   // not rostered
  if (named.indexOf(name) !== -1) return false;     // already booked

  // Chairs left after the named bookings, one of which must stay for us.
  const uncommitted = working.filter(w => named.indexOf(w) === -1);
  return anonymous < uncommitted.length;
}

module.exports = {
  SLOT_MINUTES, MIN_NOTICE_MINUTES, ANY_BARBER, WEEKDAY_NAMES,
  parseClock, clockToMinutes, minutesToLabel, minutesToClock, weekdayNameFor,
  hoursForDay, isClosedOn, barberDayEntry, isBarberOnLeave,
  isBarberWorkingAt, barbersWorkingAt, slotsForDate, isSlotFree
};
