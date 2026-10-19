# Flexible Any Available bookings

bookings.barber is the assigned chair; bookings.flexible records the explicit
Any Available preference. Previously assignment lost that choice. Migration
defaults every existing row to false: old preferences cannot be inferred.

## Rules and displays

Specific requests stay fixed. Only explicit flexible bookings that have not
started may move automatically. New assignments follow shop priority; existing
assignments are retained where possible. Destinations must cover the full saved
service duration, excluding lunch, leave and other bookings. Transitive overlaps
are included. Unknown anonymous legacy chairs and exhausted search fail closed.
A move retains ID, time, service, duration, price, contacts and cancellation links.

Customers keep seeing Any Available in confirmation, retries, reminders,
booking-list emails and cancellation lookup. Staff see the assigned chair plus
an Any Available label in the diary and Week. The Any filter includes these
assigned flexible bookings. Reports continue to use the assigned chair.
Contact-only edits preserve preference. Selecting a named barber fixes the
booking; selecting Any Available releases the preference. Owner PIN is required.
No extra customer email is sent for internal reassignment.

## Atomic writes

api/_lib/flexible-plan.js is a pure bounded interval assignment search.
api/_lib/flexible-bookings.js fingerprints the diary/config before planning.
Final writes acquire the existing schedule advisory lock (73021, 2047), lock
booking rows in ID order, and reject a changed fingerprint. Row locks serialize
cancellation/reminder updates as well as the schedule-locked writers.

Moved rows are checked against the Amsterdam database clock again. Chairs are
cleared only inside the same uncommitted transaction, then all proposed chairs
and the final insert/update are written. This permits swaps while keeping both
the non-deferrable exclusion and unique chair index active. Other transactions
never see temporary empty chairs. Any failure rolls back all movements. Owner
updates add version/config guards before releasing the edited row's old chair.

The request key is checked before planning and remains unique at insert, so
lost-response retries cannot create another appointment. Stale creation plans
retry up to three times; stale owner edits ask the owner to reopen the booking.
Emails run only after successful commit. Division-by-zero SQL guards abort a
stale transaction and are handled as retryable conflicts, never successes.

The fingerprint covers the whole diary and small config tables; row locking is
intentionally coarse for this small shop. Large growth should prompt date-scoped
fingerprints/locks with equivalent cancellation/edit race tests. No personal
fingerprint data is returned to the client.

## Verification

- npm test: full offline suite, including tests/flexible-plan.test.js and 1,500
  deterministic comparisons with an independent exhaustive assignment oracle.
  Includes named/legacy immutability, duration, lunch, leave and mail labels.
- npm run test:postgres: disposable local PostgreSQL, real API/schema/exclusion.
  Tests displacement, full capacity, lunch, concurrent requests, swaps, forced
  rollback, stale cancellation/config, preference editing and ordinary retries.
- Additional real-API regressions cover a three-chair transitive chain, an
  owner edit releasing its chair for a displaced appointment, concurrent
  duplicate retries with existing flexible capacity (one row and one email),
  the database-clock refusal for started appointments, and migration preserving
  every historical field while defaulting preference to fixed.
- npm run test:edit-postgres: stale owner edits, configuration changes, overlap
  races and cancellation preservation against real SQL.

Database runners enforce localhost and never use production. UI verification
uses synthetic localhost fixtures without real appointments or emails; physical
Android/iOS devices are not part of that check.
