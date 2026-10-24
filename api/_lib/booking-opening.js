// One launch, not a recurring date rule: after completion a manual closure must
// stay closed. The protected marker and switch change in ONE SQL statement,
// including when several cold functions reach midnight together.
const KEY = 'booking_launch_2026_11_01';
const AT = '2026-11-01 00:00:00 Europe/Amsterdam';
const OPENS_AT = '2026-10-31T23:00:00.000Z';

async function apply(sql, at = null) {
  // Only local tests supply a clock. Production uses the database clock;
  // neither an HTTP payload nor a visitor's device can bring opening forward.
  const clock = at === null ? null : new Date(at).toISOString();
  return sql`
    WITH opening AS (
      INSERT INTO settings (key, value)
      VALUES (${KEY}, CASE WHEN COALESCE(${clock}::timestamptz, CURRENT_TIMESTAMP) >= ${AT}::timestamptz
        THEN 'completed' ELSE 'pending' END)
      ON CONFLICT (key) DO UPDATE SET value = 'completed'
        WHERE settings.value = 'pending'
          AND COALESCE(${clock}::timestamptz, CURRENT_TIMESTAMP) >= ${AT}::timestamptz
      RETURNING value
    )
    INSERT INTO settings (key, value)
      SELECT 'booking_open', 'yes' FROM opening WHERE value = 'completed'
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      RETURNING value`;
}

function describe(rows, now = Date.now()) {
  const status = rows.find(row => row.key === KEY)?.value || 'pending';
  return { status, opensAt: OPENS_AT,
    checkAfterMs: status === 'pending' ? Math.max(0, Date.parse(OPENS_AT) - now) : null };
}

module.exports = { KEY, AT, OPENS_AT, apply, describe };
