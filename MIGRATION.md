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
  parts in [`api/_lib/`](api/_lib).
- **Front end** — [`index.html`](index.html) and [`admin/`](admin), both
  calling `/api` on their own origin.
- **Email** — [Brevo](https://brevo.com), over HTTPS, from
  [`api/_lib/mail.js`](api/_lib/mail.js).

## Environment

Vercel dashboard → the project → **Settings** → **Environment Variables**, set
for Production, Preview and Development alike:

| Name | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string |
| `ADMIN_PASSWORD` | the panel password |
| `NOTIFY_EMAIL` | where booking notifications go |
| `BREVO_API_KEY` | a Brevo API key |
| `MAIL_FROM` | `Sussex Barber Shop <sussexbarbershop@gmail.com>` — exactly the sender verified in Brevo |

Optional:

| Name | Value | What it does |
|---|---|---|
| `RESEND_API_KEY` | a Resend key | use Resend instead of Brevo, once the shop has a domain |
| `BLOB_READ_WRITE_TOKEN` | from Vercel → Storage → Blob | lets the panel upload gallery photos. Without it the rest of the panel works and only uploading is refused |
| `SHOP_TIMEZONE` | `Europe/Amsterdam` | already the default; only set it if the shop moves |

---

## Email, and the two things that silently stop it

The shop had no domain when this was set up — the site was on a `vercel.app`
address, which is Vercel's. That ruled out most providers: they will only let
you send from a domain you have proved you own, and you cannot prove you own
somebody else's.

Brevo was the way round it. It verifies **one address** rather than a whole
domain, by emailing that address a link, so the shop sends as its own Gmail,
free. Free tier is 300 a day; this shop sends two per booking.

**The shop has `sussexbarber.nl` now**, so that constraint is gone. Moving to
Resend is worth doing when there is time: mail from a domain the shop owns is
far less likely to be filed as spam than mail from a Gmail address sent by
somebody else's server. See the end of this section.

Two things will stop mail dead, and neither shows up as an error on the site —
the booking is already saved by the time the email is attempted, and a failed
email must never turn a confirmed appointment into an error for the customer:

1. **`MAIL_FROM` must match the verified sender exactly.** Brevo refuses
   anything else. The refusal is logged with the address it tried.
2. **Brevo's "Authorized IPs" must be off for API keys.**
   Brevo → Security → Authorized IPs → *Deactivate for API keys*. Vercel has no
   fixed IP, so an allowlist cannot be kept current — it would silently block a
   real customer's confirmation from an address nobody had seen before.

Either way, the reason is in the Vercel log on a line starting `[mail]`.

### Moving to Resend

Now that the shop owns `sussexbarber.nl`, this is available and better. In
order:

1. Sign up at **resend.com** with `sussexbarbershop@gmail.com`.
2. **Domains** → **Add Domain** → `sussexbarber.nl`. It gives three DNS records
   (DKIM, SPF, and a return-path). Add them in Namecheap under **Advanced DNS**
   and wait for Resend to show **Verified**.
3. **API Keys** → create one.
4. In Vercel: set `RESEND_API_KEY`, change `MAIL_FROM` to an address on the
   domain — `Sussex Barber Shop <booking@sussexbarber.nl>` — and **delete
   `BREVO_API_KEY`**. The code prefers Brevo when both are set, so leaving it
   there means nothing changes.
5. Redeploy, make one test booking, and check both emails arrive.

Nothing in the code changes. `MAIL_FROM` is parsed the same either way.

---

## If something is wrong

**The site says it cannot load.** Vercel → the project → **Logs**. The function
logs the real reason. The most likely one is a missing or mistyped
`DATABASE_URL`; a missing environment variable is answered with its own name
and a 503 rather than a generic failure.

**The panel refuses a save.** It now says which rule was broken — a day marked
open with no hours, a break that ends before it begins. The save is one
transaction, so nothing lands until all of it can.

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
