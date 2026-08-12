# Moving the backend from Google Sheets to Neon

The site is slow because of where its data lives, not because of anything on
the page. Measured against the deployed Apps Script:

| Request | Time |
|---|---|
| An empty request — the script starting up and nothing else | **22s** |
| The site's configuration, which every page load waits for | **19–34s** |
| Reading the bookings sheet | **65s** |

Those are seconds. A page should answer in well under one. And the third number
grows with every booking taken, because the script reads the sheet from the
first row to the last every time somebody picks a date.

This replaces that with Postgres on Neon and one Vercel function. Nothing about
how the site looks or works changes.

**Nothing is deleted from the Sheet.** It stays exactly as it is and remains
readable, so if anything goes wrong the old backend is still there.

---

## The order matters

Do these in order. The last step is the switch, and until you take it the live
site carries on running on the Apps Script exactly as it does today.

---

### 1. Create the database

1. Go to **https://neon.tech** and sign up **with the shop's email**
   (`sussexbarbershop@gmail.com`). Signing in with Google is the quickest way.
2. Create a project. Any name; **Frankfurt** or **Amsterdam** is the closest
   region.
3. On the project dashboard, find **Connection string** and copy it. It looks
   like:

   ```
   postgresql://neondb_owner:XXXX@ep-something.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

   **This is a password.** Do not paste it into a chat, an email, or a file in
   this repository. It only ever goes in the two places below.

---

### 2. Create the tables

In the Neon dashboard, open **SQL Editor**, paste the whole of
[`db/schema.sql`](db/schema.sql), and run it.

It is safe to run twice — every statement is `IF NOT EXISTS`.

You should end up with eight tables: `barbers`, `barber_hours`, `time_off`,
`services`, `shop_hours`, `settings`, `gallery`, `bookings`.

---

### 3. Set up email

The Apps Script sent mail through Google. That goes away with it, so booking
notifications need somewhere else to come from.

1. Go to **https://resend.com** and sign up with the shop's email.
2. **API Keys** → **Create API Key**. Copy it. It starts with `re_`.
   This is also a password — same rules.

Free tier is 3,000 emails a month and 100 a day, which is far more than this
shop sends.

Until a domain is verified, Resend will only deliver to the address that owns
the account — enough to prove the wiring works. Verifying
`sussexbarbershop.com`, or whatever domain the shop has, is a later job and
needs no code change: set `MAIL_FROM` and it starts using it.

---

### 4. Put the secrets in Vercel

Vercel dashboard → the `sussexbarber` project → **Settings** →
**Environment Variables**. Add each of these for **all** environments
(Production, Preview, Development):

| Name | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string from step 1 |
| `ADMIN_PASSWORD` | the same panel password as now, out of the Apps Script's Script Properties |
| `NOTIFY_EMAIL` | `sussexbarbershop@gmail.com` |
| `RESEND_API_KEY` | the `re_…` key from step 3 |

Optional, and only if you want them:

| Name | Value | What it does |
|---|---|---|
| `MAIL_FROM` | `Sussex Barber Shop <bookings@yourdomain.com>` | sends from your own domain once it is verified with Resend |
| `BLOB_READ_WRITE_TOKEN` | from Vercel → Storage → Blob | lets the panel upload gallery photos. Without it the rest of the panel works and only uploading is refused |
| `SHOP_TIMEZONE` | `Europe/Amsterdam` | already the default; only set it if the shop moves |

---

### 5. Copy the data across

On your own computer, in the project folder:

```bash
npm install
```

Then run the migration. Substitute the two real values — this is the one time
they are typed on your machine, and nothing writes them to a file:

```bash
DATABASE_URL="postgresql://…" ADMIN_PASSWORD="…" npm run migrate:neon
```

Try it with `--dry-run` first if you want to see what it would do:

```bash
DATABASE_URL="postgresql://…" ADMIN_PASSWORD="…" node scripts/migrate-to-neon.js --dry-run
```

It reads everything through the Apps Script that is still running, so it is
slow — about a minute. At the end it prints what landed in Neon and compares
the booking count against the Sheet. **Read that last line.** If the numbers
differ it lists every row it skipped and why.

Safe to run again. Bookings already copied are not duplicated.

---

### 6. Take the switch

This is the only step that changes what customers see. Two lines:

- [`index.html`](index.html) — the `const API_URL = "https://script.google.com/…"` line
- [`admin/admin.js`](admin/admin.js) — the same line near the top

Change both to:

```js
const API_URL = "/api";
```

Commit and push. Vercel deploys in about a minute.

Then check, in this order:

1. The site loads and the prices and opening hours are right
2. Pick a date — the time chips appear, and **fast**
3. Make a test booking with your own email. Two emails should arrive: one to
   the shop, one to you
4. "Already booked?" with that phone number finds it
5. Cancel it, and the slot comes back
6. Sign in to `/admin` and check the diary shows the same bookings as the Sheet

---

## If something is wrong

**The site says it cannot load.** Vercel → the project → **Logs**. The function
logs the real reason there. The most likely one is a missing or mistyped
`DATABASE_URL`.

**No email arrives.** Look in the same logs for a line starting `[mail]`. It
says whether Resend was called, refused it, or was never configured. Remember
Resend will only deliver to the account owner's address until a domain is
verified.

**Go back to the old backend.** Change those two `API_URL` lines back to the
Apps Script URL and push. This is why the switch is last and why it is only two
lines.

> **The Sheet stopped being current the moment the switch went in.** Every save
> from the panel now goes to Neon and nothing writes to the Sheet, so it is a
> snapshot of migration day, not a live mirror. Going back would restore the
> shop as it was then and lose everything edited since.
>
> It is a real backup for the first hours and a worse one every day after. Do
> not read from it either: a repair that pushed the Sheet's opening hours back
> into Neon closed a Monday the owner had since reopened, because the Sheet
> still had the old value. Neon is the source of truth now — read the current
> state from `/api?action=getConfig`, never from the Sheet.

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

**`repairSettingErrors` is gone**, along with the rest of the type-guessing.
A phone number beginning `+31` was read by Sheets as a formula and stored as
`#ERROR!`, which the site then displayed where the number should be. Text
columns hold text.
