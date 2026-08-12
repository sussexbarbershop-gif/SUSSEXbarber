// The browser greys out days and offers time chips on its own, so it does not
// have to ask the server about every square in the calendar. That means the
// rota logic exists twice: in index.html, and in api/_lib/rota.js where the
// booking is actually accepted or refused.
//
// If they drift, the failure is the worst one this site has: the customer is
// offered a slot, fills the whole form in, and is then told no. Nothing in
// either file would look wrong on its own.
//
// So this runs both over the same matrix — every barber, every day of a week,
// every half hour of the shop's day — and fails on the first disagreement.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = require(path.join(root, 'api', '_lib', 'rota.js'));

// ---- the browser's copy, lifted out of the page -------------------------

const BROWSER_FNS = ['parseClock', 'minutesToLabel', 'hoursForDay', 'isClosedOn',
  'dateKey', 'barberDayEntry', 'isBarberOnLeave', 'isBarberWorkingAt',
  'barbersWorkingAt', 'selectedBarberName', 'slotsForDate', 'noSlotsOn'];

const src = BROWSER_FNS.map(n => {
  const m = html.match(new RegExp('^        function ' + n + '\\([\\s\\S]*?^        }', 'm'));
  if (!m) throw new Error('not found in index.html: ' + n);
  return m[0];
}).join('\n');

const SLOT_MINUTES = 30;
const MIN_NOTICE_MINUTES = 15;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
                       'Friday', 'Saturday'];
const ANY_BARBER = 'Any Available';

let barberFieldValue = ANY_BARBER;
global.document = { getElementById: id => (id === 'barber' ? { value: barberFieldValue } : null) };

eval(src);   // defines the browser copies in this scope

// ---- one shop, described once, handed to both ---------------------------

const FULL_DAY = { from: '10:00', to: '18:00', breakFrom: '13:30', breakTo: '14:00' };
const MONDAY_LATE = { from: '12:00', to: '18:00', breakFrom: '', breakTo: '' };
const ODD_SHIFT = { from: '11:15', to: '16:45', breakFrom: '12:00', breakTo: '12:30' };

const rota = shifts => WEEKDAY_NAMES.map(d => shifts[d]
  ? Object.assign({ day: d, working: true }, shifts[d])
  : { day: d, working: false, from: '', to: '', breakFrom: '', breakTo: '' });

const barberHours = {
  Hemen: rota({ Tuesday: FULL_DAY, Wednesday: FULL_DAY, Friday: FULL_DAY, Saturday: FULL_DAY }),
  Amir:  rota({ Tuesday: FULL_DAY, Thursday: FULL_DAY, Friday: FULL_DAY, Saturday: FULL_DAY }),
  Raman: rota({ Monday: MONDAY_LATE, Saturday: FULL_DAY }),
  // Deliberately awkward: a shift that starts and ends off the half hour, to
  // catch an off-by-one in the "must finish by closing" arithmetic.
  Bassam: rota({ Wednesday: ODD_SHIFT, Thursday: FULL_DAY }),
  // No rota at all. Both copies must fall back to shop hours for this one.
  Saan: undefined
};
delete barberHours.Saan;

const hours = WEEKDAY_NAMES.map(d => ({
  day: d,
  open: d !== 'Sunday',
  from: d === 'Monday' ? '12:00' : '10:00',
  to: '18:00'
}));

const timeOff = [
  { barber: 'Amir', from: '2026-09-10', to: '2026-09-14', note: 'holiday' },
  { barber: 'Hemen', from: '2026-09-18', to: '2026-09-18', note: 'one day' },
  // `to` left blank, which the shop is allowed to do for a single day.
  { barber: 'Raman', from: '2026-09-21', to: '', note: 'blank end' }
];

const barberNames = [ANY_BARBER, 'Hemen', 'Amir', 'Raman', 'Bassam', 'Saan'];

// The browser reads globals; the server takes a config object.
global.window = {
  sussexHours: hours,
  sussexBarbers: barberNames,
  sussexBarberHours: barberHours,
  sussexTimeOff: timeOff
};
const config = { hours, barberNames, barberHours, timeOff };

