# Working on this repository

Notes for whoever picks this up next — a person or a model. Read
[README.md](README.md) first for what the project is and where the files are.
This one is about how to change it without breaking the shop.

---

## What this is, in one line

A live booking site for a real barber shop. Every mistake here is somebody's
missed haircut or a phone call the shop has to make.

---

## Before you change anything

```bash
npm install
npm test          # 1,234 checks, no database, no network, a few seconds
```

If the suite is not green before you start, that is the first bug, not yours.

---

## The five things that will catch you out

**1. The rota exists twice.** In `index.html` so the browser can grey out a
day, and in `api/_lib/rota.js` where the booking is accepted or refused. Change
one and you must change the other. `tests/rota-agreement.test.js` runs both
over the same matrix and fails on the first disagreement — it exists because a
customer being offered a slot and then refused after filling in the form is the
worst thing this site can do.

**2. A new database column goes in three places.** `db/schema.sql` in the table
for a fresh database, again in the `ALTER TABLE` section at the foot for one
that is already running, and in `ensureSchema()` in `api/_lib/db.js` so the
running database catches up by itself. Miss the third and the first request
that needs the column fails in production. That has happened; see
`tests/customers.test.js`.

**3. Any query touching a recent column goes through `withNewSchema()`.** It
catches "column does not exist", runs the catch-up, and retries once. Without
it the query throws and the caller reports a failure to the customer for
something that was never attempted.

**4. Tailwind is compiled and committed.** Add a class to the markup and run
`npm run build:css`, or the class does nothing and nothing says so.
`tests/tailwind-build.test.js` is the thing that says so.

**5. The shop's clock, not the server's and not the visitor's.** `shopNow()`
reads `Europe/Amsterdam`. Vercel runs in UTC. A phone set wrong is not a reason
to refuse a booking.

---

## House style

**Comments say why, not what.** `// increment i` is noise; `// The appointment
has to finish by closing, not merely start before it` is the reason a line
reads the way it does. The existing comments are dense on purpose — they are
where the reasoning lives, and most of them record a bug that already happened
once.

**Tests are memories, not coverage.** Each file is a failure that reached
production, written down so it cannot come back. When you fix something, ask
what test would have caught it, and add that one. A test that cannot fail is
worse than none: it takes time to read and teaches people to ignore the suite.

**Verify a test by breaking the fix.** Undo the change, watch the test fail by
name, put it back. A test written against already-correct code has never been
proven to detect anything.

**Say what you actually checked.** "I fixed it" and "I fixed it and the site
returned 200 on all seven pages" are different claims. If something could not
be verified — a browser that would not render, a resize event that never fired
— say so rather than implying it passed.

---

## Things that fail silently here

Worth knowing before you conclude something works:

| What | How you find out |
|---|---|
| Email | Nothing on the site shows it. Vercel logs, lines starting `[mail]` |
| Reminders | GitHub disables the workflow after 60 days of no pushes |
| Image upload without a Blob token | The panel says so; the site does not |
| An uncompiled Tailwind class | The markup simply looks wrong |
| A stray `</div>` | The browser closes it for you and the page still renders |

---

## What is deliberately not built

`customers` exists and nothing uses it. It is the row a discount, a promo code,
a loyalty count or a gift card would reference — those are facts about a
person, and the diary can only answer questions about appointments. Build any
of them as its own table referencing `customers(id)`; none of them needs that
table to change.

Do not add tables for features nobody has asked for yet. An empty table is a
decision made early with less information than the person who eventually builds
it will have.

---

## Deploying

Push to `main`. Vercel builds it.

Commits are authored as the shop's account — Vercel's Hobby plan blocks builds
from a git author who is not a member of the account, and the failure shows up
as a deployment stuck on "Blocked" rather than as an error.

There is no staging. `MIGRATION.md` explains what every environment variable
does and what breaks without it.
