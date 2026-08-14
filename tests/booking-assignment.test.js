// A booking that named nobody gets a name, and gets one safely.
//
// "No preference" used to be stored as no preference: an empty barber column,
// which bookings_one_chair deliberately ignores because a unique index cannot
// count. Two such bookings arriving together for the last free chair were both
// accepted, and the shop found out on the morning.
//
// This drives insertBooking() through addBooking(), with the database stood in
// for — including the index refusing a row, which is the case that matters and
// the one that cannot be produced by asking nicely.
const path = require('path');

const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const FULL_DAY = { from: '10:00', to: '18:00', breakFrom: '', breakTo: '' };
const rota = shifts => WEEKDAY_NAMES.map(d => shifts[d]
  ? Object.assign({ day: d, working: true }, shifts[d])
  : { day: d, working: false, from: '', to: '', breakFrom: '', breakTo: '' });

// Tuesday 2099-09-08. Three barbers on the floor, in an order of the shop's
// choosing that is deliberately not the order they are listed in.
const config = {
  settings: { barber_priority: 'Saan,Bassam,Raman' },
  barbers: [{ name: 'Any Available' }, { name: 'Raman' }, { name: 'Bassam' }, { name: 'Saan' }],
  hours: WEEKDAY_NAMES.map(d => ({ day: d, open: d !== 'Sunday', from: '10:00', to: '18:00' })),
  barberHours: {
    Raman:  rota({ Tuesday: FULL_DAY }),
    Bassam: rota({ Tuesday: FULL_DAY }),
    Saan:   rota({ Tuesday: FULL_DAY })
  },
  timeOff: []
};

// --- the database ----------------------------------------------------------
let held = [];            // who already holds the slot
let taken = [];           // barbers the index will refuse, in order asked
let inserted = [];        // what actually landed
let services = [{ name_en: 'Skin Fade', price: '28.00' }];

const fakeSql = (strings, ...values) => {
  const sql = strings.raw.join('?');
  // The real query matches on the name, so this has to as well, or a service
  // the shop does not sell reads back as one it does.
  if (/FROM services/.test(sql)) {
    return Promise.resolve(services.filter(s => s.name_en === values[0]));
  }
  if (/count\(\*\)/.test(sql)) return Promise.resolve([{ held: 0 }]);
  if (/SELECT barber FROM bookings/.test(sql)) {
    return Promise.resolve(held.map(name => ({ barber: name })));
  }
  if (/INSERT INTO bookings/.test(sql)) {
    const barber = values[3];
    if (taken.includes(barber)) {
      // What Postgres says when the one-chair index refuses a row.
      return Promise.reject(new Error(
        'duplicate key value violates unique constraint "bookings_one_chair"'));
    }
    inserted.push(barber);
    held = held.concat(barber);      // as the next read would see it
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
delete process.env.BREVO_API_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.NOTIFY_EMAIL;

// readRotaConfig() reads the database; hand it the fixture instead.
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

/** Post a booking and hand back what the server answered. */
async function book(patch) {
  let answer = null;
  const res = {
    status() { return this; },
    setHeader() { return this; },
    send(body) { answer = JSON.parse(body); }
  };
  await api({
    method: 'POST',
    body: JSON.stringify(Object.assign({
      action: 'addBooking', date: '2099-09-08', time: '11:00 AM',
      name: 'Ahmed', phone: '0612345678', service: 'Skin Fade'
    }, patch))
  }, res);
  return answer;
}

const reset = () => { held = []; taken = []; inserted = []; };

async function main() {
  console.log('--- nobody asked for, so the shop decides ---');
  reset();
  let answer = await book({});
  ok('accepted', answer.status, 'success');
  ok('the first in the shop\'s order took it', inserted, ['Saan']);
  // The name goes in the row. An empty barber column is the one thing the
  // one-chair index cannot hold.
  ok('and it is told back', answer.barber, 'Saan');

  console.log('--- the order is worked down as chairs go ---');
  reset();
  held = ['Saan'];
  ok('second choice', (await book({})).barber, 'Bassam');
  reset();
  held = ['Saan', 'Bassam'];
  ok('third choice', (await book({})).barber, 'Raman');
  reset();
  held = ['Saan', 'Bassam', 'Raman'];
  answer = await book({});
  ok('and a full slot is refused', answer.status, 'error');
  ok('in words the customer can act on', /choose another/.test(answer.message), true);
  ok('with nothing written', inserted, []);

  console.log('--- two of them arriving at once ---');
  // The read said Saan was free; between it and the write, somebody else took
  // him. Checking harder cannot fix this — only the database knows.
  reset();
  taken = ['Saan'];
  answer = await book({});
  ok('the next one is tried', answer.status, 'success');
  ok('and gets the chair', inserted, ['Bassam']);
  ok('nothing was written twice', inserted.length, 1);

  reset();
  taken = ['Saan', 'Bassam'];
  ok('twice over, still fine', (await book({})).barber, 'Raman');

  reset();
  taken = ['Saan', 'Bassam', 'Raman'];
  answer = await book({});
  ok('everyone taken, and it gives up', answer.status, 'error');
  ok('without looping for ever', inserted, []);

  console.log('--- a customer who did ask for someone ---');
  reset();
  answer = await book({ barber: 'Bassam' });
  ok('gets them', inserted, ['Bassam']);

  reset();
  taken = ['Bassam'];
  answer = await book({ barber: 'Bassam' });
  // Not silently moved to another barber: they asked for Bassam.
  ok('and is refused rather than reassigned', answer.status, 'error');
  ok('with nobody else written', inserted, []);

  console.log('--- "Any" and "Any Available" mean nobody ---');
  for (const name of ['Any', 'Any Available', '']) {
    reset();
    answer = await book({ barber: name });
    ok(`"${name}" is decided by the shop`, answer.barber, 'Saan');
  }

  console.log('--- the service has to be one the shop sells ---');
  reset();
  answer = await book({ service: 'Free Haircut' });
  ok('an invented service is refused', answer.status, 'error');
  ok('and nothing is written', inserted, []);
  // The price is the shop's. A row reading "Free Haircut" at no charge is a
  // row somebody wrote themselves, and it would have vanished from the takings.
  reset();
  answer = await book({ service: 'Skin Fade', price: 0 });
  ok('a price sent from outside is ignored', answer.status, 'success');

  console.log(failed === 0 ? '\nAll assignment tests passed.' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
