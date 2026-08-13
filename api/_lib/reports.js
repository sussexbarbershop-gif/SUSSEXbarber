/**
 * What the shop did, in numbers.
 *
 * Counted in the database rather than in the browser. The panel used to pull
 * every active booking down and add them up on a phone, which meant the phone
 * held the whole customer list to show one total, and the totals stopped at
 * whatever the diary still had — cancelled appointments and last year's work
 * were simply absent.
 *
 * Every figure here is for finished work unless it says otherwise: "revenue"
 * is appointments up to and including today, because an appointment next
 * Tuesday is not money the shop has. What is booked ahead is reported on its
 * own, which is a different question and a useful one.
 *
 * Nothing in here identifies a customer. Counts, sums and a distinct count of
 * phone keys — no names, no numbers. The takings are sensitive enough without
 * carrying the customer list along with them.
 */

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
                       'Saturday', 'Sunday'];

/** The barber's name as it should read, since '' means no preference. */
const ANY = 'Any Available';

const money = v => Math.round(Number(v || 0) * 100) / 100;

/** One row of takings(), in the shape the panel reads. */
const period = rows => ({
  appointments: Number(rows[0].bookings),
  revenue: money(rows[0].revenue),
  customers: Number(rows[0].customers)
});

/** The windows the panel offers, and what anything else falls back to. */
const WINDOWS = [1, 3, 6, 12];
const DEFAULT_WINDOW = 12;

const windowMonths = value => {
  const n = Math.trunc(Number(value));
  return WINDOWS.includes(n) ? n : DEFAULT_WINDOW;
};

/** The first day of the month `months - 1` months before `today`'s month. */
function windowStart(today, months) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const shifted = new Date(Date.UTC(year, month - 1 - (months - 1), 1));
  return shifted.toISOString().slice(0, 10);
}

const asDate = day => new Date(day + 'T00:00:00Z');
const asDay = date => date.toISOString().slice(0, 10);
const shiftDays = (day, n) => asDay(new Date(asDate(day).getTime() + n * 86400000));

/** The Monday of the week `day` falls in. The shop's week starts there. */
function weekStart(day) {
  const weekday = asDate(day).getUTCDay();          // 0 = Sunday
  return shiftDays(day, weekday === 0 ? -6 : 1 - weekday);
}

/** The first and last day of the month before `day`'s. */
function previousMonth(day) {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const first = new Date(Date.UTC(year, month - 2, 1));
  const last = new Date(Date.UTC(year, month - 1, 0));
  return { from: asDay(first), to: asDay(last) };
}

/**
 * `today` is the shop's date, passed in rather than read from the server's
 * clock: Vercel runs in UTC, and at half past midnight in Amsterdam that is
 * still yesterday. A month boundary decided by the wrong clock puts a day's
 * takings in the wrong month.
 *
 * `months` is how far back everything but the lifetime tiles looks — one,
 * three, six or twelve. The page asks for twelve; a download asks for whatever
 * the owner picked, so the file holds the same figures the card would if it
 * were showing that window.
 */
