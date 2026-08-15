// How often one address may use the endpoints that need no password.
//
// The diary is what is worth protecting, and the way to damage it is not to
// break in — it is to book it. MOST_PER_CUSTOMER caps what one phone number
// may hold; a script typing a different number each time walks past that and
// fills next week. No skill, no tools, and the form is public on purpose.
//
// The panel's login throttle keeps its count in a Map and its own comment
// admits what that is worth on serverless: every cold start begins at zero.
// This one counts in Postgres, so what is really being tested here is that the
// count is asked for, that it is asked for *before* the work is done, and that
// a database having a bad moment turns customers away from nothing.
const path = require('path');

let counters = {};        // bucket -> hits, as the table would hold them
let failCounting = false; // the database having a bad moment
let queries = [];         // every statement, in order

const fakeSql = (strings, ...values) => {
  const sql = strings.raw.join('?');
  queries.push(sql.replace(/\s+/g, ' ').trim().slice(0, 40));

  if (/INSERT INTO rate_limit/.test(sql)) {
    if (failCounting) return Promise.reject(new Error('connection lost'));
    const bucket = values[0];
    counters[bucket] = (counters[bucket] || 0) + 1;
    return Promise.resolve([{ hits: counters[bucket] }]);
  }
  if (/DELETE FROM rate_limit/.test(sql)) {
    // Both windows for one caller, as forget() sends them.
    values.forEach(bucket => { delete counters[bucket]; });
    return Promise.resolve([]);
  }
  if (/FROM services/.test(sql)) return Promise.resolve([{ name_en: 'Skin Fade', price: '28.00' }]);
  if (/count\(\*\)/.test(sql)) return Promise.resolve([{ held: 0 }]);
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
process.env.ADMIN_PASSWORD = 'the-panel-password';

const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const config = {
  settings: {},
  barbers: [{ name: 'Saan' }],
  hours: WEEKDAY_NAMES.map(d => ({ day: d, open: true, from: '10:00', to: '18:00' })),
  barberHours: {},
  timeOff: []
};
const dbPath = require.resolve('../api/_lib/db');
const realDb = require(dbPath);
require.cache[dbPath].exports = Object.assign({}, realDb, {
  readConfig: async () => config,
  readRotaConfig: async () => Object.assign({}, config, {
    barberNames: ['Saan'], barberPriority: ['Saan']
  })
});

// The wrong-password delay grows to eight seconds, which is the point of it —
// but sixteen wrong logins below would then be two minutes of a test suite
// sitting still. Only the waiting is removed; the counting it does is what the
// login tests further down still rely on.
const authPath = require.resolve('../api/_lib/auth');
const realAuth = require(authPath);
require.cache[authPath].exports = Object.assign({}, realAuth, {
  throttleFailedLogin: async () => {}
});

const limits = require(path.join(__dirname, '..', 'api', '_lib', 'limits.js'));
const api = require(path.join(__dirname, '..', 'api', 'index.js'));

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

/** A request from an address, as Vercel would present it. */
async function post(body, ip) {
  let answer = null;
  let code = 200;
  const res = {
    status(c) { code = c; return this; },
    setHeader() { return this; },
    send(text) { answer = JSON.parse(text); }
  };
  await api({
    method: 'POST',
    headers: ip === null ? {} : { 'x-real-ip': ip || '9.9.9.9' },
    body: JSON.stringify(body)
  }, res);
  return { answer, code };
}

const reset = () => { counters = {}; failCounting = false; queries = []; };

async function main() {
  console.log('--- the address a request came from ---');
  ok('x-real-ip', limits.callerKey({ headers: { 'x-real-ip': '1.2.3.4' } }), '1.2.3.4');
  // x-forwarded-for is a chain; ours is the first entry.
  ok('the first of a forwarded chain',
     limits.callerKey({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }), '1.2.3.4');
  ok('whitespace in the chain',
     limits.callerKey({ headers: { 'x-forwarded-for': ' 1.2.3.4 ,5.6.7.8' } }), '1.2.3.4');
  // Off Vercel there is no header. Everybody shares one bucket, which is wrong
  // and harmless: there is nobody else on localhost.
  ok('no header at all', limits.callerKey({ headers: {} }), 'unknown');
  ok('no request', limits.callerKey(null), 'unknown');

  console.log('--- a booking, eight times an hour ---');
  reset();
  const booking = { action: 'addBooking', date: '2099-09-08', time: '11:00',
                    name: 'Ahmed', phone: '0612345678', service: 'Skin Fade' };
  const rule = limits.RULES.addBooking;
  let last = null;
  for (let i = 0; i < rule.perHour; i++) last = await post(booking, '1.1.1.1');
  ok('the last one inside the limit is not refused for being one',
     /Too many/.test(String(last.answer.message || '')), false);

  last = await post(booking, '1.1.1.1');
  ok('one over is refused', last.answer.status, 'error');
  ok('with 429, not 400', last.code, 429);
  // The one person this ever reaches by accident is a real customer at a busy
  // address, and the shop's phone still works.
  ok('and told what to do instead', /call the shop/i.test(last.answer.message), true);

  console.log('--- and the next address is a different customer ---');
  last = await post(booking, '2.2.2.2');
  ok('unaffected', /Too many/.test(String(last.answer.message || '')), false);

  console.log('--- before the work, not after ---');
  // A limit applied after the query has run has saved the database nothing,
  // which is the entire point of having one.
  reset();
  for (let i = 0; i <= rule.perHour; i++) await post(booking, '3.3.3.3');
  const afterRefusal = queries.slice(queries.lastIndexOf('INSERT INTO rate_limit (bucket, window_at, '));
  ok('nothing is read once the answer is no',
     afterRefusal.some(q => /FROM bookings|FROM services|FROM settings/.test(q)), false);

  console.log('--- an empty action is a booking, and is counted as one ---');
  // The site has posted a booking with no action since the Apps Script. Left
  // alone, that was a rate limit with the door held open beside it.
  reset();
  const noAction = Object.assign({}, booking);
  delete noAction.action;
  for (let i = 0; i <= rule.perHour; i++) last = await post(noAction, '4.4.4.4');
  ok('refused too', last.code, 429);
  // Same for the older spelling of cancel.
  reset();
  const cancelRule = limits.RULES.cancelBooking;
  for (let i = 0; i <= cancelRule.perHour; i++) {
    last = await post({ action: 'cancel', date: '2099-09-08', time: '11:00', phone: '0612345678' }, '5.5.5.5');
  }
  ok('and `cancel` counts as `cancelBooking`', last.code, 429);

  console.log('--- signing in ---');
  reset();
  const login = { action: 'adminLogin', password: 'wrong' };
  for (let i = 0; i < limits.RULES.adminLogin.perHour; i++) await post(login, '6.6.6.6');
  last = await post(login, '6.6.6.6');
  ok('guessing is cut off', last.code, 429);
  // Vague about which limit, on purpose.
  ok('without saying much', /call the shop/i.test(last.answer.message), false);

  reset();
  for (let i = 0; i < limits.RULES.adminLogin.perHour - 1; i++) await post(login, '7.7.7.7');
  last = await post({ action: 'adminLogin', password: 'the-panel-password' }, '7.7.7.7');
  ok('the right password still works', last.answer.status, 'success');
  // The owner signing in correctly is not a suspect. Without this, a long day
  // of the shop opening the panel on one wifi reaches a limit meant for
  // somebody guessing.
  ok('and the count is forgotten',
     Object.keys(counters).filter(b => b.startsWith('adminLogin')), []);

  console.log('--- the panel is never rate limited ---');
  // The people who run the shop are signed in, and a busy Saturday must not
  // turn into a panel that will not take a booking.
  reset();
  for (let i = 0; i < 40; i++) {
    last = await post({ action: 'allBookings', password: 'the-panel-password' }, '8.8.8.8');
  }
  ok('forty reads of the diary, all served', last.code, 200);
  ok('and nothing was counted', Object.keys(counters), []);

  console.log('--- when the count cannot be read ---');
  // Fails open. The other way round, one unrelated fault turns every customer
  // away — and a shop losing real bookings to a bug it cannot see is a worse
  // day than a shop that was briefly easy to spam.
  reset();
  failCounting = true;
  last = await post(booking, '1.1.1.1');
  ok('the customer is let through', last.answer.status, 'success');

  console.log('--- and old windows are thrown away ---');
  reset();
  let deleted = null;
  const sweepSql = (strings) => {
    deleted = strings.raw.join('?').replace(/\s+/g, ' ').trim();
    return Promise.resolve([{}, {}, {}]);
  };
  const swept = await limits.sweepOldCounters(sweepSql);
  ok('by the day, not by the request', /DELETE FROM rate_limit/.test(deleted), true);
  ok('older than the longest window', /interval '2 days'/.test(deleted), true);
  ok('and it says how many', swept, 3);

  console.log('--- the limits themselves ---');
  // A family of four booking from one wifi has to fit inside these, and a
  // script filling eighty chairs must not. Numbers, so a change is deliberate.
  ok('a booking', [rule.perHour, rule.perDay], [8, 20]);
  ok('a day is more than an hour', rule.perDay > rule.perHour, true);
  Object.keys(limits.RULES).forEach(action => {
    const r = limits.RULES[action];
    ok(`${action} has both windows`, [typeof r.perHour, typeof r.perDay], ['number', 'number']);
  });
  // Every action with a rule needs no password. Putting one on an action the
  // shop uses is how the panel stops working on the shop's busiest day.
  ok('and none of them is a panel action',
     Object.keys(limits.RULES).filter(a =>
       ['allBookings', 'saveCMS', 'reports', 'uploadImage', 'unlock',
        'addBookingByShop'].includes(a)), []);

  console.log(failed === 0 ? '\nAll rate limit tests passed.' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
