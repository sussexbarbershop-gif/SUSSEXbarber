// Pulls the scheduling helpers straight out of index.html and checks the page
// agrees with the backend about who is bookable when.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', "index.html"), 'utf8');

const NAMES = ['parseClock','minutesToLabel','hoursForDay','isClosedOn','dateKey',
  'barberDayEntry','isBarberOnLeave','isBarberWorkingAt','barbersWorkingAt',
  'selectedBarberName','slotsForDate','noSlotsOn'];

// The barber cards are built from the sheet, so the page must not carry a
// hardcoded person; a name the sheet has never heard of gets no rota.
const hardcoded = [...html.matchAll(/data-barber="([^"]*)"/g)].map(m => m[1]);

const src = NAMES.map(n => {
  const m = html.match(new RegExp('^        function ' + n + '\\([\\s\\S]*?^        }', 'm'));
  if (!m) throw new Error('not found in index.html: ' + n);
  return m[0];
}).join('\n');

const SLOT_MINUTES = 30;
const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const ANY_BARBER = 'Any Available';

// selectedBarberName() reads the hidden #barber input.
let barberFieldValue = ANY_BARBER;
global.document = { getElementById: id => (id === 'barber' ? { value: barberFieldValue } : null) };

eval(src);

const FULL_DAY = { from:'10:00', to:'18:00', breakFrom:'13:30', breakTo:'14:00' };
// Monday is Raman's alone: noon start, no break.
const MONDAY_LATE = { from:'12:00', to:'18:00', breakFrom:'', breakTo:'' };

/** `shifts` maps weekday -> hours; days left out are days off. */
const rota = shifts => WEEKDAY_NAMES.map(d => shifts[d]
  ? Object.assign({ day:d, working:true }, shifts[d])
  : { day:d, working:false, from:'', to:'', breakFrom:'', breakTo:'' });

global.window = {
  sussexHours: WEEKDAY_NAMES.map(d => ({
    day: d, open: d !== 'Sunday', from: d === 'Monday' ? '12:00' : '10:00', to: '18:00'
  })),
  sussexBarbers: ['Any Available','Hemen','Amir','Raman','Bassam'],
  sussexBarberHours: {
    Hemen:  rota({ Tuesday:FULL_DAY, Wednesday:FULL_DAY, Friday:FULL_DAY, Saturday:FULL_DAY }),
    Amir:   rota({ Tuesday:FULL_DAY, Thursday:FULL_DAY, Friday:FULL_DAY, Saturday:FULL_DAY }),
    Raman:  rota({ Monday:MONDAY_LATE, Saturday:FULL_DAY }),
    Bassam: rota({})
  },
  sussexTimeOff: [{ barber:'Hemen', from:'2026-09-02', to:'2026-09-04', note:'holiday' }]
};

let failed = 0;
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};
const D = s => new Date(s + 'T00:00:00');

// Aug 2026: 16 Sun, 17 Mon, 18 Tue, 19 Wed, 20 Thu, 21 Fri, 22 Sat
console.log('--- the mobile action bar and duplicate Call/Directions buttons are gone ---');
// A floating round Book button and a floating round Contact button used to sit
// at the same bottom-right corner, and a second Call/Directions pair sat above
// the address. Both were removed for the header's Book Now and the nav's Call.
ok('no mobileActionBar left in the page', html.includes('id="mobileActionBar"'), false);
ok('no pb-28 left over for the removed bar', /class="[^"]*\bpb-28\b/.test(html), false);

console.log('--- the barber list comes from the sheet ---');
ok('no barber names written into the page',
   hardcoded.filter(n => n !== 'Any Available' && !n.startsWith('$')), []);

console.log('--- slot lists the customer actually sees ---');
barberFieldValue = 'Hemen';
const hemenWed = slotsForDate(D('2026-08-19'));
ok('Hemen Wed starts 10:00', hemenWed[0], '10:00 AM');
ok('Hemen Wed ends 17:30',   hemenWed[hemenWed.length-1], '05:30 PM');
ok('Hemen Wed skips break',  hemenWed.includes('01:30 PM'), false);
ok('Hemen Wed keeps 13:00',  hemenWed.includes('01:00 PM'), true);
ok('Hemen Wed resumes 14:00',hemenWed.includes('02:00 PM'), true);
ok('Hemen Wed slot count',   hemenWed.length, 15);
ok('Hemen has no Monday',    slotsForDate(D('2026-08-17')), []);
ok('Hemen has no Thursday',  slotsForDate(D('2026-08-20')), []);
ok('Hemen away Sep 2 (Wed)', slotsForDate(D('2026-09-02')), []);

barberFieldValue = 'Raman';
const ramanMon = slotsForDate(D('2026-08-17'));
ok('Raman Mon starts 12:00', ramanMon[0], '12:00 PM');
ok('Raman Mon ends 17:30',   ramanMon[ramanMon.length-1], '05:30 PM');
ok('Raman Mon has no break', ramanMon.includes('01:30 PM'), true);
ok('Raman Mon slot count',   ramanMon.length, 12);
ok('Raman Sat starts 10:00', slotsForDate(D('2026-08-22'))[0], '10:00 AM');
ok('Raman Sat does break',   slotsForDate(D('2026-08-22')).includes('01:30 PM'), false);
ok('Raman has no Tuesday',   slotsForDate(D('2026-08-18')), []);

// The shop hours are the ceiling: an earlier closing trims the tail.
window.sussexHours.find(h => h.day === 'Monday').to = '15:00';
const trimmed = slotsForDate(D('2026-08-17'));
ok('early closing trims to 14:30', trimmed[trimmed.length-1], '02:30 PM');
window.sussexHours.find(h => h.day === 'Monday').to = '18:00';

barberFieldValue = 'Bassam';
ok('Bassam off every day',   slotsForDate(D('2026-08-22')), []);

console.log('--- no preference: the union of everyone ---');
barberFieldValue = ANY_BARBER;
ok('Any: Monday has slots',  slotsForDate(D('2026-08-17')).length > 0, true);
ok('Any: Thursday has slots',slotsForDate(D('2026-08-20')).length > 0, true);
ok('Any: Sunday closed',     slotsForDate(D('2026-08-16')), []);
ok('Any: break still blocked (all share it)',
   slotsForDate(D('2026-08-22')).includes('01:30 PM'), false);

console.log('--- calendar greying ---');
barberFieldValue = 'Hemen';
ok('Hemen: Monday greyed',   noSlotsOn(D('2026-08-17')), true);
ok('Hemen: Tuesday open',    noSlotsOn(D('2026-08-18')), false);
ok('shop closed Sunday',     isClosedOn(D('2026-08-16')), true);
ok('shop open Monday',       isClosedOn(D('2026-08-17')), false);
barberFieldValue = ANY_BARBER;
ok('Any: Monday not greyed', noSlotsOn(D('2026-08-17')), false);

console.log('--- who is on the floor ---');
ok('Sat 11:00', barbersWorkingAt(D('2026-08-22'), 11*60), ['Hemen','Amir','Raman']);
ok('Wed 11:00', barbersWorkingAt(D('2026-08-19'), 11*60), ['Hemen']);
ok('Mon 13:00', barbersWorkingAt(D('2026-08-17'), 13*60), ['Raman']);

console.log(failed === 0 ? '\nAll front-end tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
