// The one thing that runs without anybody pressing anything.
//
// Every other action on this site happens because a person did something and
// is looking at the result. This one fires at seven in the morning while the
// shop is shut, and if it goes wrong the failure is invisible: nobody gets a
// reminder, or — worse the other way — everybody gets four.
//
// So what is tested here is mostly restraint. That it sends once. That a send
// which failed is not recorded as having happened. That it refuses to run for
// anybody who is not Vercel. And that with no review link configured it does
// not go near the review query, because for weeks that was the real state of
// the shop and "sends an email with an empty link in it" was the bug waiting
// to happen.
const path = require('path');

const SECRET = 'a-cron-secret';

// --- the database ----------------------------------------------------------
let dueToday = [];        // rows the reminder query would find
let dueYesterday = [];    // rows the review query would find
let updates = [];         // ['reminded_at', id] / ['review_asked_at', id]
let queried = [];         // which selects were actually run

const fakeSql = (strings, ...values) => {
  const sql = strings.raw.join('?');
  if (/reminded_at IS NULL/.test(sql)) {
    queried.push(['reminders', values[0]]);
    return Promise.resolve(dueToday);
  }
  if (/review_asked_at IS NULL/.test(sql)) {
    queried.push(['reviews', values[0]]);
    return Promise.resolve(dueYesterday);
  }
  if (/SET reminded_at/.test(sql)) {
    updates.push(['reminded_at', values[0]]);
    return Promise.resolve([]);
  }
  if (/SET review_asked_at/.test(sql)) {
    updates.push(['review_asked_at', values[0]]);
    return Promise.resolve([]);
  }
  return Promise.resolve([]);
};

const Module = require('module');
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@neondatabase/serverless') return { neon: () => fakeSql };
  return realLoad.call(this, request, ...rest);
};
process.env.DATABASE_URL = 'postgres://test/test';
process.env.SHOP_TIMEZONE = 'UTC';

// --- the shop, and the post ------------------------------------------------
let reviewUrl = '';
const dbPath = require.resolve('../api/_lib/db');
const realDb = require(dbPath);
require.cache[dbPath].exports = Object.assign({}, realDb, {
  readConfig: async () => ({ settings: { contact_phone: '+31 6 00000000', review_url: reviewUrl } })
});

let sent = [];
let refuse = false;       // the provider having a bad five minutes
const mailPath = require.resolve('../api/_lib/mail');
const realMail = require(mailPath);
require.cache[mailPath].exports = Object.assign({}, realMail, {
  sendReminder: async (b) => { sent.push(['reminder', b.name, b.time]); return !refuse; },
  sendReviewRequest: async (b, c, url) => { sent.push(['review', b.name, url]); return !refuse; }
});

const daily = require(path.join(__dirname, '..', 'api', 'daily.js'));

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

const row = (id, name, at) => ({
  id, customer_name: name, email: `${name.toLowerCase()}@example.com`,
  booked_at: at, service: 'Skin Fade', barber: 'Saan'
});

const reset = () => {
  dueToday = []; dueYesterday = []; updates = []; queried = []; sent = [];
  refuse = false; reviewUrl = '';
};

async function call(headers) {
  let answer = null;
  let code = 200;
  const res = {
    status(c) { code = c; return this; },
    setHeader() { return this; },
    send(text) { answer = JSON.parse(text); }
  };
  await daily({ headers: headers || {} }, res);
  return { answer, code };
}

