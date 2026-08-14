// refuseBooking() is the only thing standing between the public booking form
// and the diary. The browser checks the same rules, but the form is public, so
// anything not refused here can be written by a hand-made request.
//
// This drives the real function out of api/index.js. The one thing it cannot
// use is a database, so the module that hands out the query function is
// replaced before the API is loaded — everything else is the code that runs in
// production.
const path = require('path');

const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const ANY_BARBER = 'Any Available';

const FULL_DAY = { from:'10:00', to:'18:00', breakFrom:'13:30', breakTo:'14:00' };
const MONDAY_LATE = { from:'12:00', to:'18:00', breakFrom:'', breakTo:'' };
const rota = shifts => WEEKDAY_NAMES.map(d => shifts[d]
  ? Object.assign({ day:d, working:true }, shifts[d])
  : { day:d, working:false, from:'', to:'', breakFrom:'', breakTo:'' });

const config = {
  barberNames: ['Any Available', 'Hemen', 'Amir', 'Raman'],
  hours: WEEKDAY_NAMES.map(d => ({
    day: d, open: d !== 'Sunday', from: d === 'Monday' ? '12:00' : '10:00', to: '18:00'
  })),
  barberHours: {
    Hemen: rota({ Tuesday:FULL_DAY, Wednesday:FULL_DAY, Friday:FULL_DAY, Saturday:FULL_DAY }),
    Amir:  rota({ Tuesday:FULL_DAY, Thursday:FULL_DAY, Friday:FULL_DAY, Saturday:FULL_DAY }),
    Raman: rota({ Monday:MONDAY_LATE, Saturday:FULL_DAY })
  },
  timeOff: [{ barber:'Amir', from:'2099-09-01', to:'2099-09-05', note:'holiday' }]
};

// --- the database, as far as refuseBooking() is concerned -------------------
// It asks two questions: who already holds this slot, and how many
// appointments this number is holding. A tagged template that answers both
// from the fixtures is the whole of it.
//
// The driver is stood in for rather than installed, so the suite runs on a
// clone with only the dev dependencies and never opens a connection. Nothing
// below this line knows it is not talking to Postgres.
let slotHolders = [];
let heldByCustomer = 0;
const fakeSql = (strings) => {
  const sql = strings.raw.join('?');
  if (/count\(\*\)/.test(sql)) return Promise.resolve([{ held: heldByCustomer }]);
  return Promise.resolve(slotHolders.map(name => ({ barber: name })));
};

const Module = require('module');
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@neondatabase/serverless') return { neon: () => fakeSql };
  return realLoad.call(this, request, ...rest);
};
process.env.DATABASE_URL = 'postgres://test/test';

// The shop's clock is read through Intl, so the timezone has to be one the
// frozen dates below are expressed in or "already passed" drifts by an hour.
process.env.SHOP_TIMEZONE = 'UTC';
const api = require(path.join(__dirname, '..', 'api', 'index.js'));

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

const why = patch => {
  slotHolders = patch.holders || [];
  heldByCustomer = patch.alreadyHeld || 0;
  const payload = Object.assign({
    // A Tuesday, far enough ahead that the suite does not expire.
    date: '2099-09-08', time: '11:00 AM', name: 'Ahmed', phone: '0612345678',
    barber: 'Hemen', service: 'Classic Haircut'
  }, patch);
  delete payload.holders;
  delete payload.alreadyHeld;
  return api.refuseBooking(config, payload);
};

const checks = [];
const refused = (label, patch, expectRefusal) => {
  checks.push(why(patch).then(reason => ok(label, reason !== '', expectRefusal)));
};

