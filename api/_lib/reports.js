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

/**
 * `today` is the shop's date, passed in rather than read from the server's
 * clock: Vercel runs in UTC, and at half past midnight in Amsterdam that is
 * still yesterday. A month boundary decided by the wrong clock puts a day's
 * takings in the wrong month.
 */
async function readReports(sql, today) {
  const monthStart = today.slice(0, 8) + '01';

  const [totals, thisMonth, ahead, months, barbersAllTime, barbersThisMonth,
         services, loyalty, newThisMonth, weekdays, hours, visits] =
    await Promise.all([
      // Lifetime, and how much of it was called off.
      sql`
        SELECT count(*) FILTER (WHERE status = 'active' AND booked_on <= ${today}) AS done,
               count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
               count(DISTINCT phone_key) FILTER (WHERE status = 'active') AS customers,
               COALESCE(sum(price) FILTER (WHERE status = 'active' AND booked_on <= ${today}), 0) AS revenue
          FROM bookings`,

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

      // Twelve months of trade, oldest first, gaps included so a quiet month
      // reads as a quiet month rather than disappearing off the chart.
      sql`
        SELECT to_char(m.month, 'YYYY-MM') AS month,
               count(b.id) AS bookings,
               COALESCE(sum(b.price), 0) AS revenue
          FROM generate_series(date_trunc('month', ${monthStart}::date) - interval '11 months',
                               date_trunc('month', ${monthStart}::date),
                               interval '1 month') AS m(month)
          LEFT JOIN bookings b
            ON b.status = 'active'
           AND b.booked_on <= ${today}
           AND date_trunc('month', b.booked_on) = m.month
         GROUP BY m.month
         ORDER BY m.month`,

      barberRows(sql, today, null),
      barberRows(sql, today, monthStart),

      sql`
        SELECT service,
               count(*) AS bookings,
               COALESCE(sum(price), 0) AS revenue
          FROM bookings
         WHERE status = 'active' AND booked_on <= ${today}
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
                 WHERE status = 'active' AND booked_on <= ${today}
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
         WHERE status = 'active' AND booked_on <= ${today}
         GROUP BY 1 ORDER BY 1`,

      sql`
        SELECT EXTRACT(HOUR FROM booked_at)::int AS hour, count(*) AS bookings
          FROM bookings
         WHERE status = 'active' AND booked_on <= ${today}
         GROUP BY 1 ORDER BY 1`,

      sql`SELECT value FROM settings WHERE key = 'visit_count'`
    ]);

  const lifetime = totals[0];
  const month = thisMonth[0];
  const upcoming = ahead[0];
  const repeat = loyalty[0];

  const doneAll = Number(lifetime.done);
  const cancelled = Number(lifetime.cancelled);

  return {
    // Everything is "as at" this date, and the panel says so — a figure with
    // no date on it is the kind that gets quoted a week later as today's.
    asAt: today,

    lifetime: {
      appointments: doneAll,
      customers: Number(lifetime.customers),
      revenue: money(lifetime.revenue),
      cancelled,
      // Of everything ever booked, the share that was called off.
      cancelledShare: doneAll + cancelled > 0
        ? Math.round((cancelled / (doneAll + cancelled)) * 100) : 0,
      siteVisits: visits.length ? Number(visits[0].value) || 0 : 0
    },

    thisMonth: {
      from: monthStart,
      appointments: Number(month.done),
      revenue: money(month.revenue),
      customers: Number(month.customers),
      newCustomers: Number(newThisMonth[0].first_timers)
    },

    upcoming: {
      appointments: Number(upcoming.bookings),
      revenue: money(upcoming.revenue)
    },

    months: months.map(r => ({
      month: r.month,
      appointments: Number(r.bookings),
      revenue: money(r.revenue)
    })),

    barbers: {
      lifetime: barbersAllTime,
      thisMonth: barbersThisMonth
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
async function barberRows(sql, today, from) {
  const rows = from
    ? await sql`
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
         GROUP BY 1 ORDER BY appointments DESC, barber`
    : await sql`
        SELECT CASE WHEN b.barber = '' THEN ${ANY} ELSE b.barber END AS barber,
               count(*) AS appointments,
               COALESCE(sum(b.price), 0) AS revenue,
               COALESCE(sum(s.duration_min), 0) AS minutes
          FROM bookings b
          LEFT JOIN LATERAL (
                 SELECT duration_min FROM services s
                  WHERE s.name_en = b.service OR s.name_nl = b.service
                  ORDER BY s.position LIMIT 1) s ON true
         WHERE b.status = 'active' AND b.booked_on <= ${today}
         GROUP BY 1 ORDER BY appointments DESC, barber`;

  return rows.map(r => ({
    barber: r.barber,
    appointments: Number(r.appointments),
    revenue: money(r.revenue),
    minutes: Number(r.minutes)
  }));
}

module.exports = { readReports };
