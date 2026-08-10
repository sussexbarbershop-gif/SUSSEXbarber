// slotRefusal() is the only thing standing between the public booking form and
// the diary. The browser checks the same rules, but the form is public, so
// anything not refused here can be written by a hand-made request.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

function grab(name) {
  const re = new RegExp('^function ' + name + '\\([\\s\\S]*?^}', 'm');
  const m = src.match(re);
  if (!m) throw new Error('not found: ' + name);
  return m[0];
}

const SLOT_MINUTES = 30;
const MIN_NOTICE_MINUTES = 15;
const ANY_BARBER = 'Any Available';
const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

eval(['weekdayNameFor','clockToMinutes','normalisePhone','formatDateTimezoneSafe',
      'barberDayEntry','isBarberOnLeave','isBarberWorkingAt','barbersWorkingAt',
      'isSlotFree','slotRefusal'].map(grab).join('\n'));

const FULL_DAY = { from:'10:00', to:'18:00', breakFrom:'13:30', breakTo:'14:00' };
const MONDAY_LATE = { from:'12:00', to:'18:00', breakFrom:'', breakTo:'' };
const rota = shifts => WEEKDAY_NAMES.map(d => shifts[d]
  ? Object.assign({ day:d, working:true }, shifts[d])
  : { day:d, working:false, from:'', to:'', breakFrom:'', breakTo:'' });

const config = {
  barbers: [{name:'Any Available'},{name:'Hemen'},{name:'Amir'},{name:'Raman'}],
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

// slotRefusal() reaches for these two; hand it fixtures instead of a Sheet.
let slotHolders = [];
function readConfigCached() { return config; }
function holdersOfSlot() { return slotHolders; }

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};
const refused = (label, patch, expectRefusal) => {
  slotHolders = patch.holders || [];
  const payload = Object.assign({
    // A Tuesday, far enough ahead that the suite does not expire.
    date: '2099-09-08', time: '11:00 AM', name: 'Ahmed', phone: '0612345678',
    barber: 'Hemen', service: 'Classic Haircut'
  }, patch);
  delete payload.holders;
  const why = slotRefusal(null, null, payload);
  ok(label, why !== '', expectRefusal);
  return why;
};

console.log('--- a good booking gets through ---');
ok('Tue 11:00 with Hemen', slotRefusal(null, null, {
  date:'2099-09-08', time:'11:00 AM', name:'Ahmed', phone:'0612345678', barber:'Hemen'
}), '');

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

console.log('--- the past ---');
refused('yesterday', { date: '2020-01-01' }, true);

console.log('--- times today that have already gone ---');
// Only the date used to be checked, so at four in the afternoon a booking for
// ten that morning was accepted, and then sat in the diary looking like a
// customer who had not turned up.
{
  // Freeze "now" at a Tuesday 16:00, a day the fixture has Hemen working.
  const RealDate = Date;
  const frozen = new RealDate(2099, 8, 8, 16, 0, 0);   // 2099-09-08, a Tuesday
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
  refused('tomorrow at 10:00', { date: '2099-09-09', time: '10:00 AM', barber: 'Hemen' }, false);

  global.Date = RealDate;
}

console.log('--- the rota is enforced, not just drawn ---');
refused('Hemen on a Monday',      { date:'2099-09-07', barber:'Hemen' }, true);
refused('Hemen during his break', { time:'01:30 PM' }, true);
refused('Amir while away',        { date:'2099-09-01', barber:'Amir' }, true);
refused('Sunday',                 { date:'2099-09-13' }, true);
refused('before opening',         { time:'09:00 AM' }, true);
refused('Raman before noon Mon',  { date:'2099-09-07', barber:'Raman', time:'11:00 AM' }, true);
refused('Raman at noon Mon',      { date:'2099-09-07', barber:'Raman', time:'12:00 PM' }, false);

console.log('--- an appointment must finish before closing ---');
// The website never offers 17:45, but the server is what actually decides.
refused('17:30 ends at 18:00', { time:'05:30 PM' }, false);
refused('17:45 would overrun', { time:'05:45 PM' }, true);

console.log('--- the chair has to be free ---');
refused('Hemen already booked',    { holders:['Hemen'] }, true);
refused('but Amir is not',         { holders:['Hemen'], barber:'Amir' }, false);
refused('no preference, one left', { holders:['Hemen'], barber:ANY_BARBER }, false);
refused('no preference, none left',{ holders:['Hemen','Amir'], barber:ANY_BARBER }, true);

console.log('--- the message says which rule was hit ---');
slotHolders = [];
ok('names the barber', /Hemen/.test(slotRefusal(null, null, {
  date:'2099-09-07', time:'11:00 AM', name:'Ahmed', phone:'0612345678', barber:'Hemen'
})), true);

console.log(failed === 0 ? '\nAll refusal tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