async function readReports(sql, today, months) {
  const span = windowMonths(months);
  const monthStart = today.slice(0, 8) + '01';
  const from = windowStart(today, span);

  // The periods the headline compares against. A figure on its own says
  // nothing: 255 euros this month is good news or bad depending entirely on
  // what last month was, and the owner should not have to remember.
  const lastMonth = previousMonth(today);
  const thisWeekFrom = weekStart(today);
  const lastWeekFrom = shiftDays(thisWeekFrom, -7);
  const lastWeekTo = shiftDays(thisWeekFrom, -1);
  // The same number of days into last week as we are into this one, so a
  // Tuesday is compared with a Tuesday and not with a finished week.
  const daysIn = Math.round((asDate(today) - asDate(thisWeekFrom)) / 86400000);
  const lastWeekSoFar = shiftDays(lastWeekFrom, daysIn);
  // And the same day of last month, for the same reason.
  const lastMonthSoFar = (() => {
    const wanted = shiftDays(lastMonth.from, Number(today.slice(8, 10)) - 1);
    return wanted > lastMonth.to ? lastMonth.to : wanted;
  })();

  // One transaction, not thirteen separate queries.
  //
  // Two reasons, and the second is the real one. It is a single round trip
  // rather than thirteen. And every figure is read from the same snapshot of
  // the database: run apart, a booking taken between the first query and the
  // third would be counted by one and not the other, and the report would say
  // 412 appointments at the top while the barbers underneath added up to 413.
  // Nobody would ever find out why.
  /** Appointments and takings between two days, inclusive. */
  const takings = (a, b) => sql`
    SELECT count(*) AS bookings,
           COALESCE(sum(price), 0) AS revenue,
           count(DISTINCT phone_key) AS customers
      FROM bookings
     WHERE status = 'active' AND booked_on >= ${a} AND booked_on <= ${b}`;

  const [totals, inWindow, thisMonth, ahead, byMonth, barbersOverWindow,
         barbersThisMonth, services, loyalty, newThisMonth, weekdays, hours,
         visits, lastMonthWhole, lastMonthToDate, thisWeek, lastWeekToDate,
         lastWeekWhole] =
    await sql.transaction([
      // Lifetime, and how much of it was called off.
      sql`
        SELECT count(*) FILTER (WHERE status = 'active' AND booked_on <= ${today}) AS done,
               count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
               count(DISTINCT phone_key) FILTER (WHERE status = 'active') AS customers,
               COALESCE(sum(price) FILTER (WHERE status = 'active' AND booked_on <= ${today}), 0) AS revenue
          FROM bookings`,

      // The same, over the window. Without this, a card offering to be
      // downloaded over one month or twelve produced the same file either way,
      // because the figure behind it was neither.
      sql`
        SELECT count(*) FILTER (WHERE status = 'active') AS done,
               count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
               count(DISTINCT phone_key) FILTER (WHERE status = 'active') AS customers,
               COALESCE(sum(price) FILTER (WHERE status = 'active'), 0) AS revenue
          FROM bookings
         WHERE booked_on >= ${from} AND booked_on <= ${today}`,

      sql`
        SELECT count(*) AS done,
               COALESCE(sum(price), 0) AS revenue,
               count(DISTINCT phone_key) AS customers
          FROM bookings
         WHERE status = 'active' AND booked_on >= ${monthStart} AND booked_on <= ${today}`,

      // Still to come — the diary, not the till.
      sql`
        SELECT count(*) AS bookings, COALESCE(sum(price), 0) AS revenue
          FROM bookings
         WHERE status = 'active' AND booked_on > ${today}`,

      // The window, month by month, oldest first. Gaps are filled in so a
      // quiet month reads as a quiet month rather than disappearing.
      sql`
        SELECT to_char(m.month, 'YYYY-MM') AS month,
               count(b.id) AS bookings,
               COALESCE(sum(b.price), 0) AS revenue
          FROM generate_series(date_trunc('month', ${from}::date),
                               date_trunc('month', ${monthStart}::date),
                               interval '1 month') AS m(month)
          LEFT JOIN bookings b
            ON b.status = 'active'
           AND b.booked_on <= ${today}
           AND date_trunc('month', b.booked_on) = m.month
         GROUP BY m.month
         ORDER BY m.month`,

      barberQuery(sql, today, from),
      barberQuery(sql, today, monthStart),

      sql`
        SELECT service,
               count(*) AS bookings,
               COALESCE(sum(price), 0) AS revenue
          FROM bookings
         WHERE status = 'active' AND booked_on <= ${today} AND booked_on >= ${from}
         GROUP BY service
         ORDER BY bookings DESC, service
         LIMIT 10`,

      // How many came back. One visit is not a customer yet.
      sql`
        SELECT count(*) FILTER (WHERE visits = 1) AS once,
               count(*) FILTER (WHERE visits > 1) AS returning,
               COALESCE(round(avg(visits), 2), 0) AS average
          FROM (SELECT phone_key, count(*) AS visits
                  FROM bookings
                 WHERE status = 'active' AND booked_on <= ${today} AND booked_on >= ${from}
                 GROUP BY phone_key) AS per_customer`,

      // Faces the shop had not seen before this month.
      sql`
        SELECT count(*) AS first_timers
          FROM (SELECT phone_key, min(booked_on) AS first_seen
                  FROM bookings
                 WHERE status = 'active'
                 GROUP BY phone_key) AS per_customer
         WHERE first_seen >= ${monthStart} AND first_seen <= ${today}`,

      sql`
        SELECT EXTRACT(ISODOW FROM booked_on)::int AS weekday, count(*) AS bookings
          FROM bookings
         WHERE status = 'active' AND booked_on <= ${today} AND booked_on >= ${from}
         GROUP BY 1 ORDER BY 1`,

      sql`
        SELECT EXTRACT(HOUR FROM booked_at)::int AS hour, count(*) AS bookings
          FROM bookings
         WHERE status = 'active' AND booked_on <= ${today} AND booked_on >= ${from}
         GROUP BY 1 ORDER BY 1`,

      sql`SELECT value FROM settings WHERE key = 'visit_count'`,

      // Last month whole, and last month up to the same day — one says whether
      // the month beat the last one, the other whether it is on course to.
      takings(lastMonth.from, lastMonth.to),
      takings(lastMonth.from, lastMonthSoFar),
      takings(thisWeekFrom, today),
      takings(lastWeekFrom, lastWeekSoFar),
      takings(lastWeekFrom, lastWeekTo)
    ]);

  const lifetime = totals[0];
  const month = thisMonth[0];
  const upcoming = ahead[0];
  const repeat = loyalty[0];

  const doneAll = Number(lifetime.done);
  const cancelled = Number(lifetime.cancelled);

  const siteVisits = visits.length ? Number(visits[0].value) || 0 : 0;

  return {
    // Everything is "as at" this date, and the panel says so — a figure with
    // no date on it is the kind that gets quoted a week later as today's.
    asAt: today,

    // How far back everything but the lifetime tiles is counted from, and
    // what happened inside it.
    window: {
      months: span,
      from,
      appointments: Number(inWindow[0].done),
      customers: Number(inWindow[0].customers),
      revenue: money(inWindow[0].revenue),
      cancelled: Number(inWindow[0].cancelled),
      cancelledShare: Number(inWindow[0].done) + Number(inWindow[0].cancelled) > 0
        ? Math.round((Number(inWindow[0].cancelled) /
                     (Number(inWindow[0].done) + Number(inWindow[0].cancelled))) * 100)
        : 0
    },

    lifetime: {
      appointments: doneAll,
      customers: Number(lifetime.customers),
      revenue: money(lifetime.revenue),
      cancelled,
      // Of everything ever booked, the share that was called off.
      cancelledShare: doneAll + cancelled > 0
        ? Math.round((cancelled / (doneAll + cancelled)) * 100) : 0,
      siteVisits,
      // What the old Analytics page called "visits that booked". It is a rough
      // number and always was: a visit is counted on every page load, so one
      // customer reading the prices twice is two visits. Useful as a trend,
      // not as a rate.
      bookedShare: siteVisits > 0
        ? Math.round(((doneAll + Number(upcoming.bookings)) / siteVisits) * 100) : 0
    },

    thisMonth: {
      from: monthStart,
      appointments: Number(month.done),
      revenue: money(month.revenue),
      customers: Number(month.customers),
      newCustomers: Number(newThisMonth[0].first_timers)
    },

    // What the headline is measured against. "So far" is the same number of
    // days into the earlier period, so a Tuesday is compared with a Tuesday
    // rather than with a finished week that was always going to be bigger.
    compare: {
      thisWeek: Object.assign({ from: thisWeekFrom, to: today }, period(thisWeek)),
      lastWeekSoFar: Object.assign({ from: lastWeekFrom, to: lastWeekSoFar }, period(lastWeekToDate)),
      lastWeek: Object.assign({ from: lastWeekFrom, to: lastWeekTo }, period(lastWeekWhole)),
      lastMonthSoFar: Object.assign({ from: lastMonth.from, to: lastMonthSoFar }, period(lastMonthToDate)),
      lastMonth: Object.assign({ from: lastMonth.from, to: lastMonth.to }, period(lastMonthWhole))
    },

    upcoming: {
      appointments: Number(upcoming.bookings),
      revenue: money(upcoming.revenue)
    },

    months: byMonth.map(r => ({
      month: r.month,
      appointments: Number(r.bookings),
      revenue: money(r.revenue)
    })),

    barbers: {
      window: asBarbers(barbersOverWindow),
      thisMonth: asBarbers(barbersThisMonth)
    },

    services: services.map(r => ({
      service: r.service,
      appointments: Number(r.bookings),
      revenue: money(r.revenue)
    })),

    loyalty: {
      onceOnly: Number(repeat.once),
      returning: Number(repeat.returning),
      averageVisits: Number(repeat.average)
    },

    // Seven and twenty-four entries, zeros included, so the panel can draw
    // them without deciding what a missing day means.
    weekdays: WEEKDAY_NAMES.map((day, i) => {
      const row = weekdays.find(r => Number(r.weekday) === i + 1);
      return { day, appointments: row ? Number(row.bookings) : 0 };
    }),

    hours: Array.from({ length: 24 }, (_, h) => {
      const row = hours.find(r => Number(r.hour) === h);
      return { hour: h, appointments: row ? Number(row.bookings) : 0 };
    })
  };
}

