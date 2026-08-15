// A booking the shop takes over the phone.
//
// Half of a barber shop's appointments are made by somebody ringing up, and
// the panel had nowhere to write one down. They went into a paper diary the
// website could not see, so the site kept offering slots that were already
// gone and the Reports page was measuring the online half of the shop.
//
// The point of the design is that there is no second way to write a row: this
// goes through the same addBooking() the public form does. So most of what
// needs testing is what stays the same, and the small, deliberate list of what
// does not:
//
//   lifted    the fifteen-minute notice, and ten-per-number
//   kept      the rota, the chair, the service list, the price
//   changed   the shop's own notification is not sent; source says 'shop'
//
// It drives the real handler with the database stood in for, including the
// index refusing a row.
const path = require('path');

const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const FULL_DAY = { from: '10:00', to: '18:00', breakFrom: '', breakTo: '' };
const rota = shifts => WEEKDAY_NAMES.map(d => shifts[d]
  ? Object.assign({ day: d, working: true }, shifts[d])
  : { day: d, working: false, from: '', to: '', breakFrom: '', breakTo: '' });

// Tuesday 2099-09-08. Sunday is the shop's day off, and Bassam works Wednesdays
// only — both needed, to check the rules that are still enforced.
//
// Saan and Raman work every day the shop is open, deliberately: one of the
// tests below has to book a slot a few minutes from now, and "now" is whatever
// weekday the suite happens to be run on.
const EVERY_DAY = WEEKDAY_NAMES.reduce((all, d) => (all[d] = FULL_DAY, all), {});
const config = {
  settings: { barber_priority: 'Saan,Raman' },
  barbers: [{ name: 'Any Available' }, { name: 'Raman' }, { name: 'Bassam' }, { name: 'Saan' }],
  hours: WEEKDAY_NAMES.map(d => ({ day: d, open: d !== 'Sunday', from: '10:00', to: '18:00' })),
  barberHours: {
    Raman:  rota(EVERY_DAY),
    Saan:   rota(EVERY_DAY),
    Bassam: rota({ Wednesday: FULL_DAY })
  },
  timeOff: []
};

const PASSWORD = 'the-panel-password';

// --- the database ----------------------------------------------------------
let held = [];            // who already holds the slot
let mineCount = 0;        // appointments this number already has
let rows = [];            // every column of what landed