// ---- compare -------------------------------------------------------------

let checks = 0, failures = 0;
const seen = [];

function same(label, a, b) {
  checks++;
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  failures++;
  if (seen.length < 10) seen.push(`${label}\n    browser=${JSON.stringify(a)}\n    server =${JSON.stringify(b)}`);
}

const asDate = s => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// A fortnight from a Sunday, so every weekday and both time-off windows are
// covered, and far enough ahead that "today" never enters into it.
const DATES = [];
for (let i = 0; i < 21; i++) {
  const d = new Date(2026, 8, 6 + i);          // 6 Sep 2026 is a Sunday
  DATES.push(d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0'));
}

const PEOPLE = ['Hemen', 'Amir', 'Raman', 'Bassam', 'Saan', 'Nobody Here'];

console.log('--- is the shop open ---');
DATES.forEach(ds => same(`isClosedOn ${ds}`, isClosedOn(asDate(ds)), server.isClosedOn(config, ds)));

console.log('--- is this barber on the floor, every half hour ---');
DATES.forEach(ds => {
  PEOPLE.forEach(who => {
    // 09:00 to 19:00 covers an hour either side of the shop's day, so the
    // boundaries are tested from outside as well as in.
    for (let t = 9 * 60; t <= 19 * 60; t += 30) {
      same(`isBarberWorkingAt ${who} ${ds} ${t}`,
        isBarberWorkingAt(who, asDate(ds), t),
        server.isBarberWorkingAt(config, who, ds, t));
    }
  });
});

console.log('--- who is on the floor ---');
DATES.forEach(ds => {
  for (let t = 9 * 60; t <= 19 * 60; t += 30) {
    same(`barbersWorkingAt ${ds} ${t}`,
      barbersWorkingAt(asDate(ds), t),
      server.barbersWorkingAt(config, ds, t));
  }
});

console.log('--- the time chips offered for a day ---');
DATES.forEach(ds => {
  ['', ANY_BARBER].concat(PEOPLE).forEach(who => {
    // No "today" for either side: these dates are all in the future, so the
    // notice cutoff is out of the picture and the two must match exactly.
    same(`slotsForDate ${ds} "${who}"`,
      slotsForDate(asDate(ds), who === ANY_BARBER ? '' : who),
      server.slotsForDate(config, ds, who, null, 0));
  });
});

console.log('--- odd shifts land on the same boundaries ---');
// Bassam works 11:15-16:45 on a Wednesday. The last bookable slot has to be
// one that finishes by 16:45, and neither copy may round in the other's favour.
same('Bassam Wednesday chips',
  slotsForDate(asDate('2026-09-09'), 'Bassam'),
  server.slotsForDate(config, '2026-09-09', 'Bassam', null, 0));

console.log('--- time off, including a blank end date ---');
[['Amir', '2026-09-09'], ['Amir', '2026-09-10'], ['Amir', '2026-09-14'],
 ['Amir', '2026-09-15'], ['Hemen', '2026-09-18'], ['Raman', '2026-09-21']]
  .forEach(([who, ds]) => same(`isBarberOnLeave ${who} ${ds}`,
    isBarberOnLeave(who, asDate(ds)),
    server.isBarberOnLeave(config, who, ds)));

console.log('--- clock parsing agrees ---');
['10:00', '9:05', '00:00', '23:59', '', 'nonsense', '12:00', '7:30']
  .forEach(v => same(`parseClock ${JSON.stringify(v)}`, parseClock(v), server.parseClock(v)));
[0, 1, 60, 690, 719, 720, 721, 1439]
  .forEach(v => same(`minutesToLabel ${v}`, minutesToLabel(v), server.minutesToLabel(v)));

console.log('');
if (failures) {
  console.log(`FAIL  ${failures} of ${checks} answers differ. First few:\n`);
  seen.forEach(s => console.log('  ' + s + '\n'));
  process.exit(1);
}
console.log(`PASS  the browser and the server agree on all ${checks} answers.`);