async function main() {
  console.log('--- who is allowed to set it off ---');
  reset();
  delete process.env.CRON_SECRET;
  let { answer, code } = await call({ authorization: `Bearer ${SECRET}` });
  // A public URL that emails the whole diary is not something to leave open
  // while somebody remembers to configure it.
  ok('with no secret configured, nothing runs', code, 503);
  ok('and it says what is missing', /CRON_SECRET/.test(answer.message), true);
  ok('nothing was read', queried, []);

  process.env.CRON_SECRET = SECRET;

  reset();
  ({ code } = await call({}));
  ok('no authorization header at all', code, 401);
  reset();
  ({ code } = await call({ authorization: 'Bearer wrong' }));
  ok('the wrong secret', code, 401);
  // x-vercel-cron looks like it would do the job. "A header Vercel happens to
  // set" is not the same as "a header nobody else can set".
  reset();
  ({ code } = await call({ 'x-vercel-cron': '1' }));
  ok('a header that merely looks official', code, 401);
  ok('and none of them read the diary', queried, []);

  reset();
  ({ code } = await call({ authorization: `Bearer ${SECRET}` }));
  ok('Vercel\'s own call runs', code, 200);

  console.log('--- reminding this morning\'s appointments ---');
  reset();
  dueToday = [row(1, 'Ahmed', '11:00:00'), row(2, 'Bram', '14:30:00')];
  let result = await daily.runDailyJob();
  ok('everyone due today is emailed', sent.map(s => s[1]), ['Ahmed', 'Bram']);
  ok('at the time they are booked for', sent.map(s => s[2]), ['11:00 AM', '02:30 PM']);
  ok('and the count is reported', result.reminded, 2);
  // The whole safety story: the row records when it went, and the query only
  // picks up rows where that is empty. A second run sends nothing.
  ok('each one is marked as sent', updates, [['reminded_at', 1], ['reminded_at', 2]]);
  ok('the query asked for today', queried[0], ['reminders', daily.shopDate(0)]);

  console.log('--- a send that did not go ---');
  reset();
  refuse = true;
  dueToday = [row(1, 'Ahmed', '11:00:00')];
  result = await daily.runDailyJob();
  ok('it was attempted', sent.length, 1);
  // Marking first would mean a provider having a bad five minutes costs those
  // customers their reminder for good.
  ok('but not recorded as sent', updates, []);
  ok('and not counted', result.reminded, 0);

  console.log('--- asking for a review, once there is somewhere to send them ---');
  reset();
  dueYesterday = [row(3, 'Chloe', '10:00:00')];
  result = await daily.runDailyJob();
  ok('with no link set, nobody is asked', sent, []);
  // Not "sends an email with an empty link in it", and not "asks the database
  // and then throws the answer away" either.
  ok('and the diary is not even read for it',
     queried.some(q => q[0] === 'reviews'), false);
  ok('reported as none', result.reviewsAsked, 0);

  reset();
  reviewUrl = 'https://g.page/r/example';
  dueYesterday = [row(3, 'Chloe', '10:00:00'), row(4, 'Dirk', '15:00:00')];
  result = await daily.runDailyJob();
  ok('with a link set, yesterday\'s customers are asked', sent.map(s => s[1]), ['Chloe', 'Dirk']);
  ok('and the link is the one from the panel', sent[0][2], 'https://g.page/r/example');
  ok('each one marked', updates, [['review_asked_at', 3], ['review_asked_at', 4]]);
  ok('the query asked for yesterday', queried.find(q => q[0] === 'reviews')[1],
     daily.shopDate(-1));

  // Nothing is backfilled when the link is finally filled in: the query only
  // ever looks at yesterday. Emailing every customer the shop has ever had, on
  // one morning, from a domain with no sending history, is how a domain gets
  // marked as spam — and it would take the booking confirmations down with it.
  ok('and yesterday is one day, not everything before now',
     new Date(daily.shopDate(0)) - new Date(daily.shopDate(-1)), 86400000);

  console.log('--- both rounds in one run ---');
  reset();
  reviewUrl = 'https://g.page/r/example';
  dueToday = [row(1, 'Ahmed', '11:00:00')];
  dueYesterday = [row(3, 'Chloe', '10:00:00')];
  result = await daily.runDailyJob();
  ok('reminders and reviews together', sent.map(s => s[0]), ['reminder', 'review']);
  ok('reported separately', [result.reminded, result.reviewsAsked], [1, 1]);

  console.log('--- an empty morning ---');
  reset();
  reviewUrl = 'https://g.page/r/example';
  result = await daily.runDailyJob();
  ok('sends nothing', sent, []);
  ok('writes nothing', updates, []);
  ok('and says so', [result.reminded, result.reviewsAsked], [0, 0]);

  console.log('--- the date is the shop\'s ---');
  // Vercel runs in UTC. Reading "today" off the server would have the job
  // reminding an hour or two into the wrong day twice a year.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'daily.js'), 'utf8');
  ok('worked out with a timezone', /timeZone: SHOP_TZ/.test(src), true);
  ok('and never from the server clock alone',
     /new Date\(\)\.toISOString\(\)\.slice/.test(src), false);
  ok('today is a plain date', /^\d{4}-\d{2}-\d{2}$/.test(daily.shopDate(0)), true);

  console.log('--- and it is actually scheduled ---');
  // The route can be perfect and still never run. This is the one line that
  // makes it happen, and it lives in a file nothing else touches.
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  ok('vercel.json has a cron', Array.isArray(vercel.crons) && vercel.crons.length > 0, true);
  ok('pointing at this route', vercel.crons[0].path, '/api/daily');
  // Once a day, in the morning. A Hobby account gets one run a day anyway, and
  // a reminder is only useful before the appointment.
  ok('once a day', /^\d+ \d+ \* \* \*$/.test(vercel.crons[0].schedule), true);

  console.log(failed === 0 ? '\nAll daily job tests passed.' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
