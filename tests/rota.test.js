const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', "apps-script/Code.gs"), 'utf8');

var SLOT_MINUTES = 30;
var ANY_BARBER = 'Any Available';
var WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function grab(name) {
  const re = new RegExp('^function ' + name + '\\([\\s\\S]*?^}', 'm');
  const m = src.match(re);
  if (!m) throw new Error('not found: ' + name);
  return m[0];
}
eval(['weekdayNameFor','clockToMinutes','barberDayEntry','isBarberOnLeave',
 'isBarberWorkingAt','barbersWorkingAt','isSlotFree'].map(grab).join('\n'));

const FULL_DAY = { from:'10:00', to:'18:00', breakFrom:'13:30', breakTo:'14:00' };
// Monday is Raman's alone: noon start, no break.
const MONDAY_LATE = { from:'12:00', to:'18:00', breakFrom:'', breakTo:'' };

/** `shifts` maps weekday -> hours; days left out are days off. */
const rota = shifts => WEEKDAY_NAMES.map(d => shifts[d]
  ? Object.assign({ day:d, working:true }, shifts[d])
  : { day:d, working:false, from:'', to:'', breakFrom:'', breakTo:'' });

const cfg = {
  barbers: [{name:'Any Available'},{name:'Hemen'},{name:'Amir'},{name:'Raman'},{name:'Bassam'}],
  hours: WEEKDAY_NAMES.map(d => ({
    day: d, open: d !== 'Sunday', from: d === 'Monday' ? '12:00' : '10:00', to: '18:00'
  })),
  barberHours: {
    Hemen:  rota({ Tuesday:FULL_DAY, Wednesday:FULL_DAY, Friday:FULL_DAY, Saturday:FULL_DAY }),
    Amir:   rota({ Tuesday:FULL_DAY, Thursday:FULL_DAY, Friday:FULL_DAY, Saturday:FULL_DAY }),
    Raman:  rota({ Monday:MONDAY_LATE, Saturday:FULL_DAY }),
    Bassam: rota({})
  },
  // Sep 1 2026 is a Tuesday, a day Amir normally works.
  timeOff: [{ barber:'Amir', from:'2026-09-01', to:'2026-09-05', note:'holiday' }]
};

let failed = 0;
const M = s => { const [h,m] = s.split(':').map(Number); return h*60+m; };
const ok = (label, actual, want) => {
  const pass = JSON.stringify(actual) === JSON.stringify(want);
  if (!pass) failed++;
  console.log((pass ? 'PASS  ' : 'FAIL  ') + label +
    (pass ? '' : `   got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`));
};

// 2026: Aug 17 Mon, 18 Tue, 19 Wed, 20 Thu, 21 Fri, 22 Sat, 16 Sun
console.log('--- rota as the owner described it ---');
ok('Hemen works Tue',       isBarberWorkingAt(cfg,'Hemen','2026-08-18',M('11:00')), true);
ok('Hemen works Wed',       isBarberWorkingAt(cfg,'Hemen','2026-08-19',M('11:00')), true);
ok('Hemen off Thu',         isBarberWorkingAt(cfg,'Hemen','2026-08-20',M('11:00')), false);
ok('Hemen off Mon',         isBarberWorkingAt(cfg,'Hemen','2026-08-17',M('13:00')), false);
ok('Amir works Thu',        isBarberWorkingAt(cfg,'Amir','2026-08-20',M('11:00')), true);
ok('Amir off Wed',          isBarberWorkingAt(cfg,'Amir','2026-08-19',M('11:00')), false);
ok('Raman works Mon',       isBarberWorkingAt(cfg,'Raman','2026-08-17',M('13:00')), true);
ok('Raman works Sat 11:00', isBarberWorkingAt(cfg,'Raman','2026-08-22',M('11:00')), true);
ok('Raman off Tue',         isBarberWorkingAt(cfg,'Raman','2026-08-18',M('11:00')), false);
ok('Bassam off by default', isBarberWorkingAt(cfg,'Bassam','2026-08-18',M('11:00')), false);

console.log('--- daily break 13:30-14:00 ---');
ok('13:00 ok, ends at 13:30', isBarberWorkingAt(cfg,'Hemen','2026-08-18',M('13:00')), true);
ok('13:30 blocked',           isBarberWorkingAt(cfg,'Hemen','2026-08-18',M('13:30')), false);
ok('14:00 back on',           isBarberWorkingAt(cfg,'Hemen','2026-08-18',M('14:00')), true);

ok('Raman Mon 11:00 too early',        isBarberWorkingAt(cfg,'Raman','2026-08-17',M('11:00')), false);
ok('Raman Mon 12:00 on',               isBarberWorkingAt(cfg,'Raman','2026-08-17',M('12:00')), true);
ok('Raman Mon has no break at 13:30',  isBarberWorkingAt(cfg,'Raman','2026-08-17',M('13:30')), true);
ok('Raman Sat does break at 13:30',    isBarberWorkingAt(cfg,'Raman','2026-08-22',M('13:30')), false);
ok('Sunday: nobody',                 barbersWorkingAt(cfg,'2026-08-16',M('11:00')), []);

