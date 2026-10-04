# Sussex Barber Shop

The booking site for a barber shop in Wassenaar, Netherlands.
Live at **[sussexbarber.nl](https://sussexbarber.nl)**.

A customer picks a barber, a service, a date and a time, and leaves a name and
a phone number. The shop sees it immediately, gets an email, and works the
diary from a panel at `/admin`. There are no accounts and no passwords for
customers. Phone numbers identify bookings but do not authorize access to them.

This repository is public. Nothing secret is in it and nothing secret may go
into it — the database URL, the panel password, the owner's PIN and the API
keys all live in Vercel's environment variables, and
[MIGRATION.md](MIGRATION.md) lists what each one is for without ever giving a
value. A pull request from a fork cannot read any of them.

**Changing this code?** Read [AGENTS.md](AGENTS.md) first — the five things
that will catch you out, and the house style. It is written for a person or a
model arriving with no context.

---

## Where things are

```
index.html          the whole public site: markup, styles and script in one file
assets/site-polish.css public visual refinements, loaded after the base styles
assets/phone.js     shared country-aware phone parsing and country selector
assets/mobile-booking.js mobile date/time sheets reusing the live booking controls
assets/vendor/      pinned local libphonenumber bundle and its licence
admin/booking-editor.js PIN-gated booking drafts, slot checks and in-place updates
admin/password-visibility.js temporary password reveal with a five-second idle timer
admin/              the shop's panel — index.html, admin.js, admin.css
api/
  index.js          every request the site makes, on one route
  daily.js          the reminder and the evening round; only the clock calls it
  _lib/
    db.js           the database, and the shape the site reads it in
    booking-edit.js owner-only updates with optimistic and schedule concurrency guards
    rota.js         who is working when, and whether a slot is free
    mail.js         the four emails a customer can get
    auth.js         the panel password, the owner's PIN, the cancel token
    limits.js       how often one number may book
    reports.js      the takings, for the owner's page
db/schema.sql       the database, and why each column is the way it is
tests/              50 files, run by `npm test`
                    booking-overlap.postgres.cjs: isolated PostgreSQL integration checks
MIGRATION.md        how the backend works and what to set up from nothing
```

Everything in `api/_lib/` is a plain module with no framework in it. Anything
starting with `_` is invisible to Vercel's routing, which is why the folder is
named that way.

Gallery Management also contains The Sussex Experience photo. It was formerly
hard-coded in the home page, so gallery changes could not replace it. Choosing
a photo now uses the existing compressed image upload and saves only the
`about_image` setting. The preview changes only after the server confirms the
save; older settings and failed public image loads retain the original photo.
The same page now edits the homepage background and the dark/light logos,
which were also fixed in CSS/markup. Logos are resized as transparent PNG in
the browser and on the server; ordinary photos still use compressed JPEG.
The homepage preserves its light/dark overlays, and saved logos also update
the panel branding. These separate image settings survive text-form pruning.
Home-screen and tab icons keep their existing dedicated icon editor.
On phones, booking filter tabs wrap so Review's selected Time off conflicts
tab stays visible. Branding file pickers use panel button styling and stay
within the card width, including when the chosen filename is long.

---

The public visual layer uses a 64px mobile header (plus the safe-area inset),
consistent sans-serif controls, one booking form border and square gallery tiles.
Gold marks primary actions, focus and selections; secondary actions stay neutral.
The header height is still measured for scrolling. Gallery originals remain
available in the lightbox; CMS images use the same tile geometry.

Panel usernames accept any letter case (`admin`, `Admin`, `ADMIN`). Previously
the browser rejected capitalized usernames before contacting the server. Passwords
remain case-sensitive and are sent unchanged to the existing server check.
The login eye reveals the password for five idle seconds. Typing/caret activity
renews the timer; composition pauses it until finished. Leaving the field group,
submitting, or leaving the tab/window hides it immediately, without changing its value.
`tests/password-visibility.test.js` exercises these transitions with a fake clock.

## How a booking travels

1. **The browser** works out which slots to offer, from `hoursForDay` and
   `isBarberWorkingAt` in `index.html`. It asks `/api?date=…` for the ones
   already taken and greys those out.
2. **The customer submits.** `addBooking` in `api/index.js` checks the whole
   thing again — the browser is not trusted, because the form is public.
3. **`refuseBooking`** is the gate: the date, the notice period, the barber's
   rota, the per-number limit, and whether the slot is still free.
4. **The row is written.** `bookings_no_overlap` excludes overlapping active
   intervals for the same named barber, even when two requests arrive together.
   The old unique index only prevented identical starts, allowing 10:15 inside
   a 10:00 appointment. Cancelled appointments release their intervals.
5. **Emails go out** afterwards, never before — and their failure is swallowed,
   because the booking is already saved and a bounced address must not be
   reported to the customer as a failed appointment.

Customers cancel only through a signed link delivered to their stored email,
then explicitly confirm on the cancellation page. Looking up by phone/email
only requests an email listing active upcoming bookings; the public response
never contains bookings, recipient addresses or cancellation tokens. Each
stored email receives only its own bookings, even if a family shares a phone.
The old phone lookup disclosed the diary and phone/date/time cancellation could
cancel several appointments at once. That public write is now refused; staff
use their panel password and the database booking ID, including for no-email
bookings. Email remains optional, with an English/Dutch warning before submitting
without it. It explains the missing confirmation and cancellation link, cancelling
then rebooking an available time, and contacting the shop without email. The
picker-style sheet uses the existing blurred backdrop and glass panel. Add email,
Close, backdrop and Escape return without booking; only Book without email
continues. The buttons stay visible above a scrolling message on short screens.
Keyboard focus stays inside the sheet and the background is inert while it waits.
Changing a time still requires contacting the shop; no rescheduling feature
is implied by providing an email.

Email requests require an explicit click (no background lookup on page load
or booking confirmation). The same generic response covers absent bookings,
missing emails, throttling and mail delivery failures; it asks the customer to
contact the shop if nothing arrives. Existing per-IP limits remain, with an
additional hashed-recipient cap of 3 emails/hour and 6/day that fails closed.
No existing booking or cancellation link is rewritten by this change.
`tests/booking-email-access.test.js` covers disclosure, recipient isolation,
mail failure, unauthenticated refusal and authenticated single-booking cancel.

The service duration saved by the owner now controls public and panel time
pickers, closing/break checks, availability and calendar exports. Previously
these treated bookings as thirty minutes regardless of the panel's duration.
Each booking saves its own `duration_min`: editing a service changes new
bookings, never silently lengthens old ones. Existing bookings retain their
original thirty-minute windows; offered starts still use the thirty-minute grid.

Time off blocks the whole date range, including both endpoints. The barber
dialog keeps edits open until the server confirms them; a failed save no
longer looks like a saved holiday. Blank/invalid dates reject the entire save.
Availability also blocks an old browser tab's pre-leave slots. The final insert
rechecks leave under the same transaction lock as schedule saves, so a booking
that read an older rota cannot slip in after leave is committed. “Any Available”
tries another working barber. Existing bookings are never cancelled by a leave
save. Before saving conflicting leave, the owner sees the booking dates, times,
barbers and services and chooses Continue or Cancel. Cancel keeps the draft and
saves nothing. A newly arrived booking requires another review. After saving,
a prominent warning is rebuilt from the saved leave and live diary on refresh;
it remains until the conflicts are resolved. Review Bookings used to open the
whole diary; it now selects Time off conflicts and the affected barber (or
everyone when several barbers are affected). Only active upcoming bookings
inside their own barber's saved leave appear, including both boundary dates.
Cancelled bookings and removed leave drop out on the next redraw. The same
filter applies to CSV export; All exits it, retaining the selected barber.

The email signing key, `cancel_key`, stays on the server. The public config
used to return it alongside the website text, letting a visitor sign a cancel
link for another booking. Both config actions now omit it, and CMS saves
cannot create, replace or delete it. Existing email links keep working.
Stopping disclosure does not revoke a key already copied; see the signing-key
rotation notes in [MIGRATION.md](MIGRATION.md) before deploying this fix.

---

## The two rules worth knowing before changing anything

**The rota exists twice.** In `index.html`, so the browser can grey out a day
without asking, and in `api/_lib/rota.js`, where the booking is actually
accepted. If they disagree, a customer is offered a slot, fills in the form,
and is then refused — the worst failure this site has, and neither file looks
wrong on its own. `tests/rota-agreement.test.js` runs both over the same matrix
and fails on the first disagreement.

**The shop's clock decides, not the visitor's.** `shopNow()` reads the time in
`Europe/Amsterdam`. Vercel runs in UTC, and a phone set to the wrong time is
not a reason to refuse a booking or to offer one that has gone.

---

## Running it

```bash
npm install
npm test
```

The tests need no database and no network — they read the source and drive the
real functions, which is why the whole suite runs in seconds.

For the database race and migration checks, set `TEST_DATABASE_URL` to a
disposable PostgreSQL server on localhost and run `npm run test:postgres`.
It needs permission to install `btree_gist` and create schemas. It creates and
drops only its own randomly named schema; it refuses remote database URLs.
Never use a production database for this test. The separate suite drives the
real booking API, owner service save, concurrent inserts and automatic upgrade.
It also checks leave saves, stale requests, both date boundaries, and existing
booking preservation. No real customer or live database is used.

There is no build step for the site. `assets/tailwind.css` is compiled and
committed; if you add a Tailwind class, run:

```bash
npm run build:css
```

`tests/tailwind-build.test.js` fails if you forget — an uncompiled class is not
an error anywhere else, the markup simply looks wrong.

---

## What the tests are for

Not coverage. Each one is a bug that happened, written down so it cannot happen
twice. A few worth reading before making changes in their area:

| Test | The bug it remembers |
|---|---|
| `rota-agreement` | the browser and the server disagreeing about a slot |
| `api-dates` | a date leaving the API as `Fri Aug 07 2026 00:00:00 GMT+0000` |
| `scroll-lock` | the page sliding sideways by the width of the scrollbar |
| `panel-structure` | one stray `</div>` putting two pages outside the padding |
| `booking-clash` | two customers, one chair |
| `service-duration` | a longer service running past closing or through a break |
| `daily-job` | a reminder sent twice, or not at all |
| `private-settings` | the public config exposing the cancel signing key, and an old panel tab overwriting it |
| `image-upload` | a phone photo published with its GPS coordinates in it |
| `docs-current` | this file describing a file that had been renamed away |
| `reminder-fallback` | every reminder depending on a button somebody had to press |

---

## Customers

`customers` holds one row per phone number, and every booking points at it.
Nothing uses it yet.

It is there because the questions the shop will eventually ask — is this a
regular, does this promo code apply, how much is left on this gift card — are
questions about a *person*, and the diary can only answer questions about
appointments. You can count rows sharing a phone number; you cannot attach
anything to whoever they belong to.

A discount, a promo code, a loyalty count or a gift card each becomes its own
table referencing `customers(id)`. None of them needs this one to change.

---

## Things that will bite

**The panel password and the owner's PIN are different secrets.** Staff sign in
to work the diary; the takings, the prices and the shop's hours are behind the
PIN. `ADMIN_PASSWORD` and `REPORTS_PIN`.

**The reminders run on GitHub Actions**, because a Vercel Hobby cron runs once a
day and "before the appointment" cannot be done once a day. GitHub is asked for
forty-eight runs a day and starts six to eleven of them, with gaps up to three
hours — so the round looks at least two hours ahead rather than one, because a
gap wider than the window loses a reminder rather than delaying it. A visitor's
request also sets the round off when it has gone half an hour overdue, which on
this schedule happens most days. `LEAST_MINUTES_AHEAD` and
`standInForTheClock()`, and MIGRATION.md for the whole picture.

**Email fails silently by design.** Nothing on the site shows it. The reason is
in `mail.js`; the place to look is the Vercel log, for a line starting
`[mail]`.

**`db/schema.sql` is not enough on its own.** `CREATE TABLE IF NOT EXISTS` does
nothing to a table that already exists, so new columns are also listed at the
foot of that file *and* applied by `ensureSchema()` in `db.js` when a query
first trips over one missing. Add a column in all three places or a live
database quietly keeps the old shape.

## International phone numbers

New web and staff bookings require a complete number, with Netherlands (+31)
as the initial country choice. The locally bundled, pinned libphonenumber-js
parser checks possible length and structure, not ownership; there are no SMS,
paid services or phone-data lookups. Explicit +/00 international numbers override
the selected default country. Raw input remains in phone; phone_e164 stores the
new booking's canonical number. Both browser and API use assets/phone.js.

Old raw numbers, booking IDs, customer links and signed email links are untouched.
The old suffix-based customer backfill is retired because initial staff numbers
may be placeholders. New customer keys use an e164: namespace and never inherit
legacy profiles. Reports preserve historical legacy grouping and separate new
canonical identities, so the same returning person may count separately across
the transition; revenue and appointment counts do not change.

Lookup and booking limits compare full canonical numbers. For old rows, only
complete digit variants match: explicit international forms, Dutch local form,
or an exact whole-digit match for an unparseable legacy search. No suffix-only
fallback remains. Uncertain old numbers can still be managed by staff or found
by stored email; country codes are never backfilled by guessing.

The phone_e164 column and its index are additive and installed through
withNewSchema. Rollback leaves these nullable fields in place and retains all
bookings, including those created after deployment. tests/booking-email-access.test.js
and the PostgreSQL integration suite cover NL/GB suffix collisions, Iraq local
format, equivalent Dutch prefixes, recipient separation and unchanged legacy rows.

The lookup form hides its country selector for email input, shows a country-specific
mobile example for phone input, and reports incomplete input inline before sending.
Examples are locally bundled from the same pinned library and never become input.
English/Dutch errors are linked to the field for assistive technology. This stricter
public form does not rewrite legacy records; uncertain old numbers should be looked
up by their recorded email or managed by staff. The API legacy matching stays intact.

Phone fields use a compact dial-code picker to the left of the input in public
booking, lookup and staff booking forms. The native menu retains full country names.
Changing country updates the booking placeholder, including after form reset and
language changes, without changing a number already typed. This fixes the booking
form retaining a Dutch example when Italy was selected.

The pre-submit booking summary uses two compact rows with explicit Edit actions
for service/barber and date/time. Editing reuses the existing wizard steps without
resetting contact inputs; changing a selection retains the normal availability checks.
Edit controls cannot navigate while a booking submission is pending.

Booking summary and confirmation dates show a short weekday, month name and year
in English or Dutch, refreshed on language changes. Formatting uses UTC explicitly
for date-only values, so visitor time zones cannot shift the displayed day. Inputs,
API payloads and stored booking dates retain their original YYYY-MM-DD values.

The date picker shows exactly 30 consecutive dates including today on the
Amsterdam clock, crossing month and year boundaries. Previously it stopped at
month-end and could show only a few dates. The compact month-range heading
replaces month navigation; weekday alignment and closed/time-off checks remain.
This is a display window, not 30 available working days. No availability or
stored appointment rules are changed.

Below 640px, date and time use compact 48px buttons that open the existing
blurred bottom-sheet style. The actual calendar/time controls move into one
dialog and return on close; there are no duplicated IDs, availability requests
or scheduling rules. Selecting closes it, while Escape/backdrop/Close preserve
the selection. Changing date still clears time and refetches availability.
The dialog traps focus, makes the background inert and restores scrolling;
resizing to desktop restores the inline controls. The shared step indicator
is compact on all three mobile steps. Desktop retains its original layout.
The booking introduction now uses short English/Dutch copy and a My Bookings
disclosure. Mobile spacing and title size are reduced so the first choice is
closer to the top; the lookup still has a 44px touch target and the same email
request flow. Desktop spacing and heading sizes remain unchanged.
All step changes and booking entry links scroll to the start of the booking
section, keeping My Bookings and the compact introduction visible below the
measured navigation bar. The sticky step indicator still clears that bar by 8px.
Book Another uses the same step transition without a second competing scroll.

Contact validation now shows persistent errors beneath name, phone and optional
email, instead of native bubbles and disappearing toasts. Submitting checks all
three and focuses the first invalid field before any email warning or request.
Leaving a contact field with Tab or touch validates it before Submit, without
moving focus back; untouched fields stay quiet. Correcting a field clears its
error; country and language changes refresh it.
Draft values survive validation and summary edits. English/Dutch messages use
the existing phone parser and email rules; the no-email confirmation stays in
place. Successful form reset clears validation state. No stored bookings change.

Booking retries carry a random request key, bound to a digest of the original
input and protected by a unique database index. A lost response previously
allowed Any Available retries to reserve a second barber. Replays now return
the saved result without sending notifications again; changed inputs and
cancelled appointments cannot reuse a key. Legacy rows retain NULL keys.
The browser keeps only a key/digest in session storage, retains form fields on
network errors, and allows a same-details retry after a 20-second timeout.
Real concurrent retries are checked in tests/booking-overlap.postgres.cjs.

`tests/booking-retry.test.js` exercises the real browser submission handler with
controlled failed responses and timeouts, without sending bookings or emails.

Booking UX: the time step shows the selected barber, services and current total
with an Edit action that preserves the form. Mobile time sheets show the chosen
date in English/Dutch. Action labels name the next step. Confirmation prioritises
date/time, displays the server-assigned barber and admin-managed shop address,
and highlights the existing Add to Calendar action without changing calendar
export or booking rules.

## Editing an appointment

Each diary row has Edit beside Cancel in a non-wrapping action row on phones
and desktops; narrow screens retain the existing horizontal table scroll. Each opening asks for the owner PIN.
Management and Edit share one PIN-unlock request, including whitespace trimming.
Edit resolves the table's display id (`BK-100`, etc.) to its `bookingId` before
opening a draft. Previously it sent the display id to the API, which accepted
the PIN but then refused the booking. The server id stays fixed for that draft
even if a refresh reorders the diary.
The editor previously omitted trimming and used a password field susceptible to
panel-password autofill; it now uses Management's masked-text PIN field and
password-manager hints. PIN verification still happens on the server, and a
refused editing pass is reported separately from a refused PIN.
The PIN card reuses Management's lock, heading, masked input and gold Unlock
button; the short PIN prompt fits a compact modal, while the edit form keeps
its full-height mobile sheet. Row actions have equal sizes and 44px mobile
touch targets, with space between Edit and Cancel.
Add Booking and Edit share the same modal field styling, header, responsive
columns and sticky action footer. Both start with the customer name, then
barber/service and scheduling, followed by full-width phone and optional email.
Add retains its available-time buttons and existing booking rules; its barber
and service controls now use the same native selects as Edit.
The server requires the panel password and owner PIN/pass for fetching private
contact details, checking edit slots and saving. The form starts with the saved
name, barber, service, date, time, phone and email; Discard changes writes nothing.

Updates keep the booking id, source and creation time. Unchanged services keep
their recorded price and duration; a different service takes its current values.
Legacy phone/email values may remain unchanged, but replacement contact details
are validated. Contact corrections may keep an old date or a saved time-off
conflict; changing the schedule checks the rota and overlapping appointments.
Owners can also correct historical dates, but no update email is sent for them.
Changing the canonical phone clears the old customer link, never another
customer's record. Rescheduling resets the reminder timestamp.

A content fingerprint rejects stale edits; a schedule fingerprint is rechecked
under the same transaction lock as booking inserts and rota saves. The update
checks overlaps again under that lock and retains the database exclusion guard.
No cancelled row is revived. Optional updated-details mail is sent only after
saving, only when staff checks the box, and never for a past appointment.
A mail failure reports a saved booking without claiming email delivery.

Run `npm run test:edit-postgres` with TEST_DATABASE_URL pointing to a disposable
local PostgreSQL server to verify real update races and rollback behavior.
It creates/drops its own random schema and sends no mail. The existing
`npm run test:postgres` separately covers the production exclusion constraint.
