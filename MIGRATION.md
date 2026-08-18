# The backend: Postgres on Neon

The site used to keep everything in nine Google Sheets behind an Apps Script
Web App. It does not any more. This is what runs now, why it was moved, and
what to set up if it ever has to be stood up again from nothing.

The Sheet has been deleted. Nothing reads it, nothing writes to it, and no part
of this repository refers to it except as history.

---

## Why it moved

Measured against the deployed Apps Script:

| Request | Time |
|---|---|
| An empty request — the script starting up and nothing else | **22s** |
| The site's configuration, which every page load waits for | **19–34s** |
| Reading the bookings sheet | **65s** |

Those are seconds. A page should answer in well under one. The third number
grew with every booking taken, because the script read the sheet from the first
row to the last every time somebody picked a date.

---

## What runs now

- **Database** — Postgres on [Neon](https://neon.tech). Schema in
  [`db/schema.sql`](db/schema.sql); safe to re-run, every statement is
  `IF NOT EXISTS`.
- **Backend** — one Vercel function, [`api/index.js`](api/index.js), with its
  parts in [`api/_lib/`](api/_lib), plus [`api/daily.js`](api/daily.js) which
  nothing calls but the clock, and [`.github/workflows/nudge.yml`](.github/workflows/nudge.yml)
  which is the clock for the reminder.
- **Front end** — [`index.html`](index.html) and [`admin/`](admin), both
  calling `/api` on their own origin, and two static pages:
  [`privacy.html`](privacy.html) and [`terms.html`](terms.html).
- **Email** — [Resend](https://resend.com), over HTTPS, from
  [`api/_lib/mail.js`](api/_lib/mail.js).

## Environment

Vercel dashboard → the project → **Settings** → **Environment Variables**, set
for Production, Preview and Development alike:

| Name | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string |
| `ADMIN_PASSWORD` | the panel password |
| `REPORTS_PIN` | the owner's PIN, for the takings and the shop's own settings |
| `NOTIFY_EMAIL` | where booking notifications go |
| `RESEND_API_KEY` | a Resend API key |
| `MAIL_FROM` | `Sussex Barber Shop <booking@sussexbarber.nl>` — an address on the verified domain |
| `CRON_SECRET` | any long random string. Both Vercel and GitHub send it back on the scheduled jobs, so the same value has to be in both; without it they refuse to run at all |

Optional:

| Name | Value | What it does |
|---|---|---|
| `BREVO_API_KEY` | a Brevo key | the old provider, from before the shop had a domain. **Brevo wins when both are set**, so leaving this here means Resend is never used |
| `BLOB_READ_WRITE_TOKEN` | from Vercel → Storage → Blob | lets the panel upload gallery photos. Without it the rest of the panel works and only uploading is refused |
| `SHOP_TIMEZONE` |  `Europe/Amsterdam` | already the default; only set it if the shop moves |
| `SITE_URL` | `https://sussexbarber.nl` | already the default. Where the links in an email point — the cancel button in a confirmation is useless if it points at a preview deployment |

---

## The jobs nobody presses

Two rounds on `/api/daily`, and they are scheduled by two different services
for a reason worth understanding before changing either.

| Round | When | Scheduled by |
|---|---|---|
| `?job=soon` | every 15 minutes, 06:00–17:00 UTC | GitHub Actions |
| `?job=evening` | 18:00 UTC — 20:00 in Amsterdam in summer, 19:00 in winter | Vercel |

**`soon` is the reminder**, sent about an hour before the appointment. There
was a nine-in-the-morning round as well and it was dropped: two emails for one
haircut is one more than anybody wants, and an hour before is when a reminder
is actually read. It runs every quarter of an hour because "an hour before"
cannot be done once a day when appointments run from ten until six — and a
Vercel Hobby cron runs once a day. Hence GitHub.

**`evening` thanks** everybody who came in that day and asks for a review, but
only once `review_url` is filled in on the panel's Website Text page. Empty
means no such email is sent at all. It also sweeps the rate-limit counters.

Each row records the moment its email went out and the queries only pick up
rows where that is still empty, so running either twice sends nothing the
second time. Nothing is ever backfilled: both rounds look at one day only, so
setting the review link months from now asks that evening's customers and
nobody else. Emailing every customer the shop has ever had in one go is how a
domain gets marked as spam, and it would take the booking confirmations down
with it.

### Both need `CRON_SECRET`, in two places

Vercel attaches it as `Authorization: Bearer …` to its scheduled call once the
variable exists on the project. GitHub sends the same header from the same
value, held as a repository secret: **Settings → Secrets and variables →
Actions → New repository secret**, named `CRON_SECRET`.

They must match. Without it the route refuses everything, Vercel and GitHub
included — a public URL that emails the whole diary is not something to leave
open while somebody remembers to configure it. Changing it in Vercel needs a
redeploy, and needs the GitHub copy changed too.

Runs are logged on a line starting `[daily]`.

### When the reminders stop

Every reminder the shop sends now depends on GitHub Actions, and GitHub
disables a scheduled workflow in a repository that has seen no activity for
sixty days. A shop that is running well does not push code, so this will happen
eventually. GitHub emails the repository owner when it does — and the workflow
is re-enabled from the **Actions** tab with one button.

There is a second pair of eyes for it. The evening job runs on Vercel, which
cannot be disabled that way, and counts anything from that day that should have
been reminded and was not. It reports rather than repairs — sending a reminder
at eight in the evening for an appointment that was at two is worse than saying
nothing — and writes the number into the log with the rest. Zero every day
means the reminders are running.

---

## Bookings taken by the shop

The panel's Bookings page has an **+ Add Booking** button for a booking taken
on the phone or at the counter. It posts `addBookingByShop`, which is the same
`addBooking()` the website goes through — same rota, same one-chair index, same
priority order for a booking that names nobody, same price read from the
services table. Only two rules are lifted, and both exist solely because the
public form is public:

- the fifteen-minute notice period, so "can you do half past, it's twenty past"
  works;
- the ten-appointments-per-number limit, whose own refusal tells the customer
  to call the shop.

It takes the **panel password, not the PIN**. Taking a booking is the work; the
PIN guards what the shop *is* — its prices, its hours, its takings.

Rows carry a `source` column, `'web'` or `'shop'`, and the diary marks the
second kind "by phone".

---

## Email

Four messages can reach a customer, and every one of them needs an email
address the customer chose to give — the field is optional and the booking
works identically without it:

| When | What |
|---|---|
| the booking is made | a confirmation |
| about an hour before it | a reminder |
| if it is cancelled | a note saying so |
| a few hours after it | a thank-you, and a review link — only if `review_url` is set |

The shop gets its own notification when a booking arrives on the website. It
does **not** get one for a booking it typed in itself.

All four are described, in both languages, on [`privacy.html`](privacy.html).
`tests/legal-pages.test.js` checks that page against `mail.js`, so an email
added here and not described there fails the suite.

### What silently stops it

None of this shows up as an error on the site: the booking is already saved by
the time the email is attempted, and a failed email must never turn a confirmed
appointment into an error for the customer. The reason is always in the Vercel
log on a line starting `[mail]`.

1. **`MAIL_FROM` must be on a domain Resend has verified.** It is
   `booking@sussexbarber.nl`. Resend refuses a domain you have not proved you
   own — including a Gmail address, which is Google's.
2. **The DNS records must still be there.** Resend → Domains shows *Verified*
   or it does not. They live in Namecheap under **Advanced DNS**, and anything
   that rewrites the zone can take them with it.
3. **`BREVO_API_KEY` must be gone.** Brevo was used before the shop had a
   domain, and the code still prefers it when both keys are set — so leaving
   the old key in place silently sends nothing through Resend.

---

## If something is wrong

**The site says it cannot load.** Vercel → the project → **Logs**. The function
logs the real reason. The most likely one is a missing or mistyped
`DATABASE_URL`; a missing environment variable is answered with its own name
and a 503 rather than a generic failure.

**The panel refuses a save.** It now says which rule was broken — a day marked
open with no hours, a break that ends before it begins. The save is one
transaction, so nothing lands until all of it can.

**No reminders went out.** Vercel → the project → **Logs**, and look for
`[daily]`. If there is no such line the job did not run: check `CRON_SECRET`
exists, and that the deployment carries `vercel.json`. If the line is there
with `"reminded":0`, nobody booked in that day had left an email address.

**A column is missing.** `CREATE TABLE IF NOT EXISTS` does nothing to a table
that already exists, so re-running `db/schema.sql` does not add a column to a
live database — the `ALTER` statements at the foot of that file do. The code
also repairs the shape itself the first time it finds it wrong, so this should
not come up; if it does, the log says `[db] adding the booking columns…`.

**No email arrives.** See the two causes above.

> The current state of the shop is only ever `/api?action=getConfig`. There is
> no second copy of it anywhere, and there has not been since the Sheet stopped
> being written to.

---

## What changed underneath

**Double booking is now impossible, rather than unlikely.** It used to be held
off by a ten-second lock around a read and a write. It is now a unique index:
two requests can arrive in the same millisecond and the database refuses the
second one.

**Saving from the panel is all-or-nothing.** The Apps Script wrote each sheet
in turn, so a failure halfway through saved the services and not the hours,
with no way to tell. It is one transaction now.

**There is no cache to wait for.** The old config was cached for two minutes
because reading it cost twenty seconds, so the owner could save a price and
watch the site ignore them. The queries are indexed and take milliseconds, so
what you save is what the next visitor sees.

**Types are types.** A Sheet handed back a Date for a cell reading "10:00", a
string for the same cell in another row, and `#ERROR!` for a phone number
beginning with a plus — which the site then displayed where the number should
be. `repairSettingErrors()` and the rest of the type-guessing are gone.

**The price is the shop's, not the browser's.** The booking form sends what it
thinks a service costs; the row records what the `services` table says.