console.log('--- shop hours cap the rota, never widen it ---');
// A rota may run past closing; the shop hours are the ceiling either way.
const earlyClosing = JSON.parse(JSON.stringify(cfg));
earlyClosing.hours.find(h => h.day === 'Tuesday').to = '15:00';
ok('rota to 18:00 but shop shuts 15:00', isBarberWorkingAt(earlyClosing,'Hemen','2026-08-18',M('15:00')), false);
ok('14:30 is the last start',            isBarberWorkingAt(earlyClosing,'Hemen','2026-08-18',M('14:30')), true);

const lateOpening = JSON.parse(JSON.stringify(cfg));
lateOpening.hours.find(h => h.day === 'Tuesday').from = '11:00';
ok('rota 10:00 but shop opens 11:00',    isBarberWorkingAt(lateOpening,'Hemen','2026-08-18',M('10:00')), false);
ok('11:00 once the door opens',          isBarberWorkingAt(lateOpening,'Hemen','2026-08-18',M('11:00')), true);

console.log('--- a barber with no rota at all ---');
// Deliberate: before the owner fills a rota in, a barber works whenever the
// shop is open, so nothing is hidden. But this is why every barber the booking
// form offers must exist in the Barbers sheet — Hemen with no rows was
// bookable on a Monday he does not work.
const noRota = JSON.parse(JSON.stringify(cfg));
delete noRota.barberHours.Hemen;
ok('no rota -> shop hours apply', isBarberWorkingAt(noRota,'Hemen','2026-08-17',M('13:00')), true);
ok('rota present -> Monday off',  isBarberWorkingAt(cfg,'Hemen','2026-08-17',M('13:00')), false);

console.log('--- time off ---');
ok('Amir away Tue Sep 1',  isBarberWorkingAt(cfg,'Amir','2026-09-01',M('11:00')), false);
ok('Amir away Sat Sep 5',  isBarberWorkingAt(cfg,'Amir','2026-09-05',M('11:00')), false);
ok('Amir back Tue Sep 8',  isBarberWorkingAt(cfg,'Amir','2026-09-08',M('11:00')), true);

console.log('--- who is on the floor ---');
ok('Sat 11:00, all three',   barbersWorkingAt(cfg,'2026-08-22',M('11:00')), ['Hemen','Amir','Raman']);
ok('Sat 13:30, all on break',barbersWorkingAt(cfg,'2026-08-22',M('13:30')), []);
ok('Mon 13:30, Raman has no break',
   barbersWorkingAt(cfg,'2026-08-17',M('13:30')), ['Raman']);
ok('Wed 11:00', barbersWorkingAt(cfg,'2026-08-19',M('11:00')), ['Hemen']);
ok('Mon 13:00', barbersWorkingAt(cfg,'2026-08-17',M('13:00')), ['Raman']);
ok('Thu 11:00',             barbersWorkingAt(cfg,'2026-08-20',M('11:00')), ['Amir']);
ok('Tue Sep 1, Amir away',  barbersWorkingAt(cfg,'2026-09-01',M('11:00')), ['Hemen']);

console.log('--- the double-booking bug ---');
ok('Wed: Hemen booked -> Hemen busy',  isSlotFree(cfg,'2026-08-19','11:00 AM',['Hemen'],'Hemen'), false);
ok('Sat: Hemen booked -> Amir free',   isSlotFree(cfg,'2026-08-22','11:00 AM',['Hemen'],'Amir'), true);
ok('Sat: 2 of 3 booked -> Any free',   isSlotFree(cfg,'2026-08-22','11:00 AM',['Hemen','Amir'],''), true);
ok('Sat: all 3 booked -> Any full',    isSlotFree(cfg,'2026-08-22','11:00 AM',['Hemen','Amir','Raman'],''), false);
ok('Mon: Raman is the only chair',     isSlotFree(cfg,'2026-08-17','01:00 PM',['Raman'],''), false);
ok('Wed: only Hemen works, booked',    isSlotFree(cfg,'2026-08-19','11:00 AM',['Hemen'],''), false);
ok('Wed: Amir not rostered',           isSlotFree(cfg,'2026-08-19','11:00 AM',[],'Amir'), false);
ok('Sat: 2 anon bookings, Raman free', isSlotFree(cfg,'2026-08-22','11:00 AM',['Any Available','Any Available'],'Raman'), true);
ok('Sat: 3 anon bookings, none free',  isSlotFree(cfg,'2026-08-22','11:00 AM',['Any Available','Any Available','Any Available'],'Raman'), false);
ok('break slot free for nobody',       isSlotFree(cfg,'2026-08-22','01:30 PM',[],''), false);

console.log(failed === 0 ? '\nAll tests passed.' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