async function main() {
  console.log('--- a good booking gets through ---');
  ok('Tue 11:00 with Hemen', await why({}), '');

  console.log('--- missing or malformed fields ---');
  refused('no date',            { date: '' }, true);
  refused('no time',            { time: '' }, true);
  refused('date not a date',    { date: 'tomorrow' }, true);
  refused('time not a time',    { time: 'lunchtime' }, true);
  refused('no name',            { name: '   ' }, true);
  refused('no phone',           { phone: '' }, true);
  refused('phone too short',    { phone: '123' }, true);
  refused('name absurdly long', { name: 'x'.repeat(101) }, true);
  refused('phone absurdly long',{ phone: '0'.repeat(41) }, true);
  await Promise.all(checks.splice(0));

  console.log('--- the optional email, if given, has to work ---');
  // A typo is worse than a blank: the booking is accepted, the confirmation
  // silently never arrives, and the customer is left expecting one.
  refused('no email at all',      { email: '' }, false);
  refused('email left undefined', {}, false);
  refused('a good address',       { email: 'ahmed@example.com' }, false);
  ['not-an-email', 'a@b', 'a b@c.com', '@example.com', 'x@.com', 'x@y.c'].forEach(bad => {
    refused(`"${bad}"`, { email: bad }, true);
  });
  refused('absurdly long address', { email: 'a'.repeat(250) + '@example.com' }, true);
  await Promise.all(checks.splice(0));

  console.log('--- the past ---');
  refused('yesterday', { date: '2020-01-01' }, true);
  await Promise.all(checks.splice(0));

  console.log('--- times today that have already gone ---');
  // Only the date used to be checked, so at four in the afternoon a booking for
  // ten that morning was accepted, and then sat in the diary looking like a
  // customer who had not turned up.
  {
    const RealDate = Date;
    const frozen = new RealDate(Date.UTC(2099, 8, 8, 16, 0, 0));  // Tue 16:00 UTC
    global.Date = class extends RealDate {
      constructor(...args) { return args.length ? new RealDate(...args) : new RealDate(frozen); }
      static now() { return frozen.getTime(); }
    };

    const at = (time, want) => refused(`today ${time}`, { date: '2099-09-08', time }, want);
    at('10:00 AM', true);    // long gone
    at('03:30 PM', true);    // gone
    at('04:00 PM', true);    // now — no notice at all
    at('04:10 PM', true);    // inside the 15-minute notice
    at('04:30 PM', false);   // far enough ahead
    at('05:00 PM', false);

    // A later date is unaffected by the time of day. Wednesday is Hemen's.
    refused('tomorrow at 10:00', { date: '2099-09-09', time: '10:00 AM' }, false);
    await Promise.all(checks.splice(0));

    global.Date = RealDate;
  }

  console.log('--- the rota is enforced, not just drawn ---');
  refused('Hemen on a Monday',      { date:'2099-09-07' }, true);
  refused('Hemen during his break', { time:'01:30 PM' }, true);
  refused('Amir while away',        { date:'2099-09-01', barber:'Amir' }, true);
  refused('Sunday',                 { date:'2099-09-13' }, true);
  refused('before opening',         { time:'09:00 AM' }, true);
  refused('Raman before noon Mon',  { date:'2099-09-07', barber:'Raman', time:'11:00 AM' }, true);
  refused('Raman at noon Mon',      { date:'2099-09-07', barber:'Raman', time:'12:00 PM' }, false);
  await Promise.all(checks.splice(0));

  console.log('--- an appointment must finish before closing ---');
  // The website never offers 17:45, but the server is what actually decides.
  refused('17:30 ends at 18:00', { time:'05:30 PM' }, false);
  refused('17:45 would overrun', { time:'05:45 PM' }, true);
  await Promise.all(checks.splice(0));

  console.log('--- the chair has to be free ---');
  refused('Hemen already booked',    { holders:['Hemen'] }, true);
  refused('but Amir is not',         { holders:['Hemen'], barber:'Amir' }, false);
  refused('no preference, one left', { holders:['Hemen'], barber:ANY_BARBER }, false);
  refused('no preference, none left',{ holders:['Hemen','Amir'], barber:ANY_BARBER }, true);
  await Promise.all(checks.splice(0));

  console.log('--- one number cannot hold the whole diary ---');
  // The form is public and asks for a name and a number, so there is nothing
  // between it and a script that fills a month. A real customer books one
  // haircut, occasionally two.
  refused('nine already held', { alreadyHeld: 9 }, false);
  refused('ten is where it stops', { alreadyHeld: 10 }, true);
  refused('and beyond', { alreadyHeld: 40 }, true);
  await Promise.all(checks.splice(0));

  console.log('--- a barber the shop does not have ---');
  refused('a made-up name', { barber: 'Nobody' }, true);
  // 'Any', 'Any Available' and nothing at all all mean the same thing. 'Any'
  // used to slip past the rota check and then be stored as a barber's name.
  refused('"Any" is nobody',           { barber: 'Any' }, false);
  refused('"Any Available" is nobody', { barber: ANY_BARBER }, false);
  refused('and so is blank',           { barber: '' }, false);
  await Promise.all(checks.splice(0));

  console.log('--- the message says which rule was hit ---');
  ok('names the barber', /Hemen/.test(await why({ date: '2099-09-07' })), true);

  console.log(failed === 0 ? '\nAll refusal tests passed.' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