const fakeSql = (strings, ...values) => {
  const sql = strings.raw.join('?');
  if (/FROM services/.test(sql)) {
    return Promise.resolve(values[0] === 'Skin Fade'
      ? [{ name_en: 'Skin Fade', price: '28.00' }] : []);
  }
  if (/count\(\*\)/.test(sql)) return Promise.resolve([{ held: mineCount }]);
  if (/SELECT barber FROM bookings/.test(sql)) {
    return Promise.resolve(held.map(name => ({ barber: name })));
  }
  if (/INSERT INTO bookings/.test(sql)) {
    // Positional, and it has to stay that way: if the column list in
    // insertBooking is reordered, this reads the wrong values and the test
    // starts asserting nonsense confidently.
    const [date, clock, service, barber, name, phone, email, price, source] = values;
    rows.push({ date, clock, service, barber, name, phone, email, price, source });
    held = held.concat(barber);
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
process.env.ADMIN_PASSWORD = PASSWORD;

// Which emails were attempted. The provider is never reached — no key is set —
// so this watches the layer above it.
let posted = [];
const mailPath = require.resolve('../api/_lib/mail');
const realMail = require(mailPath);
require.cache[mailPath].exports = Object.assign({}, realMail, {
  sendBookingNotice: async b => { posted.push(['shop-notice', b.name]); return true; },
  sendCustomerConfirmation: async b => { posted.push(['confirmation', b.name]); return true; }
});

const dbPath = require.resolve('../api/_lib/db');
const realDb = require(dbPath);
require.cache[dbPath].exports = Object.assign({}, realDb, {
  readConfig: async () => config,
  readRotaConfig: async () => Object.assign({}, config, {
    barberNames: config.barbers.map(b => b.name),
    barberPriority: String(config.settings.barber_priority || '')
      .split(',').map(n => n.trim()).filter(Boolean)
  })
});

const api = require(path.join(__dirname, '..', 'api', 'index.js'));

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

async function post(body) {
  let answer = null;
  let code = 200;
  const res = {
    status(c) { code = c; return this; },
    setHeader() { return this; },
    send(text) { answer = JSON.parse(text); }
  };
  await api({ method: 'POST', body: JSON.stringify(body) }, res);
  return { answer, code };
}

/** A booking as the panel sends it. */
const byShop = patch => Object.assign({
  action: 'addBookingByShop', password: PASSWORD,
  date: '2099-09-08', time: '11:00',
  name: 'Ahmed', phone: '0612345678', service: 'Skin Fade'
}, patch);

const reset = () => { held = []; rows = []; posted = []; mineCount = 0; };

async function main() {
  console.log('--- it takes the panel password ---');
  reset();
  let { answer, code } = await post(byShop({ password: 'wrong' }));
  ok('a wrong password is refused', answer.status, 'error');
  ok('with a 401', code, 401);
  ok('and nothing written', rows.length, 0);

  reset();
  ({ answer, code } = await post(byShop({ password: '' })));
  ok('no password at all is refused', code, 401);

  // The PIN guards the takings, the prices and the hours. Taking a booking is
  // the work — a barber answering the phone has to be able to write it in
  // without ringing the owner for a PIN.
  reset();
  ({ answer } = await post(byShop({})));
  ok('the right password is enough', answer.status, 'success');
  ok('no PIN was needed', rows.length, 1);

  console.log('--- and writes the same row the website would ---');
  reset();
  await post(byShop({}));
  ok('with the shop\'s own choice of barber', rows[0].barber, 'Saan');
  ok('the price the shop charges, not one that was sent', rows[0].price, 28);
  ok('and marked as taken by the shop', rows[0].source, 'shop');

  reset();
  await post({ action: 'addBooking', date: '2099-09-08', time: '11:00',
               name: 'Ahmed', phone: '0612345678', service: 'Skin Fade' });
  ok('a booking from the website still says web', rows[0].source, 'web');

  console.log('--- what is deliberately lifted ---');
  // The notice period is for a form filled in by somebody who is not in the
  // room. "Can you do half past, it's twenty past now" is the ordinary case at
  // the counter, and refusing it sends the shop back to paper.
  const clock = new Date();
  const todayIso = clock.toISOString().slice(0, 10);
  const inFiveMinutes = new Date(clock.getTime() + 5 * 60000);
  const label = (d) => {
    let h = d.getUTCHours();
    const period = h >= 12 ? 'PM' : 'AM';
    if (h === 0) h = 12; else if (h > 12) h -= 12;
    return `${String(h).padStart(2, '0')}:${String(inFiveMinutes.getUTCMinutes()).padStart(2, '0')} ${period}`;
  };
  // Only meaningful while the shop is open; outside those hours the rota
  // refuses it for a different reason and the test would prove nothing.
  const soon = label(inFiveMinutes);
  const openNow = inFiveMinutes.getUTCHours() >= 10 && inFiveMinutes.getUTCHours() < 17 &&
                  new Date(todayIso + 'T00:00:00Z').getUTCDay() !== 0;
  if (openNow) {
    reset();
    ({ answer } = await post({ action: 'addBooking', date: todayIso, time: soon,
                               name: 'A', phone: '0612345678', service: 'Skin Fade' }));
    ok('the website refuses five minutes\' notice', answer.status, 'error');
    reset();
    ({ answer } = await post(byShop({ date: todayIso, time: soon })));
    ok('the shop does not', answer.status, 'success');
  } else {
    console.log('SKIP  the notice window (the fixture shop is shut at this hour)');
  }

  // Ten per number exists because the form is public and anonymous, and its
  // own refusal says "please call us to add another". The shop is what the
  // customer reaches when they do.
  reset();
  mineCount = 10;
  ({ answer } = await post({ action: 'addBooking', date: '2099-09-08', time: '11:00',
                             name: 'A', phone: '0612345678', service: 'Skin Fade' }));
  ok('the website refuses an eleventh', answer.status, 'error');
  reset();
  mineCount = 10;
  ({ answer } = await post(byShop({})));
  ok('the shop can add it', answer.status, 'success');

  console.log('--- and what is not ---');
  reset();
  ({ answer } = await post(byShop({ date: '2099-09-13' })));   // a Sunday
  ok('a day the shop is shut is still refused', answer.status, 'error');
  ok('and says so plainly', answer.message, 'Nobody is working at that time');
  ok('with nothing written', rows.length, 0);

  reset();
  ({ answer } = await post(byShop({ barber: 'Bassam' })));   // Wednesdays only
  ok('a barber who is off that day is refused', answer.status, 'error');
  ok('and named', /Bassam/.test(answer.message), true);

  reset();
  ({ answer } = await post(byShop({ time: '18:00' })));     // the shop shuts at six
  ok('a time after closing is refused', answer.status, 'error');

  reset();
  held = ['Saan', 'Raman'];
  ({ answer } = await post(byShop({})));
  ok('a slot with no chair left is refused', answer.status, 'error');
  ok('in the shop\'s words, not the customer\'s', answer.message, 'Every chair at that time is taken');

  reset();
  ({ answer } = await post(byShop({ service: 'Free Haircut' })));
  ok('a service the shop does not sell is refused', answer.status, 'error');

  reset();
  ({ answer } = await post(byShop({ date: '2000-01-01' })));
  ok('a date in the past is refused', answer.status, 'error');

  reset();
  ({ answer } = await post(byShop({ phone: '12' })));
  ok('a number too short to ring is refused', answer.status, 'error');

  reset();
  ({ answer } = await post(byShop({ email: 'not-an-address' })));
  // Worse than leaving it blank: the booking would be taken and the
  // confirmation would silently never arrive.
  ok('an email that cannot be right is refused', answer.status, 'error');

  console.log('--- who gets told ---');
  reset();
  await post(byShop({ email: 'customer@example.com' }));
  ok('the customer is confirmed', posted.map(p => p[0]), ['confirmation']);
  // The notification exists to tell the shop something arrived while nobody
  // was watching the panel. Sending it to the person looking at the panel,
  // about the thing they just did, is how a notification stops being read.
  ok('and the shop is not notified of its own booking',
     posted.some(p => p[0] === 'shop-notice'), false);

  reset();
  await post({ action: 'addBooking', date: '2099-09-08', time: '11:00',
               name: 'A', phone: '0612345678', service: 'Skin Fade',
               email: 'customer@example.com' });
  ok('a website booking still notifies the shop',
     posted.map(p => p[0]).sort(), ['confirmation', 'shop-notice']);

  console.log(failed === 0 ? '\nAll shop booking tests passed.' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