/**
 * Per barber: how many chairs they filled, what it came to, and how long they
 * were actually cutting.
 *
 * The minutes come from the service, which is stored on the booking as text.
 * A LATERAL with LIMIT 1 rather than a plain join: two services can share a
 * name across the English and Dutch columns, and a join would then count the
 * appointment twice.
 */
function barberQuery(sql, today, from) {
  // Returned rather than awaited: the caller puts it in the transaction with
  // everything else, so these totals come from the same snapshot as the ones
  // they are meant to agree with.
  return sql`
    SELECT CASE WHEN b.barber = '' THEN ${ANY} ELSE b.barber END AS barber,
           count(*) AS appointments,
           COALESCE(sum(b.price), 0) AS revenue,
           COALESCE(sum(s.duration_min), 0) AS minutes
      FROM bookings b
      LEFT JOIN LATERAL (
             SELECT duration_min FROM services s
              WHERE s.name_en = b.service OR s.name_nl = b.service
              ORDER BY s.position LIMIT 1) s ON true
     WHERE b.status = 'active' AND b.booked_on <= ${today} AND b.booked_on >= ${from}
     GROUP BY 1 ORDER BY appointments DESC, barber`;
}

const asBarbers = rows => rows.map(r => ({
  barber: r.barber,
  appointments: Number(r.appointments),
  revenue: money(r.revenue),
  minutes: Number(r.minutes)
}));

module.exports = { readReports, WINDOWS, DEFAULT_WINDOW, windowMonths, windowStart };
