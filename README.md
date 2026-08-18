# Sussex Barber Shop

The booking site for a barber shop in Wassenaar, Netherlands.
Live at **[sussexbarber.nl](https://sussexbarber.nl)**.

A customer picks a barber, a service, a date and a time, and leaves a name and
a phone number. The shop sees it immediately, gets an email, and works the
diary from a panel at `/admin`. There are no accounts and no passwords for
customers — a phone number is who you are.

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
admin/              the shop's panel — index.html, admin.js, admin.css
api/
  index.js          every request the site makes, on one route
  daily.js          the reminder and the evening round; only the clock calls it
  _lib/
    db.js           the database, and the shape the site reads it in
    rota.js         who is working when, and whether a slot is free
    mail.js         the four emails a customer can get
    auth.js         the panel password, the owner's PIN, the cancel token
    limits.js       how often one number may book
    reports.js      the takings, for the owner's page
db/schema.sql       the database, and why each column is the way it is
tests/              36 files, run by `npm test`
MIGRATION.md        how the backend works and what to set up from nothing
```

Everything in `api/_lib/` is a plain module with no framework in it. Anything
starting with `_` is invisible to Vercel's routing, which is why the folder is
named that way.

---

## How a booking travels

1. **The browser** works out which slots to offer, from `hoursForDay` and
   `isBarberWorkingAt` in `index.html`. It asks `/api?date=…` for the ones
   already taken and greys those out.
2. **The customer submits.** `addBooking` in `api/index.js` checks the whole
   thing again — the browser is not trusted, because the form is public.
3. **`refuseBooking`** is the gate: the date, the notice period, the barber's
   rota, the per-number limit, and whether the slot is still free.
4. **The row is written.** A unique index (`bookings_one_chair`) makes a double
   booking impossible even if two requests arrive in the same millisecond.
5. **Emails go out** afterwards, never before — and their failure is swallowed,
   because the booking is already saved and a bounced address must not be
   reported to the customer as a failed appointment.

The reverse — cancelling — is the same shape: a signed token from the email, or
the phone number on the site.

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
| `daily-job` | a reminder sent twice, or not at all |
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
day and "an hour before the appointment" cannot be done once a day. GitHub
disables a scheduled workflow in a repository with no activity for sixty days,
and a shop that is running well does not push code — so the site stands in.
A visitor's request sets the round off when it has gone half an hour overdue,
which while GitHub is running never happens. `standInForTheClock()` in
`api/index.js`, and MIGRATION.md for the whole picture.

**Email fails silently by design.** Nothing on the site shows it. The reason is
in `mail.js`; the place to look is the Vercel log, for a line starting
`[mail]`.

**`db/schema.sql` is not enough on its own.** `CREATE TABLE IF NOT EXISTS` does
nothing to a table that already exists, so new columns are also listed at the
foot of that file *and* applied by `ensureSchema()` in `db.js` when a query
first trips over one missing. Add a column in all three places or a live
database quietly keeps the old shape.
