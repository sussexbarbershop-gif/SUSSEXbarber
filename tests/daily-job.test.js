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
let missedCount = 0;      // what the evening's look back over the day finds
let updates = [];         // ['reminded_at', id] / ['review_asked_at', id]
let queried = [];         // which selects were actually run

const fakeSql = (strings, ...values) => {
  const sql = strings.raw.join('?');
  // Checked before the reminder query, which it otherwise looks exactly like:
  // both ask about today's unreminded bookings, and only one of them counts.
  if (/count\(\*\) AS missed/.test(sql)) {
    queried.push(['missed', values[0], sql.replace(/\s+/g, ' '), values]);
    return Promise.resolve([{ missed: missedCount }]);
  }
  if (/reminded_at IS NULL/.test(sql)) {
    // The statement as well as its parameters. A stood-in database cannot
    // apply a WHERE clause, so the only way to know the right rows would have
    // been asked for is to read what was asked.
    queried.push(['reminders', values[0], sql.replace(/\s+/g, ' '), values]);
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
  refuse = false; reviewUrl = ''; missedCount = 0;
};

async function call(headers, job) {
  let answer = null;
  let code = 200;
  const res = {
    status(c) { code = c; return this; },
    setHeader() { return this; },
    send(text) { answer = JSON.parse(text); }
  };
  await daily({ headers: headers || {}, query: job ? { job } : {} }, res);
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

  console.log('--- the reminder, an hour before ---');
  // One reminder, not two. There was a nine-in-the-morning round as well and
  // it was dropped: two emails for one haircut is one more than anybody wants,
  // and an hour before is when a reminder is actually read.
  reset();
  dueToday = [row(1, 'Ahmed', '11:00:00'), row(2, 'Bram', '14:30:00')];
  let result = await daily.runDailyJob('soon');
  ok('everyone due is emailed', sent.map(s => s[1]), ['Ahmed', 'Bram']);
  ok('at the time they are booked for', sent.map(s => s[2]), ['11:00', '14:30']);
  ok('and the count is reported', result.reminded, 2);
  // The whole safety story: the row records when it went, and the query only
  // picks up rows where that is empty. A second run sends nothing.
  ok('each one is marked as sent', updates, [['reminded_at', 1], ['reminded_at', 2]]);
  ok('the query asked for today', queried[0].slice(0, 2), ['reminders', daily.shopDate(0)]);

  console.log('--- a send that did not go ---');
  reset();
  refuse = true;
  dueToday = [row(1, 'Ahmed', '11:00:00')];
  result = await daily.runDailyJob('soon');
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
  ok('with a link set, the day\'s customers are asked', sent.map(s => s[1]), ['Chloe', 'Dirk']);
  ok('and the link is the one from the panel', sent[0][2], 'https://g.page/r/example');
  ok('each one marked', updates, [['review_asked_at', 3], ['review_asked_at', 4]]);
  // Today, not yesterday. A customer asked the same evening still remembers
  // the haircut and has their phone in their hand; by tomorrow it is one more
  // thing in an inbox.
  ok('the query asked for today', queried.find(q => q[0] === 'reviews')[1],
     daily.shopDate(0));

  // Nothing is backfilled when the link is finally filled in: the query only
  // ever looks at one day. Emailing every customer the shop has ever had, in
  // one go, from a domain with no sending history, is how a domain gets marked
  // as spam — and it would take the booking confirmations down with it.
  ok('and one day is one day',
     new Date(daily.shopDate(0)) - new Date(daily.shopDate(-1)), 86400000);

  console.log('--- long enough after the chair ---');
  // The evening run happens after closing, so in practice everyone qualifies.
  // The gap is for the run that fires early — a schedule edited, a job
  // triggered by hand at four — where without it the shop would be asking for
  // a review of a haircut the customer is still sitting in.
  const cutoffAt = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    // A Date whose *shop* clock reads hhmm. The suite runs with SHOP_TIMEZONE
    // set to UTC, so this is simply that time in UTC.
    return new Date(Date.UTC(2026, 0, 2, h, m));
  };
  ok('two hours back from eight in the evening', daily.askingCutoff(cutoffAt('20:00')), '18:00');
  ok('and from four in the afternoon', daily.askingCutoff(cutoffAt('16:00')), '14:00');
  // Postgres wraps `time` arithmetic round midnight: at one in the morning,
  // now()::time - interval '2 hours' is 23:00, and a query written that way
  // would quietly match the whole day.
  ok('never round the back of midnight', daily.askingCutoff(cutoffAt('01:00')), '00:00');
  ok('nor exactly at it', daily.askingCutoff(cutoffAt('00:00')), '00:00');

  console.log('--- which rows the reminder asks for ---');
  reset();
  dueToday = [row(9, 'Femke', '16:00:00')];
  result = await daily.runDailyJob('soon');
  ok('it asks the reminder query', queried[0][0], 'reminders');
  ok('for today', queried[0][1], daily.shopDate(0));
  // It runs every quarter of an hour and must not do the evening's work.
  ok('and never asks for reviews', queried.some(q => q[0] === 'reviews'), false);
  ok('nor sweeps the counters', result.countersSwept, 0);

  // A stood-in database applies no WHERE clause, so the only way to know the
  // right rows were asked for is to read the statement.
  const soonSql = queried[0][2];
  const soonArgs = queried[0][3];
  ok('it narrows by time', /booked_at <= \?::time/.test(soonSql), true);
  ok('and passes a cutoff to narrow by', soonArgs.includes(daily.soonCutoff()), true);
  // A customer who booked twenty minutes ago does not need reminding of it:
  // a confirmation and a reminder in the same hour reads as a shop that has
  // lost track of itself.
  ok('and skips one just booked', /created_at < now\(\) - make_interval/.test(soonSql), true);
  // Cast, not left to Postgres to infer. A parameter arrives with no type on
  // it, and this is the kind of comparison that resolves in testing and
  // refuses at three in the afternoon on a live database.
  ok('with the types written down', /::time/.test(soonSql) && /::int/.test(soonSql), true);

  console.log('--- an hour ahead, and not round the back of midnight ---');
  const at = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(Date.UTC(2026, 0, 2, h, m));
  };
  ok('an hour ahead', daily.soonCutoff(at('14:00')), '15:00');
  ok('and again off the hour', daily.soonCutoff(at('09:15')), '10:15');
  // Postgres wraps `time` arithmetic round midnight; this must not.
  ok('it stops at the end of the day', daily.soonCutoff(at('23:30')), '23:59');
  ok('and exactly at eleven', daily.soonCutoff(at('23:00')), '23:59');

  console.log('--- one round or the other ---');
  reset();
  reviewUrl = 'https://g.page/r/example';
  dueToday = [row(1, 'Ahmed', '11:00:00')];
  dueYesterday = [row(3, 'Chloe', '10:00:00')];
  result = await daily.runDailyJob('soon');
  ok('the reminder round reminds and does not ask', sent.map(s => s[0]), ['reminder']);
  ok('and reports nothing asked', result.reviewsAsked, 0);

  reset();
  reviewUrl = 'https://g.page/r/example';
  dueToday = [row(1, 'Ahmed', '11:00:00')];
  dueYesterday = [row(3, 'Chloe', '10:00:00')];
  result = await daily.runDailyJob('evening');
  ok('the evening asks and does not remind', sent.map(s => s[0]), ['review']);

  console.log('--- and the evening watches the reminder round ---');
  // Every reminder now comes from GitHub Actions, and GitHub disables a
  // scheduled workflow in a repository that has seen no activity for sixty
  // days. A shop that is running well does not push code, so that will happen
  // — and reminders would simply stop with nobody noticing.
  reset();
  reviewUrl = 'https://g.page/r/example';
  dueYesterday = [row(3, 'Chloe', '10:00:00')];
  missedCount = 3;
  result = await daily.runDailyJob('evening');
  ok('it counts what was never reminded', result.remindersMissed, 3);
  const missedSql = (queried.find(q => q[0] === 'missed') || [])[2] || '';
  ok('over today', queried.find(q => q[0] === 'missed')[1], daily.shopDate(0));
  ok('among the ones that had an address', /email <> ''/.test(missedSql), true);
  ok('and were booked long enough ahead to be due one',
     /created_at < now\(\) - make_interval/.test(missedSql), true);
  // It reports, it does not repair. Sending them at eight in the evening for an
  // appointment that was at two would be worse than saying nothing.
  ok('and sends nothing itself', sent.map(s => s[0]), ['review']);

  reset();
  reviewUrl = 'https://g.page/r/example';
  result = await daily.runDailyJob('evening');
  ok('a day where nothing was missed says zero', result.remindersMissed, 0);

  console.log('--- a quiet day ---');
  reset();
  reviewUrl = 'https://g.page/r/example';
  result = await daily.runDailyJob('evening');
  ok('the evening sends nothing', sent, []);
  ok('and writes nothing', updates, []);
  ok('and says so', [result.reviewsAsked, result.remindersMissed], [0, 0]);
  reset();
  result = await daily.runDailyJob('soon');
  ok('and so does the reminder round', [sent.length, result.reminded], [0, 0]);

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
  ok('vercel.json has crons', Array.isArray(vercel.crons), true);
  // One. There were two, and the morning reminder was dropped: two emails for
  // one haircut is one more than anybody wants.
  ok('one of them', vercel.crons.length, 1);
  ok('the evening one', vercel.crons[0].path, '/api/daily?job=evening');
  ok('running once a day', /^\d+ \d+ \* \* \*$/.test(vercel.crons[0].schedule), true);
  // Vercel's schedules are UTC. The shop is on Amsterdam time, an hour or two
  // ahead, and it closes at six — so this has to be late enough that the last
  // customer has left and early enough not to be the middle of the night.
  const hourOf = c => Number(c.schedule.split(' ')[1]);
  ok('after the shop shuts', hourOf(vercel.crons[0]) >= 17, true);
  ok('but not overnight', hourOf(vercel.crons[0]) < 21, true);

  console.log('--- and the one Vercel cannot schedule ---');
  // Vercel runs a cron once a day on this plan, and "an hour before" cannot be
  // done once a day when appointments run from ten until six.
  const wf = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'nudge.yml'), 'utf8');
  ok('there is a workflow', wf.length > 0, true);
  ok('every fifteen minutes', /cron: '\*\/15 /.test(wf), true);
  ok('calling the soon round', /job=soon/.test(wf), true);
  // Without the header the route refuses it, which is the point of the route.
  ok('with the secret', /Authorization: Bearer \$CRON_SECRET/.test(wf), true);
  ok('read from the repository, not written into the file',
     /secrets\.CRON_SECRET/.test(wf), true);
  ok('and the secret is never echoed', /echo .*\$CRON_SECRET/.test(wf), false);
  // A 401 has to turn the run red. Without --fail curl reports success on any
  // answer at all, and a workflow that is green while sending nothing is worse
  // than one that is not there.
  ok('a refusal fails the run', /--fail/.test(wf), true);
  ok('and it says so when the secret is missing', /CRON_SECRET is not set/.test(wf), true);

  console.log(failed === 0 ? '\nAll daily job tests passed.' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
